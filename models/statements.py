"""P1 PatientStatement entity.

A PatientStatement preserves what the patient said, as said. It is truth
about the utterance — never a confirmed clinical fact. Consumers must use
the ABOUT link's target with USER_REPORTED evidence level and must never
upgrade a statement into a diagnosis without HUMAN_VERIFIED corroboration.

P1 sources (all evidence-backed):
- medication purpose text on manually-entered regimens (source_medication_id)
- explicit POST /api/v1/statements recordings (P1 minimal endpoint)
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Float, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class PatientStatement(Base, TimestampMixin):
    __tablename__ = "patient_statements"

    statement_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    original_text: Mapped[str] = mapped_column(Text, nullable=False)
    normalized_topic: Mapped[str | None] = mapped_column(String(255), nullable=True)
    value_text: Mapped[str | None] = mapped_column(String(500), nullable=True)

    speaker: Mapped[str] = mapped_column(String(20), nullable=False, default="patient")
    source: Mapped[str] = mapped_column(String(40), nullable=False, default="manual")
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    extraction_method: Mapped[str | None] = mapped_column(String(40), nullable=True)

    # P4: link to the sourcing check-in event when created from a daily
    # note (SET NULL on event delete — statement history is preserved while
    # corrections can scope-delete by this link; no DB-level cascade).
    source_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinical_events.event_id", ondelete="SET NULL"), nullable=True
    )
    about_condition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("condition_occurrences.condition_id"), nullable=True
    )
    source_medication_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medications.medication_id"), nullable=True
    )

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_statement_patient_recorded", "patient_id", "recorded_at"),)
