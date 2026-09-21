"""Clinical Event Foundation"""
import uuid
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import Enum, ForeignKey, DateTime, String, Float, LargeBinary, UniqueConstraint
from sqlalchemy.sql import func
from models.base import Base, TimestampMixin

class EventType(str, enum.Enum):
    LAB_RESULT = "LAB_RESULT"
    MEDICATION_PRESCRIBED = "MEDICATION_PRESCRIBED"
    MEDICATION_TAKEN = "MEDICATION_TAKEN"
    SYMPTOM = "SYMPTOM"
    DIAGNOSIS = "DIAGNOSIS"
    VITAL_SIGN = "VITAL_SIGN"
    WELLBEING_LOG = "wellbeing_log" ## Mood, Energy, Stress
    PROCEDURE = "procedure"
    PRESCRIPTION = "prescription"
    IMAGING_RESULT = "imaging_result"
    IMMUNIZATION = "immunization"
    PAIN_LOG = "pain_log"            # Specific body mapping  
    SLEEP_LOG = "sleep_log"
    ACTIVITY_LOG = "activity_log"    # Exercise, Steps
    NUTRITION_LOG = "nutrition_log"  # Meals, Hydration
    MENSTRUAL_LOG = "menstrual_log"

class SourceType(str, enum.Enum):
    PATIENT_REPORTED = "PATIENT_REPORTED"
    AI_INFERRED = "AI_INFERRED"
    DOCTOR_ENTERED = "DOCTOR_ENTERED"
    IMAGING_REPORT = "IMAGING_REPORT"
    LAB_REPORT = "LAB_REPORT"
    DEVICE_WEARABLE = "DEVICE_WEARABLE"

class VerificationStatus(str, enum.Enum):
    EXTRACTED = "EXTRACTED"
    UNVERIFIED = "UNVERIFIED"
    HUMAN_VERIFIED = "HUMAN_VERIFIED"

class ClinicalEvent(Base, TimestampMixin):
    __tablename__ = "clinical_events"
    
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True)
    concept_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_concepts.id"), nullable=True)
    
    event_type: Mapped[EventType] = mapped_column(Enum(EventType))
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType))
    verification_status: Mapped[VerificationStatus] = mapped_column(Enum(VerificationStatus))
    
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True, nullable=True)

    # P0 assertion foundation (additive, nullable). ConText-lite classification
    # of the source mention so negated / hypothetical / historical / family
    # statements are never mistaken for confirmed active patient facts.
    # See models/clinical_assertion.py.
    polarity: Mapped[str | None] = mapped_column(String(20), nullable=True)
    assertion_verification: Mapped[str | None] = mapped_column(String(20), nullable=True)
    experiencer: Mapped[str | None] = mapped_column(String(20), nullable=True)
    clinical_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    source_snippet: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # P6 per-mention normalization evidence (additive, nullable). The
    # combined lexical/semantic score + status behind an AUTO_MATCH, kept
    # separate from the alias-learning confidence weight. NULL for human
    # or non-normalized rows; original text is never overwritten.
    match_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    match_status: Mapped[str | None] = mapped_column(String(20), nullable=True)

class LabResult(Base):
    __tablename__ = "lab_results"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id"), primary_key=True)
    value: Mapped[str] = mapped_column(String)
    unit: Mapped[str] = mapped_column(String, nullable=True)
    reference_range: Mapped[str] = mapped_column(String, nullable=True)
    abnormal_flag: Mapped[str] = mapped_column(String, nullable=True)

class MedicationEvent(Base):
    __tablename__ = "medication_events"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id"), primary_key=True)
    dose: Mapped[str] = mapped_column(String)
    frequency: Mapped[str] = mapped_column(String, nullable=True)

class DailyHealthEntry(Base):
    __tablename__ = "daily_health_entries"
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id"), primary_key=True)
    metric_type: Mapped[str] = mapped_column(String) # e.g., blood_pressure, mood
    numeric_value_1: Mapped[float] = mapped_column(Float, nullable=True) # e.g., Systolic
    numeric_value_2: Mapped[float] = mapped_column(Float, nullable=True) # e.g., Diastolic
    notes: Mapped[str] = mapped_column(String, nullable=True)

# for uploaded documents and store the hash and storage URL in a separate table
class Document(Base, TimestampMixin):
    __tablename__ = "documents"
    document_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True)
    # P7: hash dedup is per-patient (two patients may upload the same file;
    # the old global UNIQUE also raised IntegrityError 500s on races).
    # Enforced by uq_document_patient_hash (see migration p7).
    file_hash: Mapped[str] = mapped_column(String, index=True)
    storage_url: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String) # UPLOADED, PROCESSED, FAILED

    __table_args__ = (
        UniqueConstraint("patient_id", "file_hash", name="uq_document_patient_hash"),
    )


class DocumentBlob(Base):
    """Durable binary payload for an uploaded document.

    Production note: on Voroa (and most container PaaS platforms) the
    per-container filesystem is ephemeral and is wiped on every deploy or
    restart. Uploaded health documents therefore MUST NOT live on the
    container filesystem. Storing the bytes here (in the durable, backed-up
    managed PostgreSQL) guarantees they survive deploys and are readable by
    both the web service and the Celery worker, which do not share a
    filesystem.
    """
    __tablename__ = "document_blobs"
    document_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("documents.document_id", ondelete="CASCADE"),
        primary_key=True,
    )
    filename: Mapped[str] = mapped_column(String)
    content_type: Mapped[str] = mapped_column(String, nullable=True)
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    

class EvidenceLink(Base):
    __tablename__ = "evidence_links"
    evidence_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("clinical_events.event_id"), unique=True)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.document_id"))
    extracted_text: Mapped[str] = mapped_column(String)
    bounding_box: Mapped[dict] = mapped_column(JSONB, nullable=True)  # LandingAI coordinates

class RawExtractionData(Base):
    __tablename__ = "raw_extraction"
    extraction_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.document_id"), index=True)
    gateway_json: Mapped[dict] = mapped_column(JSONB, nullable=True) #ocr gateway output
    raw_ade_json: Mapped[dict] = mapped_column(JSONB, nullable=False)  # LandingAI ADE output
    markdown_text: Mapped[str] = mapped_column(String, nullable=True)  # Extracted text in markdown format
    extraction: Mapped[dict] = mapped_column(JSONB, nullable=True)  # Structured extraction data    
    deidentified_markdown: Mapped[str] = mapped_column(String, nullable=True)  # De-identified markdown text
    # P0 pipeline versioning (additive, nullable): which models produced this
    # extraction, so results stay reproducible and re-runnable on upgrade.
    extraction_model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    extraction_prompt_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

