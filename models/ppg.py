"""On-device camera-PPG derived measurements (compact only).

Privacy: this table stores heart-rate / HRV / quality scalars produced on the
user's phone. It MUST NOT store camera frames, video, or raw PPG streams.
Raw PPG stays on-device unless the user explicitly opts into export.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class PpgMeasurement(Base, TimestampMixin):
    __tablename__ = "ppg_measurements"

    measurement_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("patients.patient_id"), index=True
    )
    measurement_type: Mapped[str] = mapped_column(String(32), default="camera_ppg")
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    heart_rate_bpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    signal_quality: Mapped[float] = mapped_column(Float)
    duration_seconds: Mapped[int] = mapped_column(Integer)
    rmssd_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    sdnn_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    rr_intervals_ms: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    algorithm_version: Mapped[str] = mapped_column(String(32))
    reliable: Mapped[bool] = mapped_column(default=False)
