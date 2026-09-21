#!/usr/bin/env python3
"""P6 backfill: match status for pre-P6 normalized rows (idempotent).

Usage:
    python scripts/backfill_p6_match_status.py [--limit N]

Background: per-mention combined scores were never persisted, so historical
rows cannot recover their exact confidence. This script sets deterministic
status only (no invented scores):

- terminology+code present → match_status='auto_match', confidence stays NULL
  with the reason recorded in the log (score was not stored pre-P6).
- concept absent + verification UNVERIFIED → match_status='unknown'.
- HUMAN_VERIFIED rows with a concept → match_status='auto_match'.

Additive metadata only; never touches clinical meaning. Safe to re-run
(rows already stamped are skipped).
"""
import sys

from sqlalchemy import select

from core.db import SessionLocal
from models.events import ClinicalEvent, VerificationStatus
from logger import logger


def backfill(limit: int | None = None):
    db = SessionLocal()
    stamped = 0
    try:
        events = db.execute(
            select(ClinicalEvent)
            .where(ClinicalEvent.match_status.is_(None))
            .limit(limit or 100000)
        ).scalars().all()
        for event in events:
            if event.concept_id is not None:
                # Normalized to a concept (by extraction or human review).
                event.match_status = "auto_match"
                # match_confidence intentionally left NULL: pre-P6 scores
                # were never persisted; do not fabricate.
                stamped += 1
            elif event.verification_status == VerificationStatus.UNVERIFIED:
                event.match_status = "unknown"
                stamped += 1
            # Else (e.g. HUMAN_VERIFIED daily logs without a concept):
            # nothing truthful to claim — stays NULL for a future pass.
        db.commit()
        logger.info(f"P6 match-status backfill complete: {stamped} rows stamped.")
    finally:
        db.close()


if __name__ == "__main__":
    lim = int(sys.argv[sys.argv.index("--limit") + 1]) if "--limit" in sys.argv else None
    backfill(lim)
