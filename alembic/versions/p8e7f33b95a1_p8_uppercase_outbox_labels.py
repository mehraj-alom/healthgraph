"""P8 repair: uppercase outbox enum labels (additive-safe).

Revision ID: p8e7f33b95a1
Revises: p8d4f02a17c9
Create Date: 2026-09-20

Background (found by real-DB execution in P8): SQLAlchemy persists
SQLEnum(OutboxEventType) members by NAME (e.g. 'VISIT_RECORDED'), but the
P1/P2 migrations added the lowercase VALUES ('visit_recorded'). The legacy
labels in live databases are a mix of both conventions, so every P1+
outbox insert — and the P5 GRAPH_NODE_RETIRED insert — fails with
"invalid input value for enum outboxeventtype" on real databases while
passing all DB-less unit tests.

This repair adds the uppercase NAME labels for every post-P0 member.
Idempotent (IF NOT EXISTS) and non-destructive: the lowercase duplicates
stay (removing enum labels requires a type recreate; they are inert).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "p8e7f33b95a1"
down_revision: Union[str, Sequence[str], None] = "p8d4f02a17c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MISSING_UPPER_LABELS = (
    "CONDITION_RECORDED",
    "VISIT_RECORDED",
    "STATEMENT_RECORDED",
    "MEASUREMENT_RECORDED",
    "MEDICATION_VERSION_RECORDED",
    "SLEEP_RECORDED",
    "ACTIVITY_RECORDED",
    "NUTRITION_RECORDED",
    "FOOD_SCAN_RECORDED",
    "PPG_RECORDED",
    "GRAPH_NODE_RETIRED",
)


def upgrade() -> None:
    for label in _MISSING_UPPER_LABELS:
        op.execute(
            sa.text(
                "DO $$ BEGIN "
                "IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid "
                "WHERE t.typname = 'outboxeventtype' AND e.enumlabel = :label) THEN "
                "ALTER TYPE outboxeventtype ADD VALUE :label; "
                "END IF; END $$;"
            ).bindparams(label=label)
        )


def downgrade() -> None:
    # Labels intentionally retained (see P1 migration note).
    pass
