import uuid
from enum import Enum
from datetime import datetime, timezone
from sqlalchemy import (
    String, Float, ForeignKey, DateTime, Text, Boolean, Index, CheckConstraint, Enum as SQLEnum
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base

class StructureCategory(str, Enum):
    ROOT = "root"
    BODY_REGION = "body_region"
    SUB_REGION = "sub_region"
    ORGAN = "organ"
    BONE_JOINT = "bone_joint"
    VASCULAR_SYSTEM = "vascular"

class ObservationType(str, Enum):
    SYMPTOM = "symptom"
    STRUCTURAL_FINDING = "structural_finding"
    IMAGING_FINDING = "imaging_finding"
    LAB_ASSOCIATED_FINDING = "lab_associated_finding"

class VisualStatus(str, Enum):
    NORMAL = "normal"
    MILD_ATTENTION = "mild_attention"
    WARNING = "warning"
    CRITICAL = "critical"

class FindingTrend(str, Enum):
    IMPROVING = "improving"
    STABLE = "stable"
    WORSENING = "worsening"
    RESOLVED = "resolved"

class SourceType(str, Enum):
    PATIENT_REPORTED = "patient_reported"
    AI_INFERRED = "ai_inferred"
    DOCTOR_ENTERED = "doctor_entered"
    IMAGING_REPORT = "imaging_report"
    LAB_REPORT = "lab_report"
    DEVICE_WEARABLE = "device_wearable"


class AnatomicalStructure(Base):
    """Canonical registry of anatomical structures, decoupled from 3D logic."""
    __tablename__ = "anatomical_structures"

    structure_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    display_name: Mapped[str] = mapped_column(String(128), nullable=False)
    
    category: Mapped[StructureCategory] = mapped_column(SQLEnum(StructureCategory), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(ForeignKey("anatomical_structures.structure_id"), nullable=True)
    snomed_concept_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # 3D Mesh Mapping (Versioned)
    mesh_asset_id: Mapped[str] = mapped_column(String(64), default="human_body_v1", nullable=False)
    mesh_node_name: Mapped[str] = mapped_column(String(128), nullable=False)
    mesh_version: Mapped[int] = mapped_column(default=1, nullable=False)
    is_internal_organ: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)


class AnatomicalObservation(Base):
    """Authoritative clinical state (System of Record)."""
    __tablename__ = "anatomical_observations"

    observation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.patient_id"), nullable=False)
    structure_id: Mapped[str] = mapped_column(ForeignKey("anatomical_structures.structure_id"), nullable=False)
    
    observation_type: Mapped[ObservationType] = mapped_column(SQLEnum(ObservationType), nullable=False)
    finding_code: Mapped[str] = mapped_column(String(100), nullable=False)
    finding_display_name: Mapped[str] = mapped_column(String(128), nullable=False)

    # UI / Rendering specific translations
    visual_status: Mapped[VisualStatus] = mapped_column(SQLEnum(VisualStatus), default=VisualStatus.NORMAL, nullable=False)
    visual_severity_score: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    trend: Mapped[FindingTrend] = mapped_column(SQLEnum(FindingTrend), default=FindingTrend.STABLE, nullable=False)

    # Provenance
    source_type: Mapped[SourceType] = mapped_column(SQLEnum(SourceType), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    event_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("clinical_events.event_id"), nullable=True)
    document_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("documents.document_id"), nullable=True)

    clinical_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    # Strict Chronology Separation
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False) 

    __table_args__ = (
        CheckConstraint("visual_severity_score >= 0.0 AND visual_severity_score <= 1.0", name="ck_obs_visual_severity_score"),
        # Optimized for historical body-region queries
        Index("ix_patient_structure_recorded_at_desc", "patient_id", "structure_id", recorded_at.desc()),
    )


class PatientBodyStateSnapshot(Base):
    """Materialized Read Model for the 3D Frontend."""
    __tablename__ = "patient_body_state_snapshots"

    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("patients.patient_id", ondelete="CASCADE"), primary_key=True)
    structure_id: Mapped[str] = mapped_column(ForeignKey("anatomical_structures.structure_id"), primary_key=True)
    
    # Complete Mesh Identity
    mesh_asset_id: Mapped[str] = mapped_column(String(64), nullable=False)
    mesh_node_name: Mapped[str] = mapped_column(String(128), nullable=False)
    mesh_version: Mapped[int] = mapped_column(nullable=False)
    
    visual_status: Mapped[VisualStatus] = mapped_column(SQLEnum(VisualStatus), nullable=False)
    visual_severity_score: Mapped[float] = mapped_column(Float, nullable=False)
    trend: Mapped[FindingTrend] = mapped_column(SQLEnum(FindingTrend), nullable=False)
    
    latest_observation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("anatomical_observations.observation_id"), nullable=False)
    latest_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    observation_recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    observation_ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    __table_args__ = (
        CheckConstraint("visual_severity_score >= 0.0 AND visual_severity_score <= 1.0", name="ck_snap_visual_severity_score"),
    )