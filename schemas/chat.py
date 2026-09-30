import uuid
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field

from services.retrieval.evidence import Citation

class UIActionType(str, Enum):
    HIGHLIGHT_MESH = "highlight_mesh"
    FOCUS_CAMERA = "focus_camera"
    OPEN_PANEL = "open_panel"

class LLMUIAction(BaseModel):
    """Strict schema for the LLM. It is ONLY allowed to specify canonical anatomy IDs."""
    action_type: UIActionType
    structure_id: Optional[str] = Field(default=None, description="Canonical anatomy ID (e.g., 'RIGHT_KNEE')")

class AgentStructuredOutput(BaseModel):
    """The final structured output produced by the LangGraph synthesis node."""
    response_text: str = Field(description="Plain conversational prose, no markdown (**/#/ - /1./code/tables). 2-4 sentences synthesized from evidence.")
    ui_actions: List[LLMUIAction] = Field(default_factory=list)
    citations: List[Citation] = Field(
        default_factory=list,
        description="Provenance objects copied verbatim from tool results supporting the answer.",
    )

class HydratedUIAction(BaseModel):
    """What the API returns to Flutter, securely hydrated by PostgreSQL."""
    action_type: UIActionType
    structure_id: Optional[str]
    mesh_node_name: Optional[str] = Field(description="Authoritative 3D mesh identifier from DB.")
    visual_status: Optional[str]

class ChatRequest(BaseModel):
    message: str = Field(min_length=1)
    conversation_id: Optional[uuid.UUID] = Field(default=None, description="Existing thread ID.")
    focused_structure_id: Optional[str] = Field(default=None, description="Client-tapped canonical anatomy ID.")

class ChatResponse(BaseModel):
    conversation_id: uuid.UUID
    response_text: str
    ui_actions: List[HydratedUIAction]
    citations: List[Citation] = Field(default_factory=list)