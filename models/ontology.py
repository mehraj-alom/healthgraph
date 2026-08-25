import uuid
from sqlalchemy import (
    ARRAY,
    Boolean,
    Float,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin

class MedicalConcept(Base):
    __tablename__ = "medical_concepts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    terminology: Mapped[str] = mapped_column(String(50), nullable=False)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[str] = mapped_column(Text, nullable=False)
    short_name: Mapped[str | None] = mapped_column(String(500), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
    # Optional embedding for semantic search (e.g., pgvector)
    embedding: Mapped[list[float] | None] = mapped_column(ARRAY(Float), nullable=True)

    aliases = relationship("MedicalAlias", back_populates="concept", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("terminology", "code", name="uq_medical_concept_terminology_code"),
    )

class MedicalAlias(Base):
    __tablename__ = "medical_aliases"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    raw_name: Mapped[str] = mapped_column(Text, nullable=False)
    
    # Used for lexical lookup (preserves structural signs like + or -)
    lexical_name: Mapped[str] = mapped_column(Text, nullable=False)
    
    concept_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("medical_concepts.id", ondelete="CASCADE"), nullable=False
    )
    source: Mapped[str] = mapped_column(String(50), nullable=False, default="manual")
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    usage_count: Mapped[int] = mapped_column(nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    
    concept = relationship("MedicalConcept", back_populates="aliases")

    __table_args__ = (
        UniqueConstraint("lexical_name", "concept_id", name="uq_alias_lexical_concept"),
        Index("ix_alias_lexical_name", "lexical_name"),
    )

class BodyRegion(Base, TimestampMixin):
    __tablename__ = "body_regions"
    region_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String, unique=True)
    parent_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("body_regions.region_id"), nullable=True)