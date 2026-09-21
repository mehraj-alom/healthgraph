"""P2 Measurement entity (split from generic Observation/Event).

A Measurement is one quantified clinical reading at a point in time:
labs, vitals, and (future) device readings. Repeated readings are separate
rows — never collapsed — so longitudinal series and trends are plain
ORDER BY measured_at queries (no materialized NEXT chains; see report).

Sources in P2 (all evidence-backed):
- document lab extraction (source_event_id + LabResult link + document)
- manual vital logs (source_event_id + VitalSignPayload link)

interpretation is SYSTEM_DERIVED (flag mapping first, then range
comparison) and is labeled as such wherever surfaced.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Float, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class MeasurementInterpretation(str):
    WITHIN_RANGE = "within_range"
    ABOVE_RANGE = "above_range"
    BELOW_RANGE = "below_range"
    CRITICAL = "critical"
    UNKNOWN = "unknown"


class Measurement(Base, TimestampMixin):
    __tablename__ = "measurements"

    measurement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    # Display name (test/vital name) + normalized series key used for
    # longitudinal grouping ("LOINC|1234-5" or lexical name fallback).
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    series_key: Mapped[str] = mapped_column(String(500), nullable=False, index=True)

    terminology: Mapped[str | None] = mapped_column(String(50), nullable=True)
    code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    value_number: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_text: Mapped[str] = mapped_column(String(500), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)

    range_low: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_high: Mapped[float | None] = mapped_column(Float, nullable=True)
    range_text: Mapped[str | None] = mapped_column(String(255), nullable=True)
    interpretation: Mapped[str] = mapped_column(String(20), nullable=False, default=MeasurementInterpretation.UNKNOWN)
    abnormal_flag: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # occurred (valid time) vs recorded (transaction time) separation.
    measured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    method: Mapped[str | None] = mapped_column(String(40), nullable=True)
    device: Mapped[str | None] = mapped_column(String(128), nullable=True)

    source_type: Mapped[str] = mapped_column(String(40), nullable=False, default="LAB_REPORT")
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="UNVERIFIED")
    polarity: Mapped[str] = mapped_column(String(20), nullable=False, default="positive")
    experiencer: Mapped[str] = mapped_column(String(20), nullable=False, default="patient")

    # Provenance links (one measurement per source event).
    source_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinical_events.event_id"), nullable=True, unique=True
    )
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.document_id"), nullable=True
    )
    evidence_text: Mapped[str | None] = mapped_column(String(500), nullable=True)

    __table_args__ = (Index("ix_measurement_patient_series_time", "patient_id", "series_key", "measured_at"),)
