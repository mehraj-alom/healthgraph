import uuid
from typing import Annotated, Sequence, TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class GraphState(TypedDict):
    """
    The state object passed through the LangGraph nodes.
    session_patient_id is server-controlled and injected by the API layer,
    never exposed as an LLM tool argument.
    """
    messages: Annotated[Sequence[BaseMessage], add_messages]
    session_patient_id: uuid.UUID