"""allow optional vital values and units

Revision ID: 9c3f2e1a7b4d
Revises: 7a1d2e4f9c10
Create Date: 2026-09-05

"""
from typing import Sequence, Union

from alembic import op


revision: str = "9c3f2e1a7b4d"
down_revision: Union[str, Sequence[str], None] = "7a1d2e4f9c10"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("payload_vital_signs", "value", nullable=True)
    op.alter_column("payload_vital_signs", "unit", nullable=True)


def downgrade() -> None:
    op.alter_column("payload_vital_signs", "unit", nullable=False)
    op.alter_column("payload_vital_signs", "value", nullable=False)