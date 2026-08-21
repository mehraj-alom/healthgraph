import uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import String, ForeignKey
from models.base import Base, TimestampMixin

class MedicalConcept(Base, TimestampMixin):
    __tablename__ = "medical_concepts"
    concept_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    canonical_name: Mapped[str] = mapped_column(String, unique=True, index=True)
    category: Mapped[str] = mapped_column(String) # e.g., DIAGNOSIS, LAB_TEST, BODY_PART

class MedicalAlias(Base, TimestampMixin):
    __tablename__ = "medical_aliases"
    alias_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    raw_name: Mapped[str] = mapped_column(String, unique=True, index=True)
    concept_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("medical_concepts.concept_id"), nullable=True)

class BodyRegion(Base, TimestampMixin):
    __tablename__ = "body_regions"
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, unique=True)
    parent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("body_regions.region_id"), nullable=True)