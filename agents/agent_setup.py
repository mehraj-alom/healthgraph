"""LangGraph agent lifecycle management.

Design principles
-----------------
1. The AsyncConnectionPool is created **once** at startup and destroyed
   only at application shutdown.  Request handlers must never close or
   recreate the pool — that is what causes the ``PoolClosed`` race.

2. The pool uses a lightweight ``check`` callback (``SELECT 1``) on every
   checkout to detect dead connections **before** the checkpointer tries
   to use them.  If the check fails, the pool discards the connection
   and loops until a fresh one is available or the timeout expires.

3. After a transient ``OperationalError`` during ``ainvoke``, the retry
   sleeps briefly (2 s) to give the pool time to create replacement
   connections before retrying.

4. An in-flight request counter lets ``close_agent()`` at shutdown wait
   for active ``ainvoke`` calls to finish before closing the pool,
   preventing the old shutdown race (close pool → in-flight request
   hits ``PoolClosed``).
"""

import asyncio
from typing import Optional

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer
from langgraph.graph.state import CompiledStateGraph
from psycopg_pool import AsyncConnectionPool

from core.config import settings
from agents.orchestrator import workflow
from logger import logger
from schemas.chat import AgentStructuredOutput



_checkpointer: Optional[AsyncPostgresSaver] = None
_medical_agent: Optional[CompiledStateGraph] = None
_pool: Optional[AsyncConnectionPool] = None

# In-flight request tracking for graceful shutdown.
_active_requests: int = 0
_draining: bool = False
_request_counter_lock: Optional[asyncio.Lock] = None


def _get_request_counter_lock() -> asyncio.Lock:
    """Lazily create the request-counter lock (needs a running event loop)."""
    global _request_counter_lock
    if _request_counter_lock is None:
        _request_counter_lock = asyncio.Lock()
    return _request_counter_lock


async def begin_request() -> None:
    """Mark a request as in-flight.  Raises if the server is draining.

    Must be called in a ``try``/``finally`` with :func:`end_request`.
    """
    async with _get_request_counter_lock():
        if _draining:
            raise RuntimeError("Server is shutting down — refusing new requests.")
        global _active_requests
        _active_requests += 1


async def end_request() -> None:
    """Mark an in-flight request as finished."""
    async with _get_request_counter_lock():
        global _active_requests
        _active_requests -= 1


# ---------------------------------------------------------------------------
# Connection pool health check callback
# ---------------------------------------------------------------------------

async def _check_conn(conn) -> None:
    """Lightweight health check called by the pool on every checkout.

    Runs ``SELECT 1`` to verify the connection is alive.  If it fails,
    the pool discards the connection and loops to create a fresh one.
    """
    await conn.execute("SELECT 1")


# ---------------------------------------------------------------------------
# Connection pool factory
# ---------------------------------------------------------------------------

def _build_pool() -> AsyncConnectionPool:
    """Create an AsyncConnectionPool for the LangGraph checkpointer.

    The pool manages the full connection lifecycle:
    - ``check`` validates every connection on checkout with ``SELECT 1``
      so dead/stale connections are caught **before** use.
    - ``max_idle`` aggressively recycles idle connections before a cloud
      PostgreSQL server can close them server-side.
    - ``max_lifetime`` hard-cycles connections to avoid cumulative
      transient corruption.
    - ``reconnect_timeout`` controls how long a checkout waits when all
      connections are exhausted or being replaced.
    """
    conninfo = settings.ASYNC_DATABASE_URL.replace(
        "postgresql+asyncpg://",
        "postgresql://",
    )

    return AsyncConnectionPool(
        conninfo,
        min_size=2,               # Keep 2 warm connections ready
        max_size=5,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": None,
        },
        max_lifetime=15 * 60.0,   # Recycle after 15 minutes
        max_idle=5 * 60.0,        # Close idle connections after 5 minutes
        reconnect_timeout=30.0,    # Wait up to 30s for a fresh connection
        num_workers=3,
        check=_check_conn,         # Validate connections on checkout
        open=False,                # We call pool.open() explicitly
        name="langgraph-checkpointer",
    )

