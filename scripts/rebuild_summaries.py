#!/usr/bin/env python3
"""
Rebuild / recovery tool for the Patient Summary read-model layer.

Usage:

    # Rebuild all summaries for all patients
    python -m scripts.rebuild_summaries --all

    # Rebuild all summaries for a specific patient
    python -m scripts.rebuild_summaries --patient <patient_uuid>

    # Rebuild daily summary for a specific patient and date
    python -m scripts.rebuild_summaries --patient <patient_uuid> --date 2024-01-15

    # Rebuild only the longitudinal health summary for a patient
    python -m scripts.rebuild_summaries --patient <patient_uuid> --health-only

This script reads from the source-of-truth ClinicalEvent + payload tables
and rebuilds the summary read models.  It is safe to run at any time.
"""

import argparse
import sys
import uuid
from datetime import date

from sqlalchemy import func, select

from core.db import SessionLocal
from models.events import ClinicalEvent
from models.identity import Patient
from services.summaries.daily_summary_service import rebuild_daily_summary
from services.summaries.health_summary_service import rebuild_health_summary
from logger import logger


def rebuild_for_patient(
    db,
    patient_id: uuid.UUID,
    target_date: date | None = None,
    health_only: bool = False,
) -> dict:
    """Rebuild summaries for a single patient."""
    result = {
        "patient_id": str(patient_id),
        "daily_summaries_rebuilt": 0,
        "health_summary_rebuilt": False,
    }

    if not health_only:
        if target_date:
            rebuild_daily_summary(db, patient_id, target_date)
            result["daily_summaries_rebuilt"] = 1
            logger.info(
                "Rebuilt daily summary for patient=%s date=%s",
                patient_id,
                target_date,
            )
        else:
            # Find all unique event dates
            date_rows = db.execute(
                select(
                    func.date_trunc("day", ClinicalEvent.event_time).label("day")
                )
                .where(ClinicalEvent.patient_id == patient_id)
                .group_by(func.date_trunc("day", ClinicalEvent.event_time))
                .order_by(func.date_trunc("day", ClinicalEvent.event_time))
            ).all()

            for row in date_rows:
                if row.day:
                    rebuild_daily_summary(db, patient_id, row.day.date())
                    result["daily_summaries_rebuilt"] += 1

            logger.info(
                "Rebuilt %d daily summaries for patient=%s",
                result["daily_summaries_rebuilt"],
                patient_id,
            )

    # Always rebuild health summary
    rebuild_health_summary(db, patient_id)
    result["health_summary_rebuilt"] = True
    logger.info("Rebuilt health summary for patient=%s", patient_id)

    return result


def rebuild_all(db, target_date: date | None = None) -> list[dict]:
    """Rebuild summaries for all patients."""
    patients = db.execute(select(Patient.patient_id)).scalars().all()
    results = []

    for pid in patients:
        logger.info("Processing patient=%s", pid)
        result = rebuild_for_patient(db, pid, target_date)
        results.append(result)

    return results


def main():
    parser = argparse.ArgumentParser(
        description="Rebuild Patient Summary read models from source-of-truth data."
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Rebuild summaries for all patients.",
    )
    parser.add_argument(
        "--patient",
        type=str,
        help="Patient UUID to rebuild summaries for.",
    )
    parser.add_argument(
        "--date",
        type=str,
        help="Specific date (YYYY-MM-DD) to rebuild daily summary for.",
    )
    parser.add_argument(
        "--health-only",
        action="store_true",
        help="Only rebuild the longitudinal health summary.",
    )

    args = parser.parse_args()

    if not args.all and not args.patient:
        parser.error("Either --all or --patient <uuid> is required.")

    target_date = None
    if args.date:
        target_date = date.fromisoformat(args.date)

    db = SessionLocal()
    try:
        if args.all:
            results = rebuild_all(db, target_date)
            print(f"\nRebuilt summaries for {len(results)} patients.")
        else:
            patient_id = uuid.UUID(args.patient)
            result = rebuild_for_patient(
                db, patient_id, target_date, args.health_only
            )
            print(f"\nResult: {result}")

        print("Done.")
    except Exception:
        logger.exception("Rebuild failed")
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
