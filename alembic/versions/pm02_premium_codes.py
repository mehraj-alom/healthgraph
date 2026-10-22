"""Add premium_codes redeemable-code table.

Revision ID: pm02premiumcodes
Revises: pm01premiumpurchases
Create Date: 2026-10-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "pm02premiumcodes"
down_revision = "pm01premiumpurchases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "premium_codes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code", sa.String(length=16), nullable=False),
        sa.Column("tier", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="issued",
        ),
        sa.Column("valid_days", sa.Integer(), nullable=False, server_default="30"),
        sa.Column("max_uses", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("uses", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("issued_to_email", sa.String(length=255), nullable=True),
        sa.Column(
            "issued_by",
            sa.String(length=32),
            nullable=False,
            server_default="admin",
        ),
        sa.Column("note", sa.String(length=255), nullable=True),
        sa.Column("redeemed_by", UUID(as_uuid=True), nullable=True),
        sa.Column("redeemed_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["redeemed_by"], ["patients.patient_id"], ondelete="SET NULL"
        ),
        sa.UniqueConstraint("code"),
    )
    op.create_index(
        "ix_premium_codes_code",
        "premium_codes",
        ["code"],
        unique=True,
    )
    op.create_index(
        "ix_premium_codes_status_tier",
        "premium_codes",
        ["status", "tier"],
    )


def downgrade() -> None:
    op.drop_index("ix_premium_codes_status_tier", table_name="premium_codes")
    op.drop_index("ix_premium_codes_code", table_name="premium_codes")
    op.drop_table("premium_codes")
