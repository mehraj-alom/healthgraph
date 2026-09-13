"""Add ppg_measurements table (derived on-device camera-PPG only)."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "ppg01derivedonly"
down_revision = "c2a1d3e4f5b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ppg_measurements",
        sa.Column("measurement_id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("patients.patient_id"), nullable=False, index=True),
        sa.Column("measurement_type", sa.String(32), nullable=False, server_default="camera_ppg"),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False, index=True),
        sa.Column("heart_rate_bpm", sa.Float(), nullable=True),
        sa.Column("signal_quality", sa.Float(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=False),
        sa.Column("rmssd_ms", sa.Float(), nullable=True),
        sa.Column("sdnn_ms", sa.Float(), nullable=True),
        sa.Column("rr_intervals_ms", postgresql.JSONB(), nullable=True),
        sa.Column("algorithm_version", sa.String(32), nullable=False),
        sa.Column("reliable", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("ppg_measurements")
