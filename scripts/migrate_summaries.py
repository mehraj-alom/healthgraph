#!/usr/bin/env python3
"""
Migration: create patient_daily_summaries and patient_health_summaries tables.

Run this once after the application starts (or via ``Base.metadata.create_all``).
Idempotent: safe to re-run — skips creation if tables already exist.

Usage:
    python -m scripts.migrate_summaries
"""

import sqlalchemy

from core.db import engine
from models.summaries import PatientDailySummary, PatientHealthSummary
from models.base import Base
from logger import logger


def migrate():
    """Create the summary read-model tables if they do not exist."""
    target_tables = [
        PatientDailySummary.__tablename__,
        PatientHealthSummary.__tablename__,
    ]

    with engine.connect() as conn:
        existing = set(
            row[0]
            for row in conn.execute(
                sqlalchemy.text(
                    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
                )
            ).fetchall()
        )

    tables_to_create = [
        t for t in target_tables if t not in existing
    ]

    if not tables_to_create:
        logger.info("Summary tables already exist — nothing to do.")
        return

    logger.info("Creating summary tables: %s", tables_to_create)

    # Create only the missing summary tables by reflecting needed metadata.
    metadata = Base.metadata
    metadata.create_all(
        bind=engine,
        tables=[
            metadata.tables[name]
            for name in tables_to_create
            if name in metadata.tables
        ],
    )

    logger.info("Summary table migration complete.")


if __name__ == "__main__":
    migrate()
