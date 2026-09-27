"""P1 clinical graph context helpers (PostgreSQL source of truth).

All helpers are deterministic and evidence-backed:
- get_or_create_visit: one Visit per (patient, date, type); never LLM-grouped.
- find_or_create_condition: one ConditionOccurrence per (patient,
  normalized name); assertion-classified, never inferred beyond the source.
- sync_medication_graph_context: derives purpose condition + reason
  statement from the medication row. Prescribed purpose (source document
  present) != patient-stated reason (manual entry) — kept explicit.

Callers own the transaction (helpers flush, never commit) and enqueue the
matching outbox rows. Neo4j projection stays idempotent MERGE.
"""
import contextlib
import uuid
from datetime import date, datetime, timezone
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models.clinical_assertion import classify_assertion
from models.conditions import ConditionOccurrence
from models.medications import Medication
from models.outbox import enqueue_condition, enqueue_statement, enqueue_visit
from models.statements import PatientStatement
from models.visits import Visit, VisitType
from services.ocr.term_normalization import MedicalTermNormalizer


def _as_date(value: datetime | date | None) -> date:
    if value is None:
        return datetime.now(timezone.utc).date()
    if isinstance(value, datetime):
        return value.date()
    return value


@contextlib.contextmanager
def _savepoint(db: Session):
    """Savepoint around a racy INSERT, or a no-op for stub sessions.

    A real SQLAlchemy Session always has begin_nested; the in-memory fakes
    used by the pure unit tests do not, so degrade to a plain block there.
    """
    begin_nested = getattr(db, "begin_nested", None)
    if begin_nested is None:
        yield
        return
    with begin_nested():
        yield


def get_or_create_visit(
    db: Session,
    patient_id: uuid.UUID,
    when: datetime | date | None,
    visit_type: str,
    source: str | None = None,
    *,
    enqueue: bool = True,
) -> Visit:
    """Deterministic visit grouping: one row per (patient, date, type)."""
    day = _as_date(when)
    visit = _select_visit(db, patient_id, day, visit_type)
    if visit is not None:
        return visit

    visit = Visit(
        visit_id=uuid.uuid4(),
        patient_id=patient_id,
        visit_date=day,
        visit_type=visit_type,
        source=source,
    )
    # Concurrent inserts for the same (patient, date, type) race on
    # uq_visit_patient_date_type: savepoint the insert so a losing flush
    # rolls back only this row, then adopt the winner's row. Without this
    # the IntegrityError poisoned the whole check-in transaction → 500.
    try:
        with _savepoint(db):
            db.add(visit)
            db.flush()
    except IntegrityError:
        visit = _select_visit(db, patient_id, day, visit_type)
        if visit is None:
            raise
        return visit

    if enqueue:
        enqueue_visit(
            db,
            visit_id=visit.visit_id,
            patient_id=patient_id,
            visit_date=day.isoformat(),
            visit_type=visit_type,
            source=source,
        )
    return visit


def _select_visit(db: Session, patient_id: uuid.UUID, day: date, visit_type):
    return db.scalar(
        select(Visit).where(
            Visit.patient_id == patient_id,
            Visit.visit_date == day,
            Visit.visit_type == visit_type,
        )
    )


def find_or_create_condition(
    db: Session,
    patient_id: uuid.UUID,
    name: str,
    *,
    terminology: str | None = None,
    code: str | None = None,
    display_name: str | None = None,
    source_type: str = "PATIENT_REPORTED",
    verification_status: str = "UNVERIFIED",
    onset_date: date | None = None,
    recorded_at: datetime | None = None,
    source_event_id: uuid.UUID | None = None,
    source_document_id: uuid.UUID | None = None,
    source_medication_id: uuid.UUID | None = None,
    evidence_text: str | None = None,
    extraction_method: str | None = None,
    visit_id: uuid.UUID | None = None,
    enqueue: bool = True,
) -> ConditionOccurrence:
    """Find-or-create by (patient, normalized name); assertion-classified."""
    raw = (name or "").strip()
    normalized = MedicalTermNormalizer.lexical_text(raw) or raw.lower()
    condition = _select_condition(db, patient_id, normalized)
    if condition is not None:
        return condition
    assertion = classify_assertion(evidence_text or raw)
    condition = ConditionOccurrence(
        condition_id=uuid.uuid4(),
        patient_id=patient_id,
        name=raw,
        normalized_name=normalized,
        terminology=terminology,
        code=code,
        display_name=display_name,
        polarity=assertion.polarity.value,
        assertion_verification=assertion.verification.value,
        experiencer=assertion.experiencer.value,
        clinical_status=assertion.clinical_status.value if assertion.clinical_status else None,
        source_type=source_type,
        verification_status=verification_status,
        onset_date=onset_date,
        recorded_at=recorded_at or datetime.now(timezone.utc),
        source_event_id=source_event_id,
        source_document_id=source_document_id,
        source_medication_id=source_medication_id,
        evidence_text=(evidence_text or assertion.snippet)[:500],
        extraction_method=extraction_method,
    )
    # Concurrent inserts for the same (patient, normalized name) race on
    # uq_condition_patient_normalized: savepoint the insert so a losing
    # flush rolls back only this row, then adopt the winner's row.
    try:
        with _savepoint(db):
            db.add(condition)
            db.flush()
    except IntegrityError:
        existing = _select_condition(db, patient_id, normalized)
        if existing is None:
            raise
        return existing
    db.refresh(condition)
    if enqueue:
        enqueue_condition(
            db,
            condition_id=condition.condition_id,
            patient_id=patient_id,
            name=raw,
            normalized_name=normalized,
            polarity=condition.polarity,
            assertion_verification=condition.assertion_verification,
            experiencer=condition.experiencer,
            clinical_status=condition.clinical_status,
            source_type=source_type,
            verification_status=verification_status,
            terminology=terminology,
            code=code,
            display_name=display_name,
            onset_date=onset_date.isoformat() if onset_date else None,
            recorded_at=condition.recorded_at.isoformat(),
            document_id=source_document_id,
            event_id=source_event_id,
            evidence_text=condition.evidence_text,
            visit_id=visit_id,
            pg_updated_at=condition.updated_at.isoformat() if condition.updated_at else None,
        )
    return condition


