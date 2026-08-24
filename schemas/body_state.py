from typing import Optional
from pydantic import BaseModel
from models.anatomy import VisualStatus, FindingTrend

class BodyStateItem(BaseModel):
    structure_id: str
    display_name: str
    mesh_node_name: str
    visual_status: VisualStatus
    severity: float
    trend: FindingTrend
    latest_summary: Optional[str] = None