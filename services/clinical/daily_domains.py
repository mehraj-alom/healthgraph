"""P3 daily-domain projection helpers (PostgreSQL source of truth).

Thin wrappers used by BOTH the POST (create) and PUT (correction) daily
check-in paths so the two stay consistent. Each helper only ADDS outbox
rows / first-class PG rows for the P3 graph domains; the existing
ClinicalEvent + payload writes are untouched.

All helpers are USER_REPORTED evidence by construction (daily check-in is
patient-entered): nothing here becomes a confirmed clinical fact. Symptom
conditions carry severity/duration in evidence_text; notes become
PatientStatements; daily free-text meds link to canonical name nodes only
(no RESULTS_FROM — no order evidence — and no adherence impact).
"""
import uuid
from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from models.conditions import ConditionOccurrence
from models.events import EvidenceLink  # noqa: F401  (re-exported for callers)
from models.outbox import (
    enqueue_activity,
    enqueue_clinical_event,
    enqueue_condition,
    enqueue_medication_taken,
    enqueue_nutrition,
    enqueue_sleep,
    enqueue_statement,
)
from models.visits import VisitType
from services.clinical.occurrences import find_or_create_condition, get_or_create_visit
from services.ocr.term_normalization import MedicalTermNormalizer


def enqueue_checkin_event(db: Session, patient_id: uuid.UUID, event, visit, concept_id=None) -> None:
    """Shared ClinicalEvent outbox call for daily check-in sections.

    Stamps PG assertion columns (positive/unconfirmed/patient — check-ins
    are patient-entered by construction), forwards the validated concept
    triplet when present, and attaches the day's visit. Used by BOTH the
    POST (create) and PUT (correction) paths so they stay consistent.
    """
    if event.polarity is None:
        event.polarity = "positive"
    if event.assertion_verification is None:
        event.assertion_verification = "unconfirmed"
    if event.experiencer is None:
        event.experiencer = "patient"
    system, code, display = concept_triplet(db, concept_id)
    enqueue_clinical_event(
        db,
        event_id=event.event_id,
        patient_id=patient_id,
        event_type=event.event_type,
        source_type=event.source_type,
        verification_status=event.verification_status,
        event_time=event.event_time,
        polarity=event.polarity,
        assertion_verification=event.assertion_verification,
        experiencer=event.experiencer,
        concept_id=concept_id,
        concept_system=system,
        concept_code=code,
        concept_display=display,
        visit_id=visit.visit_id,
    )
    db.flush()


def checkin_visit(db: Session, patient_id: uuid.UUID, timestamp: datetime):
    """The day's deterministic daily-checkin Visit (shared by all sections)."""
    return get_or_create_visit(db, patient_id, timestamp, VisitType.DAILY_CHECKIN, source="daily-checkin")


def project_sleep(db: Session, patient_id: uuid.UUID, event, duration_minutes: int,
                  sleep_quality, awakenings, visit) -> None:
    enqueue_sleep(
        db, event_id=event.event_id, patient_id=patient_id,
        duration_minutes=duration_minutes, sleep_quality=sleep_quality,
        awakenings=awakenings,
        event_time=event.event_time.isoformat() if event.event_time else None,
        visit_id=visit.visit_id,
    )


def project_activity(db: Session, patient_id: uuid.UUID, event, activity_type: str,
                     duration_minutes, calories_burned, visit) -> None:
    enqueue_activity(
        db, event_id=event.event_id, patient_id=patient_id,
        activity_type=activity_type, duration_minutes=duration_minutes,
        calories_burned=calories_burned,
        event_time=event.event_time.isoformat() if event.event_time else None,
        visit_id=visit.visit_id,
    )


def project_nutrition(db: Session, patient_id: uuid.UUID, event, water_ml, meals_count,
                      appetite_level, calories_kcal, food_label, visit) -> None:
    enqueue_nutrition(
        db, event_id=event.event_id, patient_id=patient_id,
        water_ml=water_ml, meals_count=meals_count, appetite_level=appetite_level,
        calories_kcal=calories_kcal, food_label=food_label,
        event_time=event.event_time.isoformat() if event.event_time else None,
        visit_id=visit.visit_id,
    )


