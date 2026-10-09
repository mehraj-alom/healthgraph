"""Add premium_purchases tracking table.

Revision ID: pm01premiumpurchases
Revises: ea01earlyaccess
Create Date: 2026-10-09
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "pm01premiumpurchases"
down_revision = "ea01earlyaccess"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "premium_purchases",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", UUID(as_uuid=True), nullable=False),
        sa.Column("tier", sa.String(length=16), nullable=False),
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default="active",
        ),
        sa.Column(
            "provider",
            sa.String(length=32),
            nullable=False,
            server_default="google_play",
        ),
        sa.Column("product_id", sa.String(length=128), nullable=True),
        sa.Column("entitlement", sa.String(length=64), nullable=True),
        sa.Column("purchase_token", sa.String(length=255), nullable=True),
        sa.Column("order_id", sa.String(length=128), nullable=True),
        sa.Column("environment", sa.String(length=16), nullable=True),
        sa.Column("auto_renewing", sa.Boolean(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["patients.patient_id"], ondelete="CASCADE"
        ),
        sa.UniqueConstraint("purchase_token"),
    )
    op.create_index(
        "ix_premium_purchases_patient_id",
        "premium_purchases",
        ["patient_id"],
    )
    op.create_index(
        "ix_premium_purchases_patient_status",
        "premium_purchases",
        ["patient_id", "status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_premium_purchases_patient_status", table_name="premium_purchases"
    )
    op.drop_index("ix_premium_purchases_patient_id", table_name="premium_purchases")
    op.drop_table("premium_purchases")
