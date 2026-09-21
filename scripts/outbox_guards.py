"""Shared idempotency guards for backfill scripts (P7).

Backfills re-enqueue rows that live paths may already have enqueued. The
graph projection is MERGE-idempotent so duplicates are safe but wasteful
(outbox table growth + 60s drain amplification). These helpers let each
backfill skip rows that already have a matching PENDING/PROCESSING/
PROCESSED outbox entry, keyed by the entity id found in the payload.
"""
from sqlalchemy import select

from models.outbox import GraphSyncOutbox, OutboxStatus

_REF_KEYS = (
    "event_id", "observation_id", "medication_id", "condition_id",
    "visit_id", "statement_id", "measurement_id", "scan_id",
    "version_id", "node_id",
)


def existing_outbox_refs(db, event_types) -> set:
    """Return {(event_type_value, ref)} for live outbox rows.

    Callers pass OutboxEventType members. DEAD_LETTER rows are excluded on
    purpose: a failed row needs re-enqueueing, not skipping.
    """
    rows = db.execute(
        select(GraphSyncOutbox.event_type, GraphSyncOutbox.payload).where(
            GraphSyncOutbox.event_type.in_(list(event_types)),
            GraphSyncOutbox.status != OutboxStatus.DEAD_LETTER,
        )
    ).all()
    out = set()
    for event_type, payload in rows:
        if not isinstance(payload, dict):
            continue
        et = event_type.value if hasattr(event_type, "value") else str(event_type)
        for key in _REF_KEYS:
            if payload.get(key):
                out.add((et, str(payload[key])))
    return out
