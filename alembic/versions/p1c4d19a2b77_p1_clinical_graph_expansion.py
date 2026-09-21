"""P1 clinical graph expansion (additive only).

Revision ID: p1c4d19a2b77
Revises: p0f7a21c9e04
Create Date: 2026-09-20

Additive only — nothing dropped, no column altered:
- new tables: condition_occurrences, visits, patient_statements
- medications: purpose_condition_id, reason_statement_id (nullable FKs)
- outbox event_type enum: condition_recorded, visit_recorded,
  statement_recorded (IF NOT EXISTS guarded; PG >= 12 runs this in-txn)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p1c4d19a2b77"
down_revision: Union[str, Sequence[str], None] = "p0f7a21c9e04"
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
    _add_enum_value("condition_recorded")
    _add_enum_value("visit_recorded")
    _add_enum_value("statement_recorded")

    op.create_table(
        "condition_occurrences",
        sa.Column("condition_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("name", sa.String(500), nullable=False),
        sa.Column("normalized_name", sa.String(500), nullable=False),
        sa.Column("terminology", sa.String(50), nullable=True),
        sa.Column("code", sa.String(100), nullable=True),
        sa.Column("display_name", sa.String(500), nullable=True),
        sa.Column("polarity", sa.String(20), nullable=False, server_default="positive"),
        sa.Column("assertion_verification", sa.String(20), nullable=False, server_default="unconfirmed"),
        sa.Column("experiencer", sa.String(20), nullable=False, server_default="patient"),
        sa.Column("clinical_status", sa.String(20), nullable=True),
        sa.Column("source_type", sa.String(40), nullable=False, server_default="PATIENT_REPORTED"),
        sa.Column("verification_status", sa.String(20), nullable=False, server_default="UNVERIFIED"),
        sa.Column("onset_date", sa.Date, nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("source_event_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("clinical_events.event_id"), nullable=True),
        sa.Column("source_document_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("documents.document_id"), nullable=True),
        sa.Column("source_medication_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("medications.medication_id"), nullable=True),
        sa.Column("evidence_text", sa.String(500), nullable=True),
        sa.Column("extraction_method", sa.String(40), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("patient_id", "normalized_name", name="uq_condition_patient_normalized"),
        sa.Index("ix_condition_patient_recorded", "patient_id", "recorded_at"),
    )

    op.create_table(
        "visits",
        sa.Column("visit_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("visit_date", sa.Date, nullable=False),
        sa.Column("visit_type", sa.String(40), nullable=False, server_default="daily-checkin"),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("source", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("patient_id", "visit_date", "visit_type", name="uq_visit_patient_date_type"),
        sa.Index("ix_visit_patient_date", "patient_id", "visit_date"),
    )

    op.create_table(
        "patient_statements",
        sa.Column("statement_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("original_text", sa.Text, nullable=False),
        sa.Column("normalized_topic", sa.String(255), nullable=True),
        sa.Column("value_text", sa.String(500), nullable=True),
        sa.Column("speaker", sa.String(20), nullable=False, server_default="patient"),
        sa.Column("source", sa.String(40), nullable=False, server_default="manual"),
        sa.Column("confidence", sa.Float, nullable=True),
        sa.Column("extraction_method", sa.String(40), nullable=True),
        sa.Column("about_condition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("condition_occurrences.condition_id"), nullable=True),
        sa.Column("source_medication_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("medications.medication_id"), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Index("ix_statement_patient_recorded", "patient_id", "recorded_at"),
    )

    op.add_column("medications", sa.Column("purpose_condition_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("condition_occurrences.condition_id"), nullable=True))
    op.add_column("medications", sa.Column("reason_statement_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patient_statements.statement_id"), nullable=True))


def downgrade() -> None:
    op.drop_column("medications", "reason_statement_id")
    op.drop_column("medications", "purpose_condition_id")
    op.drop_table("patient_statements")
    op.drop_table("visits")
    op.drop_table("condition_occurrences")
    # NOTE: enum labels are intentionally NOT removed — PostgreSQL cannot drop
    # an enum value in-txn without a type recreate. The labels are inert when
    # no outbox rows reference them.