def _select_condition(db: Session, patient_id: uuid.UUID, normalized: str):
    return db.scalar(
        select(ConditionOccurrence).where(
            ConditionOccurrence.patient_id == patient_id,
            ConditionOccurrence.normalized_name == normalized,
        )
    )


def sync_medication_graph_context(db: Session, medication: Medication) -> dict:
    """Derive purpose condition + reason statement for a medication row.

    - purpose present + source_document_id present → prescribed purpose:
      ConditionOccurrence linked; NO patient statement (not patient-stated).
    - purpose present + no source document → patient-stated reason:
      ConditionOccurrence linked AND PatientStatement created (verbatim
      purpose text, ABOUT the condition). The statement is USER_REPORTED
      evidence, never a diagnosis.
    - no purpose → nothing (explicit absence; chat says so verbatim).

    Idempotent: reuses medication.purpose_condition_id / reason_statement_id
    links when they still match the current purpose text; re-derives when
    the purpose changed (old rows are kept — history is never rewritten).
    Returns {'condition_id', 'statement_id'} (either None).
    """
    from models.conditions import ConditionOccurrence as _Condition
    from models.statements import PatientStatement as _Statement

    result: dict = {"condition_id": None, "statement_id": None}
    purpose = (medication.purpose or "").strip()
    if not purpose:
        return result
    lexical = MedicalTermNormalizer.lexical_text(purpose) or purpose.lower()
    prescribed = medication.source_document_id is not None

    # Re-validate existing links against the current purpose text.
    if medication.purpose_condition_id is not None:
        existing = db.get(_Condition, medication.purpose_condition_id)
        if existing is None or existing.normalized_name != lexical:
            medication.purpose_condition_id = None
            medication.reason_statement_id = None
    if medication.reason_statement_id is not None:
        stmt = db.get(_Statement, medication.reason_statement_id)
        if stmt is None or (stmt.original_text or "").strip() != purpose or prescribed:
            # Stale text, or purpose is now prescribed (statements only
            # capture patient-stated reasons) → unlink (row kept).
            medication.reason_statement_id = None

    if medication.purpose_condition_id is None:
        condition = find_or_create_condition(
            db,
            medication.patient_id,
            purpose,
            source_type="DOCTOR_ENTERED" if prescribed else "PATIENT_REPORTED",
            verification_status="EXTRACTED" if prescribed else "UNVERIFIED",
            onset_date=medication.start_date,
            source_document_id=medication.source_document_id,
            source_medication_id=medication.medication_id,
            evidence_text=purpose,
            extraction_method=None if prescribed else "manual-entry",
        )
        medication.purpose_condition_id = condition.condition_id
    result["condition_id"] = medication.purpose_condition_id

    if not prescribed:
        if medication.reason_statement_id is None:
            statement = PatientStatement(
                statement_id=uuid.uuid4(),
                patient_id=medication.patient_id,
                original_text=purpose,
                normalized_topic=lexical,
                speaker="patient",
                source="medication-purpose",
                about_condition_id=result["condition_id"],
                source_medication_id=medication.medication_id,
            )
            db.add(statement)
            db.flush()
            enqueue_statement(
                db,
                statement_id=statement.statement_id,
                patient_id=medication.patient_id,
                original_text=purpose,
                normalized_topic=statement.normalized_topic,
                source="medication-purpose",
                about_condition_id=result["condition_id"],
                source_medication_id=medication.medication_id,
            )
            medication.reason_statement_id = statement.statement_id
        result["statement_id"] = medication.reason_statement_id

    db.flush()
    return result
