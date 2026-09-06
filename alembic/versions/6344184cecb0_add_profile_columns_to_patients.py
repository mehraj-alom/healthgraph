"""add_profile_columns_to_patients

Revision ID: 6344184cecb0
Revises: f7096a8be9f2
Create Date: 2026-09-02 18:50:23.510065

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = '6344184cecb0'
down_revision: Union[str, Sequence[str], None] = 'f7096a8be9f2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('patients', sa.Column('phone_number', sa.String(length=32), nullable=True))
    op.add_column('patients', sa.Column('height_cm', sa.Float(), nullable=True))
    op.add_column('patients', sa.Column('weight_kg', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('patients', 'weight_kg')
    op.drop_column('patients', 'height_cm')
    op.drop_column('patients', 'phone_number')
