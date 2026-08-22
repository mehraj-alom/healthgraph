"""Clinical Event Foundation"""
import uuid
import enum
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy import Enum, ForeignKey, DateTime, String, Float
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
    DOCUMENT = "DOCUMENT"
    MANUAL_ENTRY = "MANUAL_ENTRY"
    SMARTPHONE_PPG = "SMARTPHONE_PPG"

class VerificationStatus(str, enum.Enum):
    EXTRACTED = "EXTRACTED"
    UNVERIFIED = "UNVERIFIED"
    HUMAN_VERIFIED = "HUMAN_VERIFIED"

class ClinicalEvent(Base, TimestampMixin):
    __tablename__ = "clinical_events"
    
    event_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True)
    concept_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_concepts.concept_id"), nullable=True)
    
    event_type: Mapped[EventType] = mapped_column(Enum(EventType))
    source_type: Mapped[SourceType] = mapped_column(Enum(SourceType))
    verification_status: Mapped[VerificationStatus] = mapped_column(Enum(VerificationStatus))
    
    event_time: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    group_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True, nullable=True)

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
    file_hash: Mapped[str] = mapped_column(String, unique=True, index=True)
    storage_url: Mapped[str] = mapped_column(String)
    status: Mapped[str] = mapped_column(String) # UPLOADED, PROCESSED, FAILED
    

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


