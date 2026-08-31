#!/usr/bin/env python3
"""
Ensure all OutboxEventType values exist in the PostgreSQL enum type.

This is a one-time safe migration that can be run at application startup
or manually. It is idempotent: running it multiple times has no effect
if the enum values already exist.

Important: SQLAlchemy sends the Python enum NAME (e.g. "CLINICAL_EVENT_RECORDED")
to PostgreSQL, so we must add the NAME as the enum label, not the .value.
"""
import sqlalchemy
from core.db import engine
from models.outbox import OutboxEventType
from logger import logger


def ensure_enum_values():
    """Add any missing OutboxEventType names to the PostgreSQL enum type."""
    enum_type_name = "outboxeventtype"

    with engine.connect() as conn:
        # Check if the enum type exists at all
        result = conn.execute(
            sqlalchemy.text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM pg_type WHERE typname = :name"
                ")"
            ),
            {"name": enum_type_name},
        )
        type_exists = result.scalar()

        if not type_exists:
            logger.info(
                "Enum type '%s' does not exist yet. "
                "It will be created by SQLAlchemy create_all().",
                enum_type_name,
            )
            return

        # Get existing enum labels
        result = conn.execute(
            sqlalchemy.text(
                "SELECT enumlabel FROM pg_enum "
                "JOIN pg_type ON pg_enum.enumtypid = pg_type.oid "
                "WHERE pg_type.typname = :name"
            ),
            {"name": enum_type_name},
        )
        existing_labels = {row[0] for row in result}

        # SQLAlchemy sends the Python enum .name (uppercase) to PostgreSQL.
        # We must add the NAME as the enum label.
        for member in OutboxEventType:
            label = member.name  # e.g. "CLINICAL_EVENT_RECORDED"
            if label not in existing_labels:
                logger.info(
                    "Adding enum label '%s' to PostgreSQL enum '%s'.",
                    label,
                    enum_type_name,
                )
                try:
                    conn.execute(
                        sqlalchemy.text(
                            f"ALTER TYPE {enum_type_name} ADD VALUE :val"
                        ),
                        {"val": label},
                    )
                except Exception as e:
                    # Value may already exist (concurrent migration) — ignore
                    logger.warning("Could not add label '%s': %s", label, e)

        conn.commit()

    logger.info("OutboxEventType enum migration complete.")


if __name__ == "__main__":
    ensure_enum_values()
