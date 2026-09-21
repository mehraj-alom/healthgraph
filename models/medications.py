"""First-class Medication entity and MedicationTakenEvent.

Medication is the source of truth for a patient's medication regimen.
MedicationTakenEvent records individual dose-taking history.
"""
import uuid
import enum
from datetime import datetime, date
from sqlalchemy import String, Text, Boolean, Date, DateTime, Enum, ForeignKey, Integer, Float, Index, CheckConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base, TimestampMixin


class MedicationStatus(str, enum.Enum):
    ACTIVE = "ACTIVE"
    SCHEDULED = "SCHEDULED"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    DISCONTINUED = "DISCONTINUED"


class MedicationFrequency(str, enum.Enum):
    ONCE_DAILY = "ONCE_DAILY"
    TWICE_DAILY = "TWICE_DAILY"
    THREE_TIMES_DAILY = "THREE_TIMES_DAILY"
    FOUR_TIMES_DAILY = "FOUR_TIMES_DAILY"
    EVERY_MORNING = "EVERY_MORNING"
    EVERY_EVENING = "EVERY_EVENING"
    EVERY_NIGHT = "EVERY_NIGHT"
    EVERY_8_HOURS = "EVERY_8_HOURS"
    EVERY_12_HOURS = "EVERY_12_HOURS"
    WEEKLY = "WEEKLY"
    AS_NEEDED = "AS_NEEDED"
    CUSTOM = "CUSTOM"


class MedicationRoute(str, enum.Enum):
    ORAL = "ORAL"
    TOPICAL = "TOPICAL"
    INJECTION = "INJECTION"
    INHALED = "INHALED"
    SUBLINGUAL = "SUBLINGUAL"
    RECTAL = "RECTAL"
    NASAL = "NASAL"
    OPHTHALMIC = "OPHTHALMIC"
    OTHER = "OTHER"


class DoseTakenStatus(str, enum.Enum):
    TAKEN = "TAKEN"
    MISSED = "MISSED"
    SKIPPED = "SKIPPED"
    LATE = "LATE"


class Medication(Base, TimestampMixin):
    """A first-class medication entity belonging to a patient.

    This is the source of truth for the medication regimen.
    """
    __tablename__ = "medications"

    medication_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True)

    # Medication identity
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    generic_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    brand_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Dosage
    strength: Mapped[str | None] = mapped_column(String(50), nullable=True)
    strength_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)
    dose_amount: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Route
    route: Mapped[MedicationRoute | None] = mapped_column(Enum(MedicationRoute), nullable=True)

    # Schedule
    frequency: Mapped[MedicationFrequency] = mapped_column(Enum(MedicationFrequency), nullable=False)
    scheduled_times: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # ["08:00", "20:00"]
    scheduled_weekdays: Mapped[list | None] = mapped_column(JSONB, nullable=True)  # [0,1,2,3,4,5,6] for Mon-Sun

    # Duration
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[MedicationStatus] = mapped_column(Enum(MedicationStatus), nullable=False, default=MedicationStatus.ACTIVE)

    # Clinical context
    purpose: Mapped[str | None] = mapped_column(String(500), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    prescriber: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Flags
    prn: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Source tracking
    source_document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.document_id"), nullable=True)

    # P1 graph context links (additive, nullable; maintained by
    # services/clinical/occurrences.sync_medication_graph_context).
    # purpose_condition_id: ConditionOccurrence derived from purpose text.
    # reason_statement_id: PatientStatement when the purpose is user-reported
    #   (no source document). Prescribed purpose != patient-stated reason.
    purpose_condition_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("condition_occurrences.condition_id"), nullable=True
    )
    reason_statement_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("patient_statements.statement_id"), nullable=True
    )

    # P2 regimen version counter (additive; snapshots live in
    # medication_versions, written by services/clinical/versions.py).
    version_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    __table_args__ = (
        Index("ix_medications_patient_status", "patient_id", "status"),
    )


class MedicationTakenEvent(Base, TimestampMixin):
    """An event recording that a dose of a medication was taken.

    References the Medication entity as the source of truth.
    """
    __tablename__ = "medication_taken_events"

    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    medication_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medications.medication_id"), index=True)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True)

    # When the dose was taken
    taken_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    # What was scheduled
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # What was actually taken
    dose_taken: Mapped[float | None] = mapped_column(Float, nullable=True)
    dose_unit: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Status
    status: Mapped[DoseTakenStatus] = mapped_column(Enum(DoseTakenStatus), nullable=False, default=DoseTakenStatus.TAKEN)

    # Notes
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link to the clinical event (for backward compatibility with existing flow)
    clinical_event_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clinical_events.event_id"), nullable=True)

    __table_args__ = (
        Index("ix_medication_taken_patient_time", "patient_id", "taken_at"),
        Index("ix_medication_taken_medication", "medication_id", "taken_at"),
    )