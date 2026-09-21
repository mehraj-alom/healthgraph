#!/usr/bin/env python3
"""P3 idempotent backfill: first-class domain nodes for pre-P3 rows.

Usage:
    python scripts/backfill_p3_daily_domains.py [--limit N]

What it does (additive only, safe to re-run):
1. Sleep/Activity/Nutrition payload rows → ensure the day's daily-checkin
   Visit exists and enqueue SLEEP/ACTIVITY/NUTRITION_RECORDED (nodes keyed
   by the existing event_id; MERGE-idempotent on re-projection).
2. Symptom events → find-or-create ConditionOccurrence (+ CONDITION_RECORDED).
3. Patient-note payloads → PatientStatement rows (+ STATEMENT_RECORDED).
4. Daily free-text med logs → MEDICATION_TAKEN_RECORDED with canonical
   name linkage (no RESULTS_FROM, no adherence impact).
5. Pain/wellbeing/vital events → re-enqueue CLINICAL_EVENT_RECORDED with
   the day's visit_id so OCCURRED_DURING covers them (TimelineEvent
   projection is MERGE-idempotent; vitals keep their P2 measurements).
6. ppg_measurements rows → day visits + PPG_RECORDED.

Never modifies clinical history rows. Never invents records: every node
derives from an existing PG row.
"""
import sys

from sqlalchemy import select

from core.db import SessionLocal
from models.daily_logs.events import (
    ActivityPayload,
    MedicationTakenPayload,
    NutritionPayload,
    PatientNotePayload,
    SleepPayload,
)
from models.events import ClinicalEvent, EventType
from models.outbox import enqueue_clinical_event, enqueue_medication_taken, enqueue_ppg
from models.ppg import PpgMeasurement
from models.statements import PatientStatement
from models.visits import VisitType
from services.clinical.daily_domains import (
    checkin_visit,
    enqueue_checkin_event,
    project_activity,
    project_daily_meds_taken,
    project_notes_statement,
    project_nutrition,
    project_sleep,
    project_symptom_condition,
)
from logger import logger


