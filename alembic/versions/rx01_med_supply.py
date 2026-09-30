"""Add supply tracking columns to medications (refill countdown).

Non-destructive, idempotent: three nullable columns guarded by inspector
checks. Existing rows are untouched (NULL = unknown supply: refill UI
hides itself). Powers the refill countdown (doses left / days left) and
the prescription flow's quantity+refills capture.
"""

from alembic import op
import sqlalchemy as sa

revision = "rx01medsupply"
down_revision = "q1w2e3r4t5y6"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    try:
        insp = sa.inspect(bind)
    except sa.exc.NoInspectionAvailable:
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    with op.batch_alter_table("medications") as batch:
        if not _has_column("medications", "supply_quantity"):
            batch.add_column(sa.Column("supply_quantity", sa.Float(), nullable=True))
        if not _has_column("medications", "supply_started_on"):
            batch.add_column(sa.Column("supply_started_on", sa.Date(), nullable=True))
        if not _has_column("medications", "refills_left"):
            batch.add_column(sa.Column("refills_left", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("medications") as batch:
        if _has_column("medications", "refills_left"):
            batch.drop_column("refills_left")
        if _has_column("medications", "supply_started_on"):
            batch.drop_column("supply_started_on")
        if _has_column("medications", "supply_quantity"):
            batch.drop_column("supply_quantity")