def project_symptom_condition(db: Session, patient_id: uuid.UUID, event, concept_id,
                              severity: int | None, duration_minutes: int | None,
                              safe_notes: str | None, visit, relink: bool = False) -> None:
    """Validated-concept symptom → ConditionOccurrence + HAS_CODE evidence.

    The condition keeps the concept coding (NORMALIZED); severity/duration
    ride in evidence_text (SYSTEM_DERIVED formatting of stated values).

    relink=True (PUT correction path): when the condition row pre-existed
    (dedup by normalized name), refresh its source_event_id/evidence to the
    replacement event and re-enqueue so the projection updates instead of
    pointing at a deleted event.
    """
    from models.ontology import MedicalConcept

    concept = db.get(MedicalConcept, concept_id) if concept_id else None
    name = concept.display_name if concept else "symptom"
    bits = []
    if severity is not None:
        bits.append(f"severity {severity}/10")
    if duration_minutes is not None:
        bits.append(f"duration {duration_minutes} min")
    if safe_notes:
        bits.append(safe_notes[:200])
    evidence = "; ".join(bits)[:500] or None
    pre_existing = db.scalar(
        select(ConditionOccurrence).where(
            ConditionOccurrence.patient_id == patient_id,
            ConditionOccurrence.normalized_name == (
                MedicalTermNormalizer.lexical_text(name) or name.lower()
            ),
        )
    )
    condition = find_or_create_condition(
        db, patient_id, name,
        terminology=concept.terminology if concept else None,
        code=concept.code if concept else None,
        display_name=concept.display_name if concept else None,
        source_type="PATIENT_REPORTED",
        verification_status="HUMAN_VERIFIED",
        onset_date=event.event_time.date() if event.event_time else None,
        recorded_at=event.event_time,
        source_event_id=event.event_id,
        evidence_text=evidence,
        extraction_method="manual-entry",
        visit_id=visit.visit_id,
    )
    if relink and pre_existing is not None and pre_existing.source_event_id != event.event_id:
        pre_existing.source_event_id = event.event_id
        if evidence:
            pre_existing.evidence_text = evidence
        db.flush()
        db.refresh(pre_existing)
        enqueue_condition(
            db,
            condition_id=pre_existing.condition_id,
            patient_id=patient_id,
            name=pre_existing.name,
            normalized_name=pre_existing.normalized_name,
            polarity=pre_existing.polarity,
            assertion_verification=pre_existing.assertion_verification,
            experiencer=pre_existing.experiencer,
            clinical_status=pre_existing.clinical_status,
            source_type=pre_existing.source_type,
            verification_status=pre_existing.verification_status,
            terminology=pre_existing.terminology,
            code=pre_existing.code,
            display_name=pre_existing.display_name,
            onset_date=pre_existing.onset_date.isoformat() if pre_existing.onset_date else None,
            recorded_at=pre_existing.recorded_at.isoformat() if pre_existing.recorded_at else None,
            event_id=event.event_id,
            evidence_text=pre_existing.evidence_text,
            visit_id=visit.visit_id,
            pg_updated_at=pre_existing.updated_at.isoformat() if pre_existing.updated_at else None,
        )
        db.flush()


def project_notes_statement(db: Session, patient_id: uuid.UUID, safe_notes: str, visit, event=None) -> None:
    """Free-text journal note → PatientStatement (verbatim, USER_REPORTED).

    source_event_id links the statement to its sourcing check-in event so
    PUT corrections can scope-delete by it (SET NULL fallback preserves
    history if the event disappears another way).
    """
    from models.statements import PatientStatement

    text = (safe_notes or "").strip()
    if not text:
        return
    statement = PatientStatement(
        statement_id=uuid.uuid4(),
        patient_id=patient_id,
        original_text=text[:2000],
        normalized_topic=None,
        speaker="patient",
        source="daily-note",
        source_event_id=event.event_id if event is not None else None,
    )
    db.add(statement)
    db.flush()
    enqueue_statement(
        db, statement_id=statement.statement_id, patient_id=patient_id,
        original_text=statement.original_text, source="daily-note",
        visit_id=visit.visit_id,
    )


def project_daily_meds_taken(db: Session, patient_id: uuid.UUID, event, medication_name: str,
                             dosage_value, dosage_unit, visit) -> None:
    """Daily free-text med log → TakenEvent linked by canonical NAME only.

    No medication_id (no regimen evidence → no RESULTS_FROM), so adherence
    queries over linked regimens are unaffected. The projection links
    TAKEN_FROM to the shared canonical Medication{norm_key} node.
    """
    enqueue_medication_taken(
        db, event_id=event.event_id, patient_id=patient_id,
        medication_id=None,
        taken_at=event.event_time.isoformat() if event.event_time else None,
        dose_taken=dosage_value, dose_unit=dosage_unit, status="TAKEN",
        visit_id=visit.visit_id, medication_name=(medication_name or "").strip() or None,
    )


def concept_triplet(db: Session, concept_id):
    """Return (system, code, display) for a validated concept id (or Nones)."""
    if concept_id is None:
        return None, None, None
    from models.ontology import MedicalConcept

    concept = db.get(MedicalConcept, concept_id)
    if concept is None:
        return None, None, None
    return concept.terminology, concept.code, concept.display_name
