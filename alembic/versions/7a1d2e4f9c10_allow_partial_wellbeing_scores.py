"""allow partial wellbeing scores

Revision ID: 7a1d2e4f9c10
Revises: 6344184cecb0
Create Date: 2026-09-03

"""
from typing import Sequence, Union

from alembic import op


revision: str = "7a1d2e4f9c10"
down_revision: Union[str, Sequence[str], None] = "6344184cecb0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("payload_wellbeing", "overall_wellbeing", nullable=True)
    op.alter_column("payload_wellbeing", "energy_level", nullable=True)
    op.alter_column("payload_wellbeing", "stress_level", nullable=True)


def downgrade() -> None:
    op.alter_column("payload_wellbeing", "stress_level", nullable=False)
    op.alter_column("payload_wellbeing", "energy_level", nullable=False)
    op.alter_column("payload_wellbeing", "overall_wellbeing", nullable=False)
