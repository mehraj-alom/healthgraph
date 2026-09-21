"""P4 correction consistency (additive only).

Revision ID: p4a1c7e30d55
Revises: p3f2a66b91c4
Create Date: 2026-09-20

Additive only:
- patient_statements.source_event_id (nullable UUID, FK to
  clinical_events with ON DELETE SET NULL): links daily-note statements
  to their sourcing check-in event so PUT corrections can scope-delete by
  it. History is preserved when events disappear another way.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "p4a1c7e30d55"
down_revision: Union[str, Sequence[str], None] = "p3f2a66b91c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "patient_statements",
        sa.Column(
            "source_event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("clinical_events.event_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("patient_statements", "source_event_id")
