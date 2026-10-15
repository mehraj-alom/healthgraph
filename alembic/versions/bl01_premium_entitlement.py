"""Premium entitlement columns on patients (server truth for billing).

Non-destructive, idempotent: two nullable-safe columns guarded by
inspector checks. Existing rows read as Free (tier default 'free',
NULL expiry). Only the billing verify endpoint writes these columns —
never the profile endpoint.
"""

from alembic import op
import sqlalchemy as sa

revision = "bl01premium"
down_revision = "ea01earlyaccess"
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
    with op.batch_alter_table("patients") as batch:
        if not _has_column("patients", "premium_tier"):
            batch.add_column(
                sa.Column("premium_tier", sa.String(20), nullable=False, server_default="free")
            )
        if not _has_column("patients", "premium_expires_at"):
            batch.add_column(sa.Column("premium_expires_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("patients") as batch:
        if _has_column("patients", "premium_expires_at"):
            batch.drop_column("premium_expires_at")
        if _has_column("patients", "premium_tier"):
            batch.drop_column("premium_tier")
