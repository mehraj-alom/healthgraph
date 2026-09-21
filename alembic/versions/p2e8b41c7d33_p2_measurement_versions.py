"""P2 measurement split + regimen version history (additive only).

Revision ID: p2e8b41c7d33
Revises: p1c4d19a2b77
Create Date: 2026-09-20

Additive only — nothing dropped, no column altered:
- new tables: measurements, medication_versions
- medications: version_number (non-null, default 1)
- outbox event_type enum: measurement_recorded,
  medication_version_recorded (IF NOT EXISTS guarded)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p2e8b41c7d33"
down_revision: Union[str, Sequence[str], None] = "p1c4d19a2b77"
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
    _add_enum_value("measurement_recorded")
    _add_enum_value("medication_version_recorded")

    op.create_table(
        "measurements",
        sa.Column("measurement_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("series_key", sa.String(500), nullable=False, index=True),
        sa.Column("terminology", sa.String(50), nullable=True),
        sa.Column("code", sa.String(100), nullable=True),
        sa.Column("display_name", sa.String(500), nullable=True),
        sa.Column("value_number", sa.Float, nullable=True),
        sa.Column("value_text", sa.String(500), nullable=False),
        sa.Column("unit", sa.String(50), nullable=True),
        sa.Column("range_low", sa.Float, nullable=True),
        sa.Column("range_high", sa.Float, nullable=True),
        sa.Column("range_text", sa.String(255), nullable=True),
        sa.Column("interpretation", sa.String(20), nullable=False, server_default="unknown"),
        sa.Column("abnormal_flag", sa.String(20), nullable=True),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("method", sa.String(40), nullable=True),
        sa.Column("device", sa.String(128), nullable=True),
        sa.Column("source_type", sa.String(40), nullable=False, server_default="LAB_REPORT"),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="UNVERIFIED"),
        sa.Column("polarity", sa.String(20), nullable=False, server_default="positive"),
        sa.Column("experiencer", sa.String(20), nullable=False, server_default="patient"),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinical_events.event_id"), nullable=True, unique=True),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.document_id"), nullable=True),
        sa.Column("evidence_text", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Index("ix_measurement_patient_series_time", "patient_id", "series_key", "measured_at"),
    )

    op.create_table(
        "medication_versions",
        sa.Column("version_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("medication_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("medications.medication_id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("version_number", sa.Integer, nullable=False),
        sa.Column("snapshot", postgresql.JSONB, nullable=False),
        sa.Column("change_reason", sa.Text, nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("medication_id", "version_number", name="uq_med_version_number"),
        sa.Index("ix_med_version_patient", "patient_id", "medication_id"),
    )

    op.add_column("medications", sa.Column("version_number", sa.Integer, nullable=False, server_default="1"))


def downgrade() -> None:
    op.drop_column("medications", "version_number")
    op.drop_table("medication_versions")
    op.drop_table("measurements")
    # NOTE: enum labels intentionally retained (see P1 migration note).
