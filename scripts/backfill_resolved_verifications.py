#!/usr/bin/env python3
"""P5 backfill: re-project human-verified events resolved before P5.

Usage:
    python scripts/backfill_resolved_verifications.py [--limit N]

Background: review.py resolve() mutated concept_id/verification_status
without re-enqueueing, so the Neo4j TimelineEvent kept UNVERIFIED props
and no HAS_CODE edge. Since P5, resolve() re-enqueues automatically; this
script repairs rows resolved earlier.

Additive and idempotent: same-id MERGE SET re-projection only (plus the
pg_updated_at recency guard). Safe to re-run.
"""
import sys

from sqlalchemy import select

from core.db import SessionLocal
from models.events import ClinicalEvent, VerificationStatus
from models.ontology import MedicalConcept
from models.outbox import enqueue_clinical_event
from logger import logger


def backfill(limit: int | None = None):
    db = SessionLocal()
    count = 0
    skipped = 0
    try:
        # P7: skip events that already have a live clinical outbox row.
        from models.outbox import OutboxEventType
        from scripts.outbox_guards import existing_outbox_refs

        live = existing_outbox_refs(db, [OutboxEventType.CLINICAL_EVENT_RECORDED])
        events = db.execute(
            select(ClinicalEvent)
            .where(ClinicalEvent.verification_status == VerificationStatus.HUMAN_VERIFIED)
            .limit(limit or 100000)
        ).scalars().all()
        for event in events:
            if ("clinical_event_recorded", str(event.event_id)) in live:
                skipped += 1
                continue
            concept = db.get(MedicalConcept, event.concept_id) if event.concept_id else None
            enqueue_clinical_event(
                db,
                event_id=event.event_id,
                patient_id=event.patient_id,
                event_type=event.event_type,
                source_type=event.source_type,
                verification_status=event.verification_status,
                event_time=event.event_time,
                polarity=event.polarity,
                assertion_verification=event.assertion_verification,
                experiencer=event.experiencer,
                clinical_status=event.clinical_status,
                source_snippet=event.source_snippet,
                concept_id=event.concept_id,
                concept_system=concept.terminology if concept else None,
                concept_code=concept.code if concept else None,
                concept_display=concept.display_name if concept else None,
                pg_updated_at=event.updated_at.isoformat() if event.updated_at else None,
            )
            count += 1
        db.commit()
        logger.info(f"Resolved-verification backfill complete: {count} events re-enqueued, {skipped} skipped.")
    finally:
        db.close()


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    backfill(lim)
