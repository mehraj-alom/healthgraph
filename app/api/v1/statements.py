"""P1 patient statements endpoint (minimal).

Records verbatim patient statements as USER_REPORTED evidence. Statements
are never diagnoses. An ABOUT link to a condition is created only when the
caller supplies a valid, patient-owned condition_id.
"""
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.conditions import ConditionOccurrence
from models.outbox import enqueue_statement
from models.privacy import log_audit
from models.statements import PatientStatement
from services.ocr.term_normalization import MedicalTermNormalizer

router = APIRouter(prefix="/api/v1/statements", tags=["statements"])


class StatementCreate(BaseModel):
    original_text: str = Field(min_length=1, max_length=2000)
    normalized_topic: Optional[str] = None
    about_condition_id: Optional[uuid.UUID] = None


class StatementResponse(BaseModel):
    statement_id: uuid.UUID
    original_text: str
    normalized_topic: Optional[str] = None
    about_condition_id: Optional[uuid.UUID] = None
    recorded_at: str


@router.post("", response_model=StatementResponse, status_code=201)
def create_statement(
    body: StatementCreate,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    about_id = None
    if body.about_condition_id is not None:
        cond = db.scalar(
            select(ConditionOccurrence).where(
                ConditionOccurrence.condition_id == body.about_condition_id,
                ConditionOccurrence.patient_id == patient_id,
            )
        )
        if cond is None:
            raise HTTPException(status_code=404, detail="Condition not found.")
        about_id = cond.condition_id

    statement = PatientStatement(
        patient_id=patient_id,
        original_text=body.original_text.strip(),
        normalized_topic=body.normalized_topic
        or MedicalTermNormalizer.lexical_text(body.original_text),
        speaker="patient",
        source="manual",
        about_condition_id=about_id,
    )
    db.add(statement)
    db.flush()
    enqueue_statement(
        db,
        statement_id=statement.statement_id,
        patient_id=patient_id,
        original_text=statement.original_text,
        normalized_topic=statement.normalized_topic,
        source="manual",
        about_condition_id=about_id,
        recorded_at=statement.recorded_at.isoformat() if statement.recorded_at else None,
    )
    log_audit(db, action="statement_created", patient_id=patient_id,
              entity_type="statement", entity_id=str(statement.statement_id))
    db.commit()
    db.refresh(statement)
    return StatementResponse(
        statement_id=statement.statement_id,
        original_text=statement.original_text,
        normalized_topic=statement.normalized_topic,
        about_condition_id=statement.about_condition_id,
        recorded_at=statement.recorded_at.isoformat() if statement.recorded_at else "",
    )


@router.get("", response_model=List[StatementResponse])
def list_statements(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    rows = (
        db.execute(
            select(PatientStatement)
            .where(PatientStatement.patient_id == patient_id)
            .order_by(PatientStatement.recorded_at.desc())
            .limit(100)
        ).scalars().all()
    )
    return [
        StatementResponse(
            statement_id=r.statement_id,
            original_text=r.original_text,
            normalized_topic=r.normalized_topic,
            about_condition_id=r.about_condition_id,
            recorded_at=r.recorded_at.isoformat() if r.recorded_at else "",
        )
        for r in rows
    ]
