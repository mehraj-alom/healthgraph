#!/usr/bin/env python3
"""P2 idempotent backfill: first-class Measurements for pre-P2 rows.

Usage:
    python scripts/backfill_p2_measurements.py [--limit N]

What it does (additive only, safe to re-run):
1. LabResult rows with no Measurement (anti-join on source_event_id) →
   parse value/range, derive interpretation, create Measurement +
   enqueue MEASUREMENT_RECORDED (visit: document visit by event date).
2. VitalSignPayload rows with no Measurement → create Measurement +
   enqueue (visit: daily-checkin by event date).

Regimen versions are NOT backfilled (no history to invent — v1 baselines
form on the next mutation). Never modifies existing rows.
"""
import sys

from sqlalchemy import select

from core.db import SessionLocal
from models.daily_logs.events import VitalSignPayload
from models.events import ClinicalEvent, LabResult
from models.measurements import Measurement
from models.ontology import MedicalConcept
from models.visits import VisitType
from services.clinical.measurements import create_lab_measurement, create_vital_measurement
from services.clinical.occurrences import get_or_create_visit
from logger import logger


def backfill(limit: int | None = None):
    db = SessionLocal()
    stats = {"labs": 0, "vitals": 0}
    try:
        labs = db.execute(select(LabResult).limit(limit or 100000)).scalars().all()
        for lab in labs:
            exists = db.scalar(
                select(Measurement.measurement_id).where(Measurement.source_event_id == lab.event_id)
            )
            if exists:
                continue
            event = db.get(ClinicalEvent, lab.event_id)
            if event is None:
                continue
            concept = db.get(MedicalConcept, event.concept_id) if event.concept_id else None
            name = (concept.display_name if concept else None) or "lab result"
            visit = get_or_create_visit(
                db, event.patient_id, event.event_time, VisitType.DOCUMENT, source=None
            )
            from models.events import EvidenceLink

            evidence = db.scalar(select(EvidenceLink).where(EvidenceLink.event_id == event.event_id))
            doc_id = evidence.document_id if evidence else None
            create_lab_measurement(
                db,
                patient_id=event.patient_id,
                name=name,
                value=lab.value,
                unit=lab.unit,
                ref_range=lab.reference_range,
                abnormal_flag=lab.abnormal_flag,
                terminology=concept.terminology if concept else None,
                code=concept.code if concept else None,
                display_name=concept.display_name if concept else None,
                measured_at=event.event_time,
                source_event_id=event.event_id,
                source_document_id=doc_id,
                evidence_text=(evidence.extracted_text if evidence else event.source_snippet or "")[:500],
                visit_id=visit.visit_id,
            )
            stats["labs"] += 1
        db.commit()

        vitals = db.execute(select(VitalSignPayload).limit(limit or 100000)).scalars().all()
        for payload in vitals:
            exists = db.scalar(
                select(Measurement.measurement_id).where(Measurement.source_event_id == payload.event_id)
            )
            if exists:
                continue
            event = db.get(ClinicalEvent, payload.event_id)
            if event is None:
                continue
            concept = db.get(MedicalConcept, event.concept_id) if event.concept_id else None
            visit = get_or_create_visit(
                db, event.patient_id, event.event_time, VisitType.DAILY_CHECKIN, source="daily-checkin"
            )
            create_vital_measurement(
                db,
                patient_id=event.patient_id,
                name=(concept.display_name if concept else None) or "vital",
                concept_display=concept.display_name if concept else None,
                value_number=payload.value,
                value_text=str(payload.value) if payload.value is not None else "",
                unit=payload.unit,
                terminology=concept.terminology if concept else None,
                code=concept.code if concept else None,
                measured_at=event.event_time,
                source_event_id=event.event_id,
                visit_id=visit.visit_id,
            )
            stats["vitals"] += 1
        db.commit()
        logger.info(f"P2 measurement backfill complete: {stats}")
    finally:
        db.close()


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    backfill(lim)
