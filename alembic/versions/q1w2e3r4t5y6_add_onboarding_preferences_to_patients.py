"""add_onboarding_preferences_to_patients

Revision ID: q1w2e3r4t5y6
Revises: p8e7f33b95a1
Create Date: 2026-09-22

Server mirror of the device-owned onboarding preferences (goals + focus
selections). Both columns are nullable TEXT holding JSON arrays of stable
option ids — pre-existing rows need no backfill. The device is the source
of truth: every profile PUT overwrites these values, and account erasure
already deletes the whole patient row, so no extra privacy handling is
needed. Downgrade drops both columns.

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'q1w2e3r4t5y6'
down_revision: Union[str, Sequence[str], None] = 'p8e7f33b95a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('patients', sa.Column('goals_json', sa.Text(), nullable=True))
    op.add_column('patients', sa.Column('focus_json', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('patients', 'focus_json')
    op.drop_column('patients', 'goals_json')
