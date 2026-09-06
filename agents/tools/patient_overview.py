"""Agent tool: retrieve the longitudinal patient health overview.

Answers: "What do you know about my health?", "Give me a complete
health summary", "What patterns do you see?", etc.
"""

from typing import Optional

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy.orm import Session

from core.db import SessionLocal
from services.summaries.health_summary_service import (
    get_health_summary,
    upsert_health_summary,
)


@tool
def get_patient_overview(config: RunnableConfig = None) -> dict:
    """Retrieves a compact, longitudinal overview of the patient's health.

    Use this tool when the patient asks about their overall health
    picture, health patterns, recurring concerns, or wants a complete
    health summary across all time.

    Returns structured sections including:
    - current body state
    - recent symptoms
    - vital trends
    - sleep trends
    - wellbeing trends
    - activity history
    - nutrition and hydration history
    - medication history
    - recurring pain
    - document findings
    - event totals
    - date range
    """
    # Security boundary
    patient_id_str = (
        config.get("configurable", {}).get("session_patient_id")
        if config
        else None
    )
    if not patient_id_str:
        raise ValueError(
            "CRITICAL: session_patient_id missing from execution config."
        )

    import uuid

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        summary = get_health_summary(db, patient_id)

        if not summary:
            # Auto-build if not yet populated
            summary = upsert_health_summary(
                db, patient_id, auto_commit=True
            )

        if not summary:
            return {
                "sections": {},
                "total_events": 0,
                "message": (
                    "No clinical data available for this patient."
                ),
            }

        return {
            "sections": summary.sections,
            "total_events": summary.total_events,
            "updated_at": (
                summary.updated_at.isoformat()
                if summary.updated_at
                else None
            ),
        }
    finally:
        db.close()
