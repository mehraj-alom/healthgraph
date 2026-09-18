"""add calories_kcal and food_label to payload_nutrition

Revision ID: e7f8a9b0c1d2
Revises: rppg02faceprov
Create Date: 2026-09-18

"""

from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "rppg02faceprov"
branch_labels = None
depends_on = None


def _has_column(table: str, column: str) -> bool:
    bind = op.get_bind()
    try:
        insp = sa.inspect(bind)
    except sa.exc.NoInspectionAvailable:
        # Offline (--sql) rendering has no live connection: assume the
        # column is missing so the ADD COLUMN renders for review.
        return False
    return any(c["name"] == column for c in insp.get_columns(table))


def upgrade() -> None:
    with op.batch_alter_table("payload_nutrition") as batch:
        if not _has_column("payload_nutrition", "calories_kcal"):
            batch.add_column(sa.Column("calories_kcal", sa.Integer(), nullable=True))
        if not _has_column("payload_nutrition", "food_label"):
            batch.add_column(sa.Column("food_label", sa.String(255), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("payload_nutrition") as batch:
        if _has_column("payload_nutrition", "food_label"):
            batch.drop_column("food_label")
        if _has_column("payload_nutrition", "calories_kcal"):
            batch.drop_column("calories_kcal")
