"""P6 per-mention normalization evidence (additive only).

Revision ID: p6b3d91f44a2
Revises: p4a1c7e30d55
Create Date: 2026-09-20

Additive only:
- clinical_events.match_confidence (nullable Float): the combined
  lexical/semantic score behind the AUTO_MATCH, NULL for human or
  non-normalized rows. Alias-learning weights are untouched.
- clinical_events.match_status (nullable String): auto_match | review |
  unknown at extraction time.

Historical rows keep NULLs (scores were never persisted; backfill sets
status only where terminology+code already exist — see
scripts/backfill_p6_match_status.py).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "p6b3d91f44a2"
down_revision: Union[str, Sequence[str], None] = "p4a1c7e30d55"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("clinical_events", sa.Column("match_confidence", sa.Float, nullable=True))
    op.add_column("clinical_events", sa.Column("match_status", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("clinical_events", "match_status")
    op.drop_column("clinical_events", "match_confidence")
