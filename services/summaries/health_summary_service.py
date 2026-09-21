"""Longitudinal patient health summary builder.

Aggregates data across all available clinical records into a compact,
deterministic patient-wide read model.  The summary is derived entirely
from source-of-truth PostgreSQL data — no LLM involved.

The summary is designed to give the chat agent a compact overview of
the patient's health without forcing retrieval of every raw record.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import and_, desc, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from logger import logger
from models.anatomy import (
    AnatomicalObservation,
    PatientBodyStateSnapshot,
)
from models.daily_logs.events import (
    ActivityPayload,
    MedicationTakenPayload,
    NutritionPayload,
    PainPayload,
    SleepPayload,
    SymptomPayload,
    VitalSignPayload,
    WellbeingPayload,
)
from models.events import ClinicalEvent, EventType
from models.summaries import PatientHealthSummary


# ---------------------------------------------------------------------------
# Lookback window
# ---------------------------------------------------------------------------

# How far back to look for "recent" trends.  90 days is a good balance
# between recency and statistical relevance.
RECENT_DAYS = 90


# ---------------------------------------------------------------------------
# Build helpers
# ---------------------------------------------------------------------------


def _latest_body_state(db: Session, patient_id: uuid.UUID) -> list[dict]:
    """Current body-state snapshot (latest observation per structure)."""
    rows = db.execute(
        select(PatientBodyStateSnapshot).where(
            PatientBodyStateSnapshot.patient_id == patient_id
        )
    ).scalars().all()
    return [
        {
            "structure_id": r.structure_id,
            "visual_status": r.visual_status.value,
            "visual_severity_score": r.visual_severity_score,
            "trend": r.trend.value,
            "latest_summary": r.latest_summary,
        }
        for r in rows
    ]


def _recent_symptoms(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    """Distinct recent symptoms with severity."""
    stmt = (
        select(
            SymptomPayload,
            ClinicalEvent.concept_id,
            ClinicalEvent.event_time,
        )
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == SymptomPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.SYMPTOM,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(20)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "concept_id": str(r.concept_id) if r.concept_id else None,
            "severity": r.SymptomPayload.severity,
            "notes": r.SymptomPayload.safe_notes or r.SymptomPayload.notes,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _vital_trends(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> dict:
    """Recent vital sign values grouped by concept_id."""
    stmt = (
        select(
            VitalSignPayload,
            ClinicalEvent.concept_id,
            ClinicalEvent.event_time,
        )
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == VitalSignPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.VITAL_SIGN,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(50)
    )
    rows = db.execute(stmt).all()

    by_concept: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        cid = str(r.concept_id) if r.concept_id else "unknown"
        by_concept[cid].append(
            {
                "value": r.VitalSignPayload.value,
                "unit": r.VitalSignPayload.unit,
                "event_time": r.event_time.isoformat() if r.event_time else None,
            }
        )

    return dict(by_concept)


def _sleep_trends(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    stmt = (
        select(SleepPayload, ClinicalEvent.event_time)
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == SleepPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.SLEEP_LOG,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(30)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "duration_minutes": r.SleepPayload.duration_minutes,
            "sleep_quality": r.SleepPayload.sleep_quality,
            "awakenings": r.SleepPayload.awakenings,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _wellbeing_trends(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    stmt = (
        select(WellbeingPayload, ClinicalEvent.event_time)
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == WellbeingPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.WELLBEING_LOG,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(30)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "overall_wellbeing": r.WellbeingPayload.overall_wellbeing,
            "energy_level": r.WellbeingPayload.energy_level,
            "stress_level": r.WellbeingPayload.stress_level,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _activity_history(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    stmt = (
        select(ActivityPayload, ClinicalEvent.event_time)
        .join(ClinicalEvent, ClinicalEvent.event_id == ActivityPayload.event_id)
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.ACTIVITY_LOG,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(100)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "activity_type": r.ActivityPayload.activity_type,
            "duration_minutes": r.ActivityPayload.duration_minutes,
            "calories_burned": r.ActivityPayload.calories_burned,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _nutrition_history(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    stmt = (
        select(NutritionPayload, ClinicalEvent.event_time)
        .join(ClinicalEvent, ClinicalEvent.event_id == NutritionPayload.event_id)
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.NUTRITION_LOG,
            )
        )
        .order_by(desc(ClinicalEvent.event_time))
        .limit(100)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "water_ml": r.NutritionPayload.water_ml,
            "meals_count": r.NutritionPayload.meals_count,
            "appetite_level": r.NutritionPayload.appetite_level,
            # P4: keep parity with _collect_nutrition (stored fields only).
            "calories_kcal": r.NutritionPayload.calories_kcal,
            "food_label": r.NutritionPayload.food_label,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _medication_history(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    """Distinct medications taken in the recent period."""
    stmt = (
        select(
            MedicationTakenPayload.medication_name,
            MedicationTakenPayload.dosage_value,
            MedicationTakenPayload.dosage_unit,
            func.min(ClinicalEvent.event_time).label("first_seen"),
            func.max(ClinicalEvent.event_time).label("last_seen"),
            func.count().label("doses"),
        )
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == MedicationTakenPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.MEDICATION_TAKEN,
            )
        )
        .group_by(
            MedicationTakenPayload.medication_name,
            MedicationTakenPayload.dosage_value,
            MedicationTakenPayload.dosage_unit,
        )
        .order_by(desc("last_seen"))
    )
    rows = db.execute(stmt).all()
    return [
        {
            "medication_name": r.medication_name,
            "dosage_value": r.dosage_value,
            "dosage_unit": r.dosage_unit,
            "first_seen": r.first_seen.isoformat() if r.first_seen else None,
            "last_seen": r.last_seen.isoformat() if r.last_seen else None,
            "doses": r.doses,
        }
        for r in rows
    ]


def _recurring_pain(
    db: Session,
    patient_id: uuid.UUID,
    since: datetime,
) -> list[dict]:
    """Pain entries grouped by body_location_id with frequency stats."""
    stmt = (
        select(
            PainPayload.body_location_id,
            func.count().label("occurrences"),
            func.min(PainPayload.severity).label("min_severity"),
            func.max(PainPayload.severity).label("max_severity"),
            func.avg(PainPayload.severity).label("avg_severity"),
            func.max(ClinicalEvent.event_time).label("last_reported"),
        )
        .join(
            ClinicalEvent,
            ClinicalEvent.event_id == PainPayload.event_id,
        )
        .where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= since,
                ClinicalEvent.event_type == EventType.PAIN_LOG,
            )
        )
        .group_by(PainPayload.body_location_id)
        .order_by(desc("occurrences"))
        .limit(20)
    )
    rows = db.execute(stmt).all()
    return [
        {
            "body_location_id": str(r.body_location_id) if r.body_location_id else None,
            "occurrences": r.occurrences,
            "min_severity": r.min_severity,
            "max_severity": r.max_severity,
            "avg_severity": round(float(r.avg_severity), 1) if r.avg_severity else None,
            "last_reported": r.last_reported.isoformat() if r.last_reported else None,
        }
        for r in rows
    ]


def _document_findings(
    db: Session,
    patient_id: uuid.UUID,
) -> list[dict]:
    """Brief summary of document-derived observations (non-daily-log source)."""
    from models.events import EventType as ET

    stmt = (
        select(AnatomicalObservation)
        .where(
            and_(
                AnatomicalObservation.patient_id == patient_id,
                AnatomicalObservation.document_id.is_not(None),
            )
        )
        .order_by(desc(AnatomicalObservation.recorded_at))
        .limit(10)
    )
    rows = db.execute(stmt).scalars().all()
    return [
        {
            "structure_id": obs.structure_id,
            "finding_code": obs.finding_code,
            "finding_display_name": obs.finding_display_name,
            "clinical_summary": obs.clinical_summary,
            "recorded_at": obs.recorded_at.isoformat() if obs.recorded_at else None,
        }
        for obs in rows
    ]


def _event_totals(
    db: Session,
    patient_id: uuid.UUID,
) -> dict:
    """Aggregate event counts by event type."""
    stmt = (
        select(
            ClinicalEvent.event_type,
            func.count().label("count"),
        )
        .where(ClinicalEvent.patient_id == patient_id)
        .group_by(ClinicalEvent.event_type)
    )
    rows = db.execute(stmt).all()
    return {r.event_type.value: r.count for r in rows}


def _date_range(
    db: Session,
    patient_id: uuid.UUID,
) -> Optional[dict]:
    """Earliest and latest clinical event dates."""
    stmt = select(
        func.min(ClinicalEvent.event_time).label("earliest"),
        func.max(ClinicalEvent.event_time).label("latest"),
        func.count().label("total"),
    ).where(ClinicalEvent.patient_id == patient_id)

    row = db.execute(stmt).one()
    if not row or not row.earliest:
        return None

    return {
        "earliest": row.earliest.isoformat() if row.earliest else None,
        "latest": row.latest.isoformat() if row.latest else None,
        "total_events": row.total,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_health_summary(
    db: Session,
    patient_id: uuid.UUID,
) -> dict:
    """Build a compact longitudinal patient health summary.

    Returns the sections dict (not yet persisted).
    """
    now = datetime.now(timezone.utc)
    since = now - __import__("datetime").timedelta(days=RECENT_DAYS)

    sections: dict = {}

    # Body state
    body_state = _latest_body_state(db, patient_id)
    if body_state:
        sections["current_body_state"] = body_state

    # Recent symptoms
    symptoms = _recent_symptoms(db, patient_id, since)
    if symptoms:
        sections["recent_symptoms"] = symptoms

    # Vital trends
    vitals = _vital_trends(db, patient_id, since)
    if vitals:
        sections["vital_trends"] = vitals

    # Sleep trends
    sleep = _sleep_trends(db, patient_id, since)
    if sleep:
        sections["sleep_trends"] = sleep

    # Wellbeing trends
    wellbeing = _wellbeing_trends(db, patient_id, since)
    if wellbeing:
        sections["wellbeing_trends"] = wellbeing

    # Activity history
    activities = _activity_history(db, patient_id, since)
    if activities:
        sections["activity_history"] = activities

    # Nutrition and hydration history
    nutrition = _nutrition_history(db, patient_id, since)
    if nutrition:
        sections["nutrition_history"] = nutrition

    # Medication history
    medications = _medication_history(db, patient_id, since)
    if medications:
        sections["medication_history"] = medications

    # Recurring pain
    pain = _recurring_pain(db, patient_id, since)
    if pain:
        sections["recurring_pain"] = pain

    # Document findings
    doc_findings = _document_findings(db, patient_id)
    if doc_findings:
        sections["document_findings"] = doc_findings

    # Event totals
    totals = _event_totals(db, patient_id)
    if totals:
        sections["event_totals"] = totals

    # Date range
    dr = _date_range(db, patient_id)
    if dr:
        sections["summary_date_range"] = dr

    return sections


def upsert_health_summary(
    db: Session,
    patient_id: uuid.UUID,
    *,
    auto_commit: bool = True,
) -> PatientHealthSummary:
    """Build and upsert the longitudinal patient health summary.

    Idempotent.
    """
    sections = build_health_summary(db, patient_id)

    total_events = sections.get("summary_date_range", {}).get("total_events", 0)
    now = datetime.now(timezone.utc)

    stmt = (
        insert(PatientHealthSummary)
        .values(
            patient_id=patient_id,
            sections=sections,
            total_events=total_events,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["patient_id"],
            set_={
                "sections": sections,
                "total_events": total_events,
                "updated_at": now,
            },
        )
        .returning(PatientHealthSummary)
    )

    result = db.execute(stmt).scalar_one()

    if auto_commit:
        db.commit()

    logger.info(
        "Health summary upserted for patient=%s events=%d",
        patient_id,
        total_events,
    )

    return result


def rebuild_health_summary(
    db: Session,
    patient_id: uuid.UUID,
) -> PatientHealthSummary:
    """Force-rebuild the longitudinal summary."""
    return upsert_health_summary(db, patient_id, auto_commit=True)


def get_health_summary(
    db: Session,
    patient_id: uuid.UUID,
) -> Optional[PatientHealthSummary]:
    """Retrieve the existing longitudinal summary if available."""
    return db.execute(
        select(PatientHealthSummary).where(
            PatientHealthSummary.patient_id == patient_id
        )
    ).scalar_one_or_none()
