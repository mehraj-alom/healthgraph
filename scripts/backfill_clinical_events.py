#!/usr/bin/env python3
"""
Idempotent backfill: reads existing ClinicalEvents and creates missing
GraphSyncOutbox records for the Neo4j timeline projection pipeline.

Usage (inside docker):
    docker compose exec api python -m scripts.backfill_clinical_events

Or directly:
    python scripts/backfill_clinical_events.py

Safety:
    - Does NOT modify or delete ClinicalEvent records.
    - Does NOT create AnatomicalObservation records.
    - Does NOT create duplicate outbox events (idempotent via event_id).
    - Can be run multiple times safely.
"""
import sys
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text, func

from core.db import SessionLocal
from models.events import ClinicalEvent
from models.outbox import (
    GraphSyncOutbox,
    OutboxEventType,
    OutboxStatus,
    compute_level_number,
)
from logger import logger


def get_existing_outbox_event_ids(db) -> set:
    """Return a set of event_id strings already present in graph_sync_outbox.

    Uses raw SQL with the Python enum NAME (which matches the PostgreSQL
    enum label).  SQLAlchemy sends the enum NAME to PostgreSQL for native
    enum columns.
    """
    # OutboxEventType.CLINICAL_EVENT_RECORDED.name == "CLINICAL_EVENT_RECORDED"
    # which matches the PostgreSQL enum label.
    result = db.execute(
        text(
            "SELECT payload FROM graph_sync_outbox "
            "WHERE event_type = :event_type"
        ),
        {"event_type": OutboxEventType.CLINICAL_EVENT_RECORDED.name},
    )
    rows = result.all()
    return {row[0].get("event_id") for row in rows if isinstance(row[0], dict)}


def backfill():
    db = SessionLocal()
    try:
        event_count = db.execute(select(func.count(ClinicalEvent.event_id))).scalar()
        logger.info(f"Found {event_count} ClinicalEvent records in PostgreSQL.")

        if event_count == 0:
            logger.info("No ClinicalEvents to backfill. Exiting.")
            return

        existing_ids = get_existing_outbox_event_ids(db)
        logger.info(f"Found {len(existing_ids)} existing CLINICAL_EVENT_RECORDED outbox entries.")

        events = db.execute(select(ClinicalEvent)).scalars().all()

        created = 0
        skipped = 0

        for event in events:
            event_id_str = str(event.event_id)

            if event_id_str in existing_ids:
                skipped += 1
                continue

            level_number = compute_level_number(event.event_time)

            outbox = GraphSyncOutbox(
                event_type=OutboxEventType.CLINICAL_EVENT_RECORDED,
                payload={
                    "patient_id": str(event.patient_id),
                    "event_id": event_id_str,
                    "event_type": event.event_type.value,
                    "source_type": event.source_type.value,
                    "verification_status": event.verification_status.value,
                    "event_time": event.event_time.isoformat(),
                    "level_number": level_number,
                },
                status=OutboxStatus.PENDING,
            )
            db.add(outbox)
            created += 1

        if created > 0:
            db.commit()
            logger.info(f"============================================================================="
                f"Backfill complete: created {created} outbox entries, "
                f"skipped {skipped} (already existed)."
            )
        else:
            logger.info("All ClinicalEvents already have outbox entries. Nothing to do.")

        total_outbox = db.execute(
            select(func.count(GraphSyncOutbox.id))
        ).scalar()
        logger.info(f"Total graph_sync_outbox rows: {total_outbox}")

    except Exception:
        db.rollback()
        logger.exception("Backfill failed")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    backfill()
