# get_context_around() -> anchor + cross-domain time-window retrieval
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from services.retrieval import context_windows as _cw


def _get_context_around(
    patient_id: uuid.UUID, anchor_type: str, anchor_ref: str,
    before_days: int, after_days: int, db: Session, driver,
) -> List[Dict]:
    """Internal logic: anchor resolution + windowed cross-domain fetch."""
    try:
        before = int(before_days)
        after = int(after_days)
    except (TypeError, ValueError):
        return [{"error": "INVALID_WINDOW: before_days/after_days must be integers."}]
    result = _cw.get_context_around(db, driver, patient_id, anchor_type, anchor_ref, before, after)
    return [result]


@tool
def get_context_around(anchor_type: str, anchor_ref: str,
                       before_days: int = 7, after_days: int = 7,
                       config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves everything recorded in a time window around an anchor:
    the anchor (a medication start, calendar day, PPG session, or single
    measurement), the window dates, and per-domain facts (visits,
    conditions, measurements, sleep, activity, nutrition, food, biometric
    sessions, statements, medications started) with citations.

    Temporal co-occurrence is not causation — say so when summarizing.

    Args:
        anchor_type: one of medication, log_date, ppg, measurement.
        anchor_ref: medication name (or fragment), YYYY-MM-DD day,
            PPG measurement UUID, or measurement UUID.
        before_days: days before the anchor (0-62, default 7).
        after_days: days after the anchor (0-62, default 7).
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_context_around(patient_id, anchor_type, anchor_ref,
                                   before_days, after_days, db, neo4j_driver)
    finally:
        db.close()
