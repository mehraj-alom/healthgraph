"""Outbox diagnostics endpoint (P7).

Answers "which of MY events failed, why, how many times, can I retry?"
Rows are patient-scoped via the JSONB payload's patient_id (the table has
no patient column by design). Identifiers only — never clinical content.
"""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.outbox import GraphSyncOutbox, OutboxStatus

router = APIRouter(prefix="/api/v1/system/outbox", tags=["outbox"])


class OutboxRow(BaseModel):
    id: uuid.UUID
    event_type: str
    status: str
    attempt_count: int
    last_error: Optional[str] = None
    next_attempt_at: Optional[str] = None
    event_ref: Optional[str] = None


@router.get("", response_model=list[OutboxRow])
def list_outbox_events(
    status: str = Query("dead_letter", description="pending | processing | processed | dead_letter"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """List the caller's outbox rows by status (default: dead_letter).

    Lets a patient/support diagnose failed projections without direct DB
    access. Rows for other patients are never returned (payload filter).
    """
    try:
        wanted = OutboxStatus(status)
    except ValueError:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Unknown outbox status.")
    rows = (
        db.execute(
            select(GraphSyncOutbox)
            .where(
                GraphSyncOutbox.status == wanted,
                GraphSyncOutbox.payload["patient_id"].astext == str(patient_id),
            )
            .order_by(desc(GraphSyncOutbox.created_at))
            .limit(limit)
        )
        .scalars()
        .all()
    )
    out: list[OutboxRow] = []
    for r in rows:
        payload = r.payload or {}
        ref = (
            payload.get("event_id")
            or payload.get("observation_id")
            or payload.get("medication_id")
            or payload.get("condition_id")
            or payload.get("visit_id")
            or payload.get("statement_id")
            or payload.get("measurement_id")
            or payload.get("scan_id")
            or payload.get("version_id")
            or payload.get("node_id")
        )
        out.append(OutboxRow(
            id=r.id,
            event_type=r.event_type.value if hasattr(r.event_type, "value") else str(r.event_type),
            status=r.status.value if hasattr(r.status, "value") else str(r.status),
            attempt_count=r.attempt_count,
            last_error=r.last_error,
            next_attempt_at=r.next_attempt_at.isoformat() if r.next_attempt_at else None,
            event_ref=ref,
        ))
    return out