async def initialize_agent() -> None:
    """Initialize the LangGraph medical agent with a connection pool.

    Called **once** during the FastAPI lifespan startup.  The pool,
    checkpointer, and compiled agent live for the entire process
    lifetime — they are never destroyed or recreated from request
    handlers.
    """
    global _checkpointer, _medical_agent, _pool

    if _medical_agent is not None:
        logger.info("LangGraph medical_agent already initialized.")
        return

    logger.info("Initializing LangGraph AsyncPostgresSaver with connection pool...")

    try:
        # Create and open the connection pool.
        _pool = _build_pool()
        await _pool.open(wait=True, timeout=30)
        logger.info(
            "LangGraph checkpointer connection pool opened "
            "(min_size=%d, check=SELECT 1, max_idle=%ds).",
            _pool.min_size,
            int(_pool.max_idle),
        )

        # Register our custom Pydantic models with the serde so
        # checkpoint deserialization does not emit warnings.
        from schemas.chat import LLMUIAction, UIActionType

        _checkpoint_types = (
            AgentStructuredOutput,
            LLMUIAction,
            UIActionType,
        )
        serde = JsonPlusSerializer(
            allowed_msgpack_modules=[
                (cls.__module__, cls.__qualname__) for cls in _checkpoint_types
            ],
        )

        # Create the checkpointer backed by the pool.
        _checkpointer = AsyncPostgresSaver(conn=_pool, serde=serde)

        # Initialize checkpoint tables / migrations.
        await _checkpointer.setup()
        logger.info("LangGraph checkpoint database setup completed.")

        # Compile the graph with the live checkpointer.
        _medical_agent = workflow.compile(checkpointer=_checkpointer)
        logger.info("LangGraph medical_agent compiled with AsyncPostgresSaver.")

    except Exception:
        logger.exception("Failed to initialize LangGraph medical agent.")
        await _teardown_checkpointer()
        raise


async def _teardown_checkpointer() -> None:
    """Tear down checkpointer + pool.  Only called at shutdown or on
    partial-initialization failure."""
    global _checkpointer, _pool, _medical_agent

    _medical_agent = None
    _checkpointer = None

    if _pool is not None:
        try:
            await _pool.close()
        except Exception:
            logger.debug("Error closing connection pool (ignored).")
        _pool = None


def get_medical_agent() -> CompiledStateGraph:
    """Return the initialized medical agent.

    Raises a clear error if the application was started incorrectly.
    """
    if _medical_agent is None:
        raise RuntimeError("LangGraph medical_agent is not initialized.")
    return _medical_agent



async def close_agent() -> None:
    """Gracefully close the LangGraph checkpointer and connection pool.

    Order of operations:
    1. Set ``_draining = True`` so :func:`begin_request` rejects new
       incoming requests immediately.
    2. Wait (up to 30 s) for in-flight ``ainvoke`` calls to finish.
    3. Close the pool.

    This prevents the old race where shutdown closed the pool while a
    request handler was still mid-``ainvoke``.
    """
    global _draining

    if _pool is None and _checkpointer is None:
        logger.info("LangGraph agent was already closed.")
        return

    # Signal draining — begin_request() will reject new callers.
    _draining = True
    logger.info("LangGraph agent draining — waiting for in-flight requests...")

    # Wait for in-flight requests to complete (with timeout).
    deadline = asyncio.get_event_loop().time() + 30.0
    while _active_requests > 0:
        if asyncio.get_event_loop().time() > deadline:
            logger.warning(
                "Timed out waiting for %d in-flight request(s). "
                "Closing pool anyway.",
                _active_requests,
            )
            break
        await asyncio.sleep(0.1)

    logger.info("Closing LangGraph AsyncPostgresSaver + connection pool...")

    try:
        await _teardown_checkpointer()
    except Exception:
        logger.exception("Error while closing LangGraph checkpointer.")

    logger.info("LangGraph AsyncPostgresSaver closed.")


medical_agent = None
