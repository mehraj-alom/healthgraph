"""Agent tool: retrieve the daily health summary for a specific date.

Answers: "What did I log today?", "Summarize my day", etc.
"""

from datetime import date, datetime, timezone
from typing import Optional

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy.orm import Session

from core.db import SessionLocal
from services.summaries.daily_summary_service import (
    get_daily_summary,
    upsert_daily_summary,
)


@tool
def get_daily_health_summary(
    target_date: Optional[str] = None,
    config: RunnableConfig = None,
) -> dict:
    """Retrieves the complete structured daily health summary for a specific date.

    Use this tool when the patient asks about what they logged on a
    particular day, or wants a summary of their daily health data.

    Args:
        target_date: ISO date string (YYYY-MM-DD). Defaults to today
                     if not provided.
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

    # Parse target date
    if target_date:
        try:
            target = date.fromisoformat(target_date)
        except ValueError:
            return {
                "error": f"Invalid date format: {target_date}. Use YYYY-MM-DD."
            }
    else:
        target = datetime.now(timezone.utc).date()

    db: Session = SessionLocal()
    try:
        summary = get_daily_summary(db, patient_id, target)

        if not summary:
            # Auto-build if not yet populated
            summary = upsert_daily_summary(
                db, patient_id, target, auto_commit=True
            )

        if not summary:
            return {
                "date": target.isoformat(),
                "event_count": 0,
                "sections": {},
                "message": "No clinical events recorded for this date.",
            }

        return {
            "date": summary.summary_date.isoformat(),
            "event_count": summary.event_count,
            "sections": summary.sections,
        }
    finally:
        db.close()
