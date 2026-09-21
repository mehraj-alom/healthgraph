"""P3 longitudinal personal-health domains (additive only).

Revision ID: p3f2a66b91c4
Revises: p2e8b41c7d33
Create Date: 2026-09-20

Additive only — nothing dropped, no column altered:
- new tables: food_scans, food_entries
  (sleep/activity/nutrition/PPG reuse existing payload tables)
- outbox event_type enum: sleep_recorded, activity_recorded,
  nutrition_recorded, food_scan_recorded, ppg_recorded (guarded)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p3f2a66b91c4"
down_revision: Union[str, Sequence[str], None] = "p2e8b41c7d33"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _add_enum_value(label: str) -> None:
    op.execute(
        sa.text(
            "DO $$ BEGIN "
            "IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
            "WHERE t.typname = 'outboxeventtype' AND e.enumlabel = :label) THEN "
            "ALTER TYPE outboxeventtype ADD VALUE :label; "
            "END IF; END $$;"
        ).bindparams(label=label)
    )


def upgrade() -> None:
    for label in ("sleep_recorded", "activity_recorded", "nutrition_recorded",
                  "food_scan_recorded", "ppg_recorded"):
        _add_enum_value(label)

    op.create_table(
        "food_scans",
        sa.Column("scan_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("log_date", sa.Date, nullable=True),
        sa.Column("meal_type", sa.String(20), nullable=True),
        sa.Column("photo_hash", sa.String(128), nullable=True),
        sa.Column("model", sa.String(128), nullable=True),
        sa.Column("model_version", sa.String(64), nullable=True),
        sa.Column("overall_confidence", sa.String(10), nullable=True),
        sa.Column("total_kcal", sa.Integer, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="ai_estimated"),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Index("ix_foodscan_patient_recorded", "patient_id", "recorded_at"),
    )

    op.create_table(
        "food_entries",
        sa.Column("entry_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("scan_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("food_scans.scan_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("portion_g", sa.Float, nullable=True),
        sa.Column("volume_ml", sa.Float, nullable=True),
        sa.Column("kcal", sa.Float, nullable=True),
        sa.Column("protein_g", sa.Float, nullable=True),
        sa.Column("carbs_g", sa.Float, nullable=True),
        sa.Column("fat_g", sa.Float, nullable=True),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("fdc_id", sa.String(32), nullable=True),
        sa.Column("corrected", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("corrected_label", sa.String(255), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("food_entries")
    op.drop_table("food_scans")
    # NOTE: enum labels intentionally retained (see P1 migration note).
