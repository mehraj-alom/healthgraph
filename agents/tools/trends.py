"""Agent tool for retrieving the existing longitudinal Trends aggregation."""

import uuid

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool

from app.api.v1.trends import get_trends
from core.db import SessionLocal


@tool
def get_patient_trends(days: int = 30, config: RunnableConfig = None) -> dict:
    """Retrieve the patient's Trends data for a requested period."""
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))
    if days not in (7, 30, 90):
        days = 30

    db = SessionLocal()
    try:
        return get_trends(days=days, db=db, patient_id=patient_id).model_dump(mode="json")
    finally:
        db.close()