def backfill(limit: int | None = None):
    db = SessionLocal()
    stats = {"sleep": 0, "activity": 0, "nutrition": 0, "symptoms": 0,
             "notes": 0, "meds": 0, "relinked": 0, "ppg": 0, "skipped": 0}
    try:
        cap = limit or 100000
        # P7: skip rows that already have live outbox entries (keyed by the
        # entity id each projection MERGEs on). DEAD_LETTER rows are NOT
        # skipped — they need re-enqueueing.
        from models.outbox import OutboxEventType
        from scripts.outbox_guards import existing_outbox_refs

        live = existing_outbox_refs(db, [
            OutboxEventType.CLINICAL_EVENT_RECORDED,
            OutboxEventType.SLEEP_RECORDED,
            OutboxEventType.ACTIVITY_RECORDED,
            OutboxEventType.NUTRITION_RECORDED,
            OutboxEventType.MEDICATION_TAKEN_RECORDED,
            OutboxEventType.PPG_RECORDED,
        ])

        def _live(type_value: str, ref) -> bool:
            return (type_value, str(ref)) in live

        for payload_row, etype, kind in (
            (SleepPayload, EventType.SLEEP_LOG, "sleep"),
            (ActivityPayload, EventType.ACTIVITY_LOG, "activity"),
            (NutritionPayload, EventType.NUTRITION_LOG, "nutrition"),
        ):
            rows = db.execute(select(payload_row).limit(cap)).scalars().all()
            for prow in rows:
                event = db.get(ClinicalEvent, prow.event_id)
                if event is None:
                    continue
                _domain_type = {"sleep": "sleep_recorded", "activity": "activity_recorded",
                                "nutrition": "nutrition_recorded"}[kind]
                if _live("clinical_event_recorded", event.event_id) and _live(_domain_type, event.event_id):
                    stats["skipped"] += 1
                    continue
                visit = _visit_for(db, event)
                enqueue_checkin_event(db, event.patient_id, event, visit)
                if kind == "sleep":
                    project_sleep(db, event.patient_id, event, prow.duration_minutes,
                                  prow.sleep_quality, prow.awakenings, visit)
                elif kind == "activity":
                    project_activity(db, event.patient_id, event, prow.activity_type,
                                     prow.duration_minutes, prow.calories_burned, visit)
                else:
                    project_nutrition(db, event.patient_id, event, prow.water_ml,
                                      prow.meals_count, prow.appetite_level,
                                      prow.calories_kcal, prow.food_label, visit)
                stats[kind] += 1
            db.commit()

        symptoms = db.execute(
            select(ClinicalEvent).where(ClinicalEvent.event_type == EventType.SYMPTOM).limit(cap)
        ).scalars().all()
        for event in symptoms:
            from models.daily_logs.events import SymptomPayload

            prow = db.scalar(select(SymptomPayload).where(SymptomPayload.event_id == event.event_id))
            visit = _visit_for(db, event)
            enqueue_checkin_event(db, event.patient_id, event, visit, concept_id=event.concept_id)
            project_symptom_condition(
                db, event.patient_id, event, event.concept_id,
                prow.severity if prow else None,
                prow.duration_minutes if prow else None,
                prow.safe_notes if prow else None, visit,
            )
            stats["symptoms"] += 1
        db.commit()

        notes = db.execute(select(PatientNotePayload).limit(cap)).scalars().all()
        for prow in notes:
            event = db.get(ClinicalEvent, prow.event_id)
            if event is None:
                continue
            visit = _visit_for(db, event)
            enqueue_checkin_event(db, event.patient_id, event, visit)
            exists = db.scalar(
                select(PatientStatement.statement_id).where(
                    PatientStatement.patient_id == event.patient_id,
                    PatientStatement.original_text == prow.safe_notes,
                )
            )
            if not exists:
                project_notes_statement(db, event.patient_id, prow.safe_notes, visit)
            stats["notes"] += 1
        db.commit()

        meds = db.execute(select(MedicationTakenPayload).limit(cap)).scalars().all()
        for prow in meds:
            event = db.get(ClinicalEvent, prow.event_id)
            if event is None:
                continue
            if _live("clinical_event_recorded", event.event_id) and _live(
                    "medication_taken_recorded", event.event_id):
                stats["skipped"] += 1
                continue
            visit = _visit_for(db, event)
            enqueue_checkin_event(db, event.patient_id, event, visit)
            project_daily_meds_taken(
                db, event.patient_id, event, prow.medication_name,
                prow.dosage_value, prow.dosage_unit, visit,
            )
            stats["meds"] += 1
        db.commit()

        for etype in (EventType.PAIN_LOG, EventType.WELLBEING_LOG, EventType.VITAL_SIGN):
            events = db.execute(
                select(ClinicalEvent).where(ClinicalEvent.event_type == etype).limit(cap)
            ).scalars().all()
            for event in events:
                if _live("clinical_event_recorded", event.event_id):
                    stats["skipped"] += 1
                    continue
                visit = _visit_for(db, event)
                enqueue_checkin_event(db, event.patient_id, event, visit,
                                      concept_id=event.concept_id)
                stats["relinked"] += 1
            db.commit()

        ppgs = db.execute(select(PpgMeasurement).limit(cap)).scalars().all()
        for row in ppgs:
            if _live("ppg_recorded", row.measurement_id):
                stats["skipped"] += 1
                continue
            visit = _visit_for(db, row)
            enqueue_ppg(
                db, measurement_id=row.measurement_id, patient_id=row.patient_id,
                measurement_type=row.measurement_type, heart_rate_bpm=row.heart_rate_bpm,
                rmssd_ms=row.rmssd_ms, sdnn_ms=row.sdnn_ms,
                signal_quality=row.signal_quality, reliable=row.reliable,
                duration_seconds=row.duration_seconds,
                algorithm_version=row.algorithm_version, model_version=row.model_version,
                sampling_rate_hz=row.sampling_rate_hz,
                measured_at=row.measured_at.isoformat() if row.measured_at else None,
                has_rr_intervals=bool(row.rr_intervals_ms),
                visit_id=visit.visit_id,
            )
            stats["ppg"] += 1
        db.commit()

        logger.info(f"P3 daily-domain backfill complete: {stats}")
    finally:
        db.close()


def _visit_for(db, holder):
    from datetime import datetime, timezone

    when = getattr(holder, "event_time", None) or getattr(holder, "measured_at", None)
    if when is None:
        when = datetime.now(timezone.utc)
    return checkin_visit(db, holder.patient_id, when)


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    backfill(lim)
