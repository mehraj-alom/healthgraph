"""add idempotency keys table

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-09-06

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers
revision = "b1c2d3e4f5a6"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "idempotency_keys",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "patient_id",
            UUID(as_uuid=True),
            sa.ForeignKey("patients.patient_id"),
            nullable=False,
        ),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("operation", sa.String(100), nullable=False),
        sa.Column("request_hash", sa.String(64), nullable=False),
        sa.Column("response_json", sa.Text, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="completed"),
        sa.Column("http_status", sa.Integer, nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("patient_id", "key", name="uq_idempotency_patient_key"),
    )
    op.create_index(
        "ix_idempotency_lookup",
        "idempotency_keys",
        ["patient_id", "key"],
    )
    op.create_index(
        "ix_idempotency_expires",
        "idempotency_keys",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_idempotency_expires", table_name="idempotency_keys")
    op.drop_index("ix_idempotency_lookup", table_name="idempotency_keys")
    op.drop_table("idempotency_keys")
