"""Deterministic daily summary builder.

Reads ClinicalEvent + payload tables and AnatomicalObservations for a
given (patient_id, date) pair, then upserts a compact PatientDailySummary.

This service is:
- deterministic (no LLM)
- idempotent (safe to re-run)
- rebuildable (source-of-truth data is always available)
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from typing import Optional

from sqlalchemy import and_, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from logger import logger
from models.anatomy import AnatomicalObservation
from models.daily_logs.events import (
    ActivityPayload,
    MedicationTakenPayload,
    NutritionPayload,
    PainPayload,
    PatientNotePayload,
    SleepPayload,
    SymptomPayload,
    VitalSignPayload,
    WellbeingPayload,
)
from models.events import ClinicalEvent, EventType
from models.summaries import PatientDailySummary


# ---------------------------------------------------------------------------
# Internal helpers – one per clinical event type
# ---------------------------------------------------------------------------


def _collect_vitals(
    db: Session,
    event_ids: list[uuid.UUID],
    timestamp: datetime,
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(VitalSignPayload, ClinicalEvent.concept_id, ClinicalEvent.event_time).where(
            VitalSignPayload.event_id.in_(event_ids)
        ).join(
            ClinicalEvent, ClinicalEvent.event_id == VitalSignPayload.event_id
        )
    ).all()
    return [
        {
            "concept_id": str(r.concept_id) if r.concept_id else None,
            "value": r.VitalSignPayload.value,
            "unit": r.VitalSignPayload.unit,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _collect_symptoms(
    db: Session,
    event_ids: list[uuid.UUID],
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(SymptomPayload, ClinicalEvent.concept_id, ClinicalEvent.event_time).where(
            SymptomPayload.event_id.in_(event_ids)
        ).join(
            ClinicalEvent, ClinicalEvent.event_id == SymptomPayload.event_id
        )
    ).all()
    return [
        {
            "concept_id": str(r.concept_id) if r.concept_id else None,
            "severity": r.SymptomPayload.severity,
            "duration_minutes": r.SymptomPayload.duration_minutes,
            "notes": r.SymptomPayload.safe_notes or r.SymptomPayload.notes,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _collect_pain(
    db: Session,
    event_ids: list[uuid.UUID],
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(PainPayload, ClinicalEvent.event_time).where(
            PainPayload.event_id.in_(event_ids)
        ).join(
            ClinicalEvent, ClinicalEvent.event_id == PainPayload.event_id
        )
    ).all()
    return [
        {
            "body_location_id": str(r.PainPayload.body_location_id) if r.PainPayload.body_location_id else None,
            "severity": r.PainPayload.severity,
            "pain_type": r.PainPayload.pain_type,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _collect_sleep(
    db: Session,
    event_ids: list[uuid.UUID],
) -> Optional[dict]:
    if not event_ids:
        return None
    row = db.execute(
        select(SleepPayload).where(SleepPayload.event_id.in_(event_ids))
    ).first()
    if not row:
        return None
    p = row[0]
    return {
        "duration_minutes": p.duration_minutes,
        "sleep_quality": p.sleep_quality,
        "awakenings": p.awakenings,
    }


def _collect_nutrition(
    db: Session,
    event_ids: list[uuid.UUID],
) -> Optional[dict]:
    if not event_ids:
        return None
    row = db.execute(
        select(NutritionPayload).where(NutritionPayload.event_id.in_(event_ids))
    ).first()
    if not row:
        return None
    p = row[0]
    return {
        "water_ml": p.water_ml,
        "meals_count": p.meals_count,
        "appetite_level": p.appetite_level,
        # P4: previously dropped even though stored (payload_nutrition
        # carries both). Additive keys only; rebuild via upsert for history.
        "calories_kcal": p.calories_kcal,
        "food_label": p.food_label,
    }


def _collect_activities(
    db: Session,
    event_ids: list[uuid.UUID],
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(ActivityPayload).where(ActivityPayload.event_id.in_(event_ids))
    ).all()
    return [
        {
            "activity_type": r[0].activity_type,
            "duration_minutes": r[0].duration_minutes,
            "calories_burned": r[0].calories_burned,
        }
        for r in rows
    ]


def _collect_medications(
    db: Session,
    event_ids: list[uuid.UUID],
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(MedicationTakenPayload).where(
            MedicationTakenPayload.event_id.in_(event_ids)
        )
    ).all()
    return [
        {
            "medication_name": r[0].medication_name,
            "dosage_value": r[0].dosage_value,
            "dosage_unit": r[0].dosage_unit,
        }
        for r in rows
    ]


def _collect_wellbeing(
    db: Session,
    event_ids: list[uuid.UUID],
) -> Optional[dict]:
    if not event_ids:
        return None
    row = db.execute(
        select(WellbeingPayload).where(WellbeingPayload.event_id.in_(event_ids))
    ).first()
    if not row:
        return None
    p = row[0]
    return {
        "overall_wellbeing": p.overall_wellbeing,
        "energy_level": p.energy_level,
        "stress_level": p.stress_level,
    }


def _collect_notes(
    db: Session,
    event_ids: list[uuid.UUID],
) -> list[dict]:
    if not event_ids:
        return []
    rows = db.execute(
        select(PatientNotePayload, ClinicalEvent.event_time).where(
            PatientNotePayload.event_id.in_(event_ids)
        ).join(
            ClinicalEvent, ClinicalEvent.event_id == PatientNotePayload.event_id
        )
    ).all()
    return [
        {
            "safe_notes": r.PatientNotePayload.safe_notes,
            "event_time": r.event_time.isoformat() if r.event_time else None,
        }
        for r in rows
    ]


def _collect_anatomical_observations(
    db: Session,
    patient_id: uuid.UUID,
    day_start: datetime,
    day_end: datetime,
) -> list[dict]:
    rows = db.execute(
        select(AnatomicalObservation).where(
            and_(
                AnatomicalObservation.patient_id == patient_id,
                AnatomicalObservation.recorded_at >= day_start,
                AnatomicalObservation.recorded_at < day_end,
            )
        ).order_by(AnatomicalObservation.recorded_at.desc())
    ).scalars().all()
    return [
        {
            "structure_id": obs.structure_id,
            "finding_code": obs.finding_code,
            "finding_display_name": obs.finding_display_name,
            "visual_severity_score": obs.visual_severity_score,
            "visual_status": obs.visual_status.value,
            "clinical_summary": obs.clinical_summary,
        }
        for obs in rows
    ]


# ---------------------------------------------------------------------------
# Event type → category mapping
# ---------------------------------------------------------------------------

_EVENT_TYPE_CATEGORY = {
    EventType.VITAL_SIGN: "vitals",
    EventType.SYMPTOM: "symptoms",
    EventType.PAIN_LOG: "pain",
    EventType.SLEEP_LOG: "sleep",
    EventType.NUTRITION_LOG: "nutrition",
    EventType.ACTIVITY_LOG: "activities",
    EventType.MEDICATION_TAKEN: "medications",
    EventType.WELLBEING_LOG: "wellbeing",
}

_COLLECTORS = {
    "vitals": _collect_vitals,
    "symptoms": _collect_symptoms,
    "pain": _collect_pain,
    "sleep": _collect_sleep,
    "nutrition": _collect_nutrition,
    "activities": _collect_activities,
    "medications": _collect_medications,
    "wellbeing": _collect_wellbeing,
    "notes": _collect_notes,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def build_daily_summary(
    db: Session,
    patient_id: uuid.UUID,
    summary_date: date,
) -> dict:
    """Build a deterministic daily summary from source-of-truth records.

    Returns the structured sections dict (not yet persisted).
    """
    day_start = datetime.combine(summary_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = datetime.combine(summary_date, datetime.max.time(), tzinfo=timezone.utc)

    # 1. Fetch all ClinicalEvents for this patient on this date.
    events = db.execute(
        select(ClinicalEvent).where(
            and_(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= day_start,
                ClinicalEvent.event_time <= day_end,
            )
        )
    ).scalars().all()

    if not events:
        return {}

    # 2. Bucket event IDs by category.
    category_event_ids: dict[str, list[uuid.UUID]] = {
        cat: [] for cat in _EVENT_TYPE_CATEGORY.values()
    }
    notes_event_ids: list[uuid.UUID] = []

    for ev in events:
        cat = _EVENT_TYPE_CATEGORY.get(ev.event_type)
        if cat:
            category_event_ids[cat].append(ev.event_id)

        # Notes are stored as WELLBEING_LOG events with a PatientNotePayload
        if ev.event_type == EventType.WELLBEING_LOG:
            notes_event_ids.append(ev.event_id)

    # 3. Collect sections.
    sections: dict = {}

    for cat, collector in _COLLECTORS.items():
        if cat == "notes":
            result = collector(db, notes_event_ids)
        elif cat == "vitals":
            result = collector(db, category_event_ids.get(cat, []), day_start)
        elif cat == "symptoms":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "pain":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "sleep":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "nutrition":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "activities":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "medications":
            result = collector(db, category_event_ids.get(cat, []))
        elif cat == "wellbeing":
            result = collector(db, category_event_ids.get(cat, []))
        else:
            continue

        if result is not None and result != [] and result != {}:
            sections[cat] = result

    # 4. Collect anatomical observations for this day.
    observations = _collect_anatomical_observations(db, patient_id, day_start, day_end)
    if observations:
        sections["observations"] = observations

    return sections


def upsert_daily_summary(
    db: Session,
    patient_id: uuid.UUID,
    summary_date: date,
    *,
    auto_commit: bool = True,
) -> PatientDailySummary:
    """Build and upsert a daily summary for a specific date.

    Idempotent: safe to call multiple times for the same date.
    """
    sections = build_daily_summary(db, patient_id, summary_date)

    # Count events
    day_start = datetime.combine(summary_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = datetime.combine(summary_date, datetime.max.time(), tzinfo=timezone.utc)

    event_count = db.execute(
        select(func.count()).select_from(
            select(ClinicalEvent).where(
                and_(
                    ClinicalEvent.patient_id == patient_id,
                    ClinicalEvent.event_time >= day_start,
                    ClinicalEvent.event_time <= day_end,
                )
            ).subquery()
        )
    ).scalar_one()

    now = datetime.now(timezone.utc)

    stmt = (
        insert(PatientDailySummary)
        .values(
            patient_id=patient_id,
            summary_date=summary_date,
            sections=sections,
            event_count=event_count,
            updated_at=now,
        )
        .on_conflict_do_update(
            index_elements=["patient_id", "summary_date"],
            set_={
                "sections": sections,
                "event_count": event_count,
                "updated_at": now,
            },
        )
        .returning(PatientDailySummary)
    )

    result = db.execute(stmt).scalar_one()

    if auto_commit:
        db.commit()

    logger.info(
        "Daily summary upserted for patient=%s date=%s events=%d",
        patient_id,
        summary_date,
        event_count,
    )

    # Cascade: refresh the longitudinal patient health summary.
    # Best-effort — failure here does not affect the daily summary.
    try:
        from services.summaries.health_summary_service import (
            upsert_health_summary,
        )
        upsert_health_summary(db, patient_id, auto_commit=False)
        if auto_commit:
            db.commit()
    except Exception:
        logger.warning(
            "Health summary cascade update failed for patient=%s",
            patient_id,
            exc_info=True,
        )
        try:
            db.rollback()
        except Exception:
            pass

    return result


def rebuild_daily_summary(
    db: Session,
    patient_id: uuid.UUID,
    summary_date: date,
) -> PatientDailySummary:
    """Rebuild (force refresh) a daily summary. Equivalent to upsert_daily_summary."""
    return upsert_daily_summary(
        db, patient_id, summary_date, auto_commit=True
    )


def get_daily_summary(
    db: Session,
    patient_id: uuid.UUID,
    summary_date: date,
) -> Optional[PatientDailySummary]:
    """Retrieve an existing daily summary if available."""
    return db.execute(
        select(PatientDailySummary).where(
            and_(
                PatientDailySummary.patient_id == patient_id,
                PatientDailySummary.summary_date == summary_date,
            )
        )
    ).scalar_one_or_none()
