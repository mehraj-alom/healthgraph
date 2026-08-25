import uuid
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from agents.tools.body_state import _get_current_body_state
from core.db import get_db
from schemas.body_state import BodyStateItem

router = APIRouter(prefix="/api/v1/body-state", tags=["3D Body State"])

@router.get("", response_model=List[BodyStateItem])
async def fetch_body_state(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db)
):
    """Direct read model endpoint for initial 3D mesh coloring in Flutter."""
    return [BodyStateItem(**row) for row in _get_current_body_state(patient_id, db)]