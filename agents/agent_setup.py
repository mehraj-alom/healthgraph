from typing import Optional

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph.state import CompiledStateGraph
from psycopg_pool import AsyncConnectionPool

from core.config import settings
from agents.orchestrator import workflow
from logger import logger



# Global agent state
_checkpointer: Optional[AsyncPostgresSaver] = None
_medical_agent: Optional[CompiledStateGraph] = None
_pool: Optional[AsyncConnectionPool] = None


# Connection pool factory

def _build_pool() -> AsyncConnectionPool:
    """Create an AsyncConnectionPool for the LangGraph checkpointer.

    Uses a connection pool instead of a single connection so that:
    - Dead connections are automatically replaced.
    - Idle connections are recycled before cloud PostgreSQL closes them.
    - Concurrent requests each get their own connection from the pool.
    """
    conninfo = settings.ASYNC_DATABASE_URL.replace(
        "postgresql+asyncpg://",
        "postgresql://",
    )

    return AsyncConnectionPool(
        conninfo,
        min_size=1,
        max_size=5,
        kwargs={
            "autocommit": True,
            "prepare_threshold": 0,
            "row_factory": None,  # psycopg default dict_row handled by saver
        },
        max_lifetime=30 * 60.0,   # Recycle after 30 minutes
        max_idle=10 * 60.0,        # Close idle connections after 10 minutes
        reconnect_timeout=30.0,
        num_workers=3,
        open=False,                # We call pool.open() explicitly
        name="langgraph-checkpointer",
    )


# Agent initialization

async def initialize_agent(force: bool = False) -> None:
    """Initialize the LangGraph medical agent with a connection pool.

    The AsyncConnectionPool + AsyncPostgresSaver are kept alive for the
    entire FastAPI application lifespan.

    Args:
        force: If True, tear down any existing checkpointer/pool and
               reinitialize from scratch.  Used by the chat retry path.
    """
    global _checkpointer
    global _medical_agent
    global _pool

    if force:
        await _teardown_checkpointer()

    # Prevent accidental double initialization.
    if _medical_agent is not None:
        logger.info("LangGraph medical_agent already initialized.")
        return

    logger.info("Initializing LangGraph AsyncPostgresSaver with connection pool...")

    try:
        
        # Create and open the connection pool.

        _pool = _build_pool()
        await _pool.open(wait=True, timeout=30)
        logger.info("LangGraph checkpointer connection pool opened.")


        # Create the checkpointer backed by the pool.
        #
        # When conn is an AsyncConnectionPool, each checkout gets its own
        # connection.  Failed connections are retried transparently.

        _checkpointer = AsyncPostgresSaver(conn=_pool)

    
        # Initialize checkpoint tables / migrations.

        await _checkpointer.setup()
        logger.info("LangGraph checkpoint database setup completed.")

        # Compile the graph with the live checkpointer.

        _medical_agent = workflow.compile(checkpointer=_checkpointer)
        logger.info("LangGraph medical_agent compiled with AsyncPostgresSaver.")

    except Exception:
        logger.exception("Failed to initialize LangGraph medical agent.")

        # Clean up a partially-created state.
        await _teardown_checkpointer()
        raise


async def _teardown_checkpointer() -> None:
    """Tear down checkpointer + pool without touching global _medical_agent."""
    global _checkpointer, _pool

    if _checkpointer is not None:
        try:
            await _checkpointer.conn.close()
        except Exception:
            logger.debug("Error closing checkpointer connection (ignored).")
        _checkpointer = None

    if _pool is not None:
        try:
            await _pool.close()
        except Exception:
            logger.debug("Error closing connection pool (ignored).")
        _pool = None


# Agent accesso

def get_medical_agent() -> CompiledStateGraph:
    """Return the initialized medical agent.

    Raises a clear error instead of returning None if the FastAPI
    application was started incorrectly.
    """
    if _medical_agent is None:
        raise RuntimeError("LangGraph medical_agent is not initialized.")
    return _medical_agent


# Application shutdown

async def close_agent() -> None:
    """Close the LangGraph checkpointer and connection pool during shutdown."""
    global _medical_agent

    if _pool is None and _checkpointer is None:
        _medical_agent = None
        logger.info("LangGraph agent was already closed.")
        return

    logger.info("Closing LangGraph AsyncPostgresSaver + connection pool...")

    try:
        await _teardown_checkpointer()
    except Exception:
        logger.exception("Error while closing LangGraph checkpointer.")

    _medical_agent = None
    logger.info("LangGraph AsyncPostgresSaver closed.")


# Backward compatibility
# Keep this exported name because existing code may import
# `medical_agent` from this module.
medical_agent = None
