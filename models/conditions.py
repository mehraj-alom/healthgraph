"""P1 ConditionOccurrence entity.

A ConditionOccurrence is one patient's occurrence of a condition-like fact
(diagnosis, symptom-as-condition, prescription reason). It is NOT a bare
disease concept: polarity / experiencer / verification decide whether it
may be treated as a real patient fact (see models/clinical_assertion.py).

Sources in P1 (all evidence-backed, never inferred):
- document extraction diagnosis sections (source_event_id + document)
- medication purpose text (source_medication_id; prescribed vs stated
  distinguished by source_document_id presence on the medication)
"""
import uuid
from datetime import datetime, timezone, date
from sqlalchemy import String, Text, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class ConditionOccurrence(Base, TimestampMixin):
    __tablename__ = "condition_occurrences"

    condition_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    # Original wording (never overwritten) + normalized dedup key.
    name: Mapped[str] = mapped_column(String(500), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(500), nullable=False)

    # Normalized coding when resolvable (nullable: raw text always kept).
    terminology: Mapped[str | None] = mapped_column(String(50), nullable=True)
    code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # P0 assertion foundation (same semantics as ClinicalEvent).
    polarity: Mapped[str] = mapped_column(String(20), nullable=False, default="positive")
    assertion_verification: Mapped[str] = mapped_column(String(20), nullable=False, default="unconfirmed")
    experiencer: Mapped[str] = mapped_column(String(20), nullable=False, default="patient")
    clinical_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

    source_type: Mapped[str] = mapped_column(String(40), nullable=False, default="PATIENT_REPORTED")
    verification_status: Mapped[str] = mapped_column(String(20), nullable=False, default="UNVERIFIED")

    onset_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Provenance links (all nullable; at least one source is set on create).
    source_event_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("clinical_events.event_id"), nullable=True
    )
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("documents.document_id"), nullable=True
    )
    source_medication_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medications.medication_id"), nullable=True
    )
    evidence_text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    extraction_method: Mapped[str | None] = mapped_column(String(40), nullable=True)

    __table_args__ = (
        UniqueConstraint("patient_id", "normalized_name", name="uq_condition_patient_normalized"),
        Index("ix_condition_patient_recorded", "patient_id", "recorded_at"),
    )
