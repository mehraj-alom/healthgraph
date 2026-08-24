from typing import Optional
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph.state import CompiledStateGraph
from core.config import settings
from agents.orchestrator import workflow
from logger import logger

_checkpointer: Optional[AsyncPostgresSaver] = None
medical_agent: Optional[CompiledStateGraph] = None

async def initialize_agent():
    """Called during FastAPI lifespan startup to compile the graph globally."""
    global _checkpointer, medical_agent
    try:
        _checkpointer = AsyncPostgresSaver.from_conn_string(settings.ASYNC_DATABASE_URL)
        await _checkpointer.setup()
        medical_agent = workflow.compile(checkpointer=_checkpointer)
        logger.info("LangGraph medical_agent compiled with AsyncPostgresSaver.")
    except Exception as e:
        logger.critical(f"Failed to initialize LangGraph agent: {e}")
        raise