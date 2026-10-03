"""Add early_access_signups waitlist table.

Revision ID: ea01earlyaccess
Revises: rx01medsupply
Create Date: 2026-10-04
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = "ea01earlyaccess"
down_revision = "rx01medsupply"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "early_access_signups",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("city", sa.String(length=120), nullable=False),
        sa.Column(
            "source", sa.String(length=40), nullable=False, server_default="landing_page"
        ),
        sa.Column(
            "created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False
        ),
    )
    op.create_index(
        "ix_early_access_signups_email", "early_access_signups", ["email"], unique=True
    )


def downgrade() -> None:
    op.drop_index(
        "ix_early_access_signups_email", table_name="early_access_signups"
    )
    op.drop_table("early_access_signups")
