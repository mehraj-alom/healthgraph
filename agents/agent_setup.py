from typing import Optional
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph.state import CompiledStateGraph
from core.config import settings
from agents.orchestrator import workflow
from logger import logger

_checkpointer: Optional[AsyncPostgresSaver] = None
medical_agent: Optional[CompiledStateGraph] = None
_cm = None

async def initialize_agent():
    """Called during FastAPI lifespan startup to compile the graph globally."""
    global _checkpointer, medical_agent, _cm
    try:
        conn_string = settings.ASYNC_DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")
        _cm = AsyncPostgresSaver.from_conn_string(conn_string)
        _checkpointer = await _cm.__aenter__()
        await _checkpointer.setup()
        medical_agent = workflow.compile(checkpointer=_checkpointer)
        logger.info("LangGraph medical_agent compiled with AsyncPostgresSaver.")
    except Exception as e:
        logger.critical(f"Failed to initialize LangGraph agent: {e}")
        raise

async def close_agent():
    """Called during FastAPI lifespan shutdown to close the checkpointer."""
    global _checkpointer, _cm
    if _cm:
        await _cm.__aexit__(None, None, None)
        _checkpointer = None
        _cm = None
        logger.info("LangGraph AsyncPostgresSaver closed.")
