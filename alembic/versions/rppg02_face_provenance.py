"""Add face-rPPG provenance columns to ppg_measurements (derived only).

Non-destructive, idempotent: adds two nullable columns guarded by an
inspector check so re-runs and partially-applied states are safe.
No existing rows or columns are modified; fingertip PPG data is untouched.
"""

from alembic import op
import sqlalchemy as sa

revision = "rppg02faceprov"
down_revision = "ppg01derivedonly"
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
    # Single transaction: both columns or neither.
    with op.batch_alter_table("ppg_measurements") as batch:
        if not _has_column("ppg_measurements", "model_version"):
            batch.add_column(sa.Column("model_version", sa.String(64), nullable=True))
        if not _has_column("ppg_measurements", "sampling_rate_hz"):
            batch.add_column(sa.Column("sampling_rate_hz", sa.Float(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("ppg_measurements") as batch:
        if _has_column("ppg_measurements", "sampling_rate_hz"):
            batch.drop_column("sampling_rate_hz")
        if _has_column("ppg_measurements", "model_version"):
            batch.drop_column("model_version")
