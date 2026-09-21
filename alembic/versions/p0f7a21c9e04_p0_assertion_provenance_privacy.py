"""P0 assertion / provenance / privacy foundations (additive only).

Revision ID: p0f7a21c9e04
Revises: e7f8a9b0c1d2
Create Date: 2026-09-19

Additive/nullable only — no existing column altered, nothing dropped:
- clinical_events: polarity, assertion_verification, experiencer,
  clinical_status, source_snippet (nullable)
- anatomical_observations: polarity, experiencer, source_snippet (nullable)
- raw_extraction: extraction_model, extraction_prompt_hash (nullable)
- new tables: consent_receipts, data_subject_requests, audit_events
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p0f7a21c9e04"
down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinical_events", sa.Column("polarity", sa.String(20), nullable=True))
    op.add_column("clinical_events", sa.Column("assertion_verification", sa.String(20), nullable=True))
    op.add_column("clinical_events", sa.Column("experiencer", sa.String(20), nullable=True))
    op.add_column("clinical_events", sa.Column("clinical_status", sa.String(20), nullable=True))
    op.add_column("clinical_events", sa.Column("source_snippet", sa.String(500), nullable=True))

    op.add_column("anatomical_observations", sa.Column("polarity", sa.String(20), nullable=True))
    op.add_column("anatomical_observations", sa.Column("experiencer", sa.String(20), nullable=True))
    op.add_column("anatomical_observations", sa.Column("source_snippet", sa.String(500), nullable=True))

    op.add_column("raw_extraction", sa.Column("extraction_model", sa.String(128), nullable=True))
    op.add_column("raw_extraction", sa.Column("extraction_prompt_hash", sa.String(64), nullable=True))

    op.create_table(
        "consent_receipts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("scope", sa.String(40), nullable=False),
        sa.Column("notice_version", sa.String(64), nullable=False),
        sa.Column("notice_hash", sa.String(128), nullable=True),
        sa.Column("granted", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("age_confirmed_18_plus", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_guardian_consent", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("method", sa.String(40), nullable=False, server_default="app"),
        sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Index("ix_consent_patient_scope", "patient_id", "scope"),
    )

    op.create_table(
        "data_subject_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("request_type", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("details", postgresql.JSONB, nullable=True),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fulfilled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Index("ix_dsr_patient_status", "patient_id", "status"),
    )

    op.create_table(
        "audit_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=True, index=True),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("entity_type", sa.String(80), nullable=True),
        sa.Column("entity_id", sa.String(128), nullable=True),
        sa.Column("meta", postgresql.JSONB, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Index("ix_audit_patient_action", "patient_id", "action"),
    )


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("data_subject_requests")
    op.drop_table("consent_receipts")
    op.drop_column("raw_extraction", "extraction_prompt_hash")
    op.drop_column("raw_extraction", "extraction_model")
    op.drop_column("anatomical_observations", "source_snippet")
    op.drop_column("anatomical_observations", "experiencer")
    op.drop_column("anatomical_observations", "polarity")
    op.drop_column("clinical_events", "source_snippet")
    op.drop_column("clinical_events", "clinical_status")
    op.drop_column("clinical_events", "experiencer")
    op.drop_column("clinical_events", "assertion_verification")
    op.drop_column("clinical_events", "polarity")
