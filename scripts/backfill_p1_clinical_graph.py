#!/usr/bin/env python3
"""P1 idempotent backfill: project pre-P1 rows into the expanded graph.

Usage:
    python scripts/backfill_p1_clinical_graph.py [--limit N]

What it does (additive only, safe to re-run):
1. Medications with a purpose but no purpose_condition_id → derive the
   purpose condition + reason statement (prescribed vs stated split) and
   re-enqueue MEDICATION_RECORDED so the MedicationRequest subgraph
   (PRESCRIBES / PRESCRIBED_FOR / REASON_STATED_BY_PATIENT) projects.
2. MedicationTakenEvents without a visit-linked outbox row → attach the
   deterministic daily-checkin Visit and re-enqueue
   MEDICATION_TAKEN_RECORDED (RESULTS_FROM + OCCURRED_DURING).
3. DIAGNOSIS ClinicalEvents → ensure a ConditionOccurrence (+ document
   Visit) exists and enqueue CONDITION_RECORDED.

It never modifies clinical history rows (only fills the nullable
purpose_condition_id / reason_statement_id links) and never deletes.
"""
import sys
from datetime import datetime, timezone

from sqlalchemy import select, func

from core.db import SessionLocal
from models.events import ClinicalEvent, EventType
from models.medications import Medication, MedicationTakenEvent
from models.outbox import enqueue_medication, enqueue_medication_taken
from models.visits import VisitType
from services.clinical.occurrences import (
    find_or_create_condition,
    get_or_create_visit,
    sync_medication_graph_context,
)
from logger import logger


def backfill(limit: int | None = None):
    db = SessionLocal()
    stats = {"medications": 0, "taken": 0, "conditions": 0}
    try:
        meds = db.execute(
            select(Medication)
            .where(Medication.purpose.is_not(None), Medication.purpose_condition_id.is_(None))
            .limit(limit or 100000)
        ).scalars().all()
        for med in meds:
            sync_medication_graph_context(db, med)
            cond_name = None
            if med.purpose_condition_id is not None:
                from models.conditions import ConditionOccurrence

                cond = db.get(ConditionOccurrence, med.purpose_condition_id)
                cond_name = cond.name if cond else med.purpose
            enqueue_medication(
                db, medication_id=med.medication_id, patient_id=med.patient_id,
                name=med.name, generic_name=med.generic_name, brand_name=med.brand_name,
                strength=med.strength, strength_unit=med.strength_unit,
                dose_amount=med.dose_amount, dose_unit=med.dose_unit,
                route=med.route.value if med.route else None,
                frequency=med.frequency.value if hasattr(med.frequency, "value") else str(med.frequency),
                scheduled_times=med.scheduled_times,
                start_date=med.start_date.isoformat() if med.start_date else None,
                end_date=med.end_date.isoformat() if med.end_date else None,
                status=med.status.value if hasattr(med.status, "value") else str(med.status),
                purpose=med.purpose, instructions=med.instructions, prescriber=med.prescriber,
                prn=med.prn, reminder_enabled=med.reminder_enabled, notes=med.notes,
                source_document_id=med.source_document_id,
                purpose_condition_id=med.purpose_condition_id,
                purpose_condition_name=cond_name,
                reason_statement_id=med.reason_statement_id,
            )
            stats["medications"] += 1
        db.commit()

        taken = db.execute(
            select(MedicationTakenEvent).order_by(MedicationTakenEvent.taken_at.desc()).limit(limit or 100000)
        ).scalars().all()
        # P7: skip rows that already have a live taken outbox entry.
        from models.outbox import OutboxEventType
        from scripts.outbox_guards import existing_outbox_refs

        _live_taken = existing_outbox_refs(db, [OutboxEventType.MEDICATION_TAKEN_RECORDED])
        for t in taken:
            if ("medication_taken_recorded", str(t.event_id)) in _live_taken:
                continue
            visit = get_or_create_visit(db, t.patient_id, t.taken_at, VisitType.DAILY_CHECKIN, source="medication-taken")
            enqueue_medication_taken(
                db, event_id=t.event_id, patient_id=t.patient_id, medication_id=t.medication_id,
                taken_at=t.taken_at.isoformat() if t.taken_at else datetime.now(timezone.utc).isoformat(),
                scheduled_for=t.scheduled_for.isoformat() if t.scheduled_for else None,
                dose_taken=t.dose_taken, dose_unit=t.dose_unit,
                status=t.status.value if hasattr(t.status, "value") else str(t.status),
                notes=t.notes, visit_id=visit.visit_id,
            )
            stats["taken"] += 1
        db.commit()

        diags = db.execute(
            select(ClinicalEvent).where(ClinicalEvent.event_type == EventType.DIAGNOSIS).limit(limit or 100000)
        ).scalars().all()
        for e in diags:
            from models.events import EvidenceLink

            evidence = db.scalar(select(EvidenceLink).where(EvidenceLink.event_id == e.event_id))
            name = (evidence.extracted_text if evidence else None) or (e.source_snippet or "diagnosis")
            visit = get_or_create_visit(
                db, e.patient_id, e.event_time, VisitType.DOCUMENT,
                source=str(evidence.document_id) if evidence else None,
            )
            find_or_create_condition(
                db, e.patient_id, name.strip()[:500],
                terminology=None, code=None, display_name=None,
                source_type=e.source_type.value if hasattr(e.source_type, "value") else str(e.source_type),
                verification_status=e.verification_status.value if hasattr(e.verification_status, "value") else str(e.verification_status),
                onset_date=e.event_time.date() if e.event_time else None,
                recorded_at=e.event_time,
                source_event_id=e.event_id,
                source_document_id=evidence.document_id if evidence else None,
                evidence_text=(evidence.extracted_text if evidence else e.source_snippet or "")[:500],
                extraction_method="ADE",
                visit_id=visit.visit_id,
            )
            stats["conditions"] += 1
        db.commit()
        logger.info(f"P1 backfill complete: {stats}")
    finally:
        db.close()


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    backfill(lim)
