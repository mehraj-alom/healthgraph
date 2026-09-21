"""P3 food scan + entry entities.

The nutrition analyze endpoint is stateless: per-item labels, portions,
nutrients, confidences, and the photo itself never reach the backend —
only daily aggregates (meals_count, calories, food_label) persist via the
daily-checkin path. These tables preserve the full scan when clients
submit it (POST /api/v1/nutrition/log), keeping raw images OUT of the
database (photo_hash reference only) and Neo4j (structured metadata only).

User corrections never overwrite AI output: the original label stays on
the entry alongside corrected_label + corrected flag, so SOURCE_FACT
(AI estimate) vs USER_REPORTED (correction) remain distinguishable.
"""
import uuid
from datetime import datetime, timezone, date
from sqlalchemy import String, Text, Float, Integer, Boolean, DateTime, Date, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from models.base import Base, TimestampMixin


class FoodScanStatus(str):
    AI_ESTIMATED = "ai_estimated"
    USER_CONFIRMED = "user_confirmed"
    USER_CORRECTED = "user_corrected"


class FoodScan(Base, TimestampMixin):
    __tablename__ = "food_scans"

    scan_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    # Meal context (client-supplied; date-only grouping via visits at projection).
    log_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    meal_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    # Image reference only — bytes are never stored (photo lifetime is the
    # scan request; see app/services/nutrition/vlm.py).
    photo_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)

    # Pipeline provenance (which models produced the estimate).
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    model_version: Mapped[str | None] = mapped_column(String(64), nullable=True)

    overall_confidence: Mapped[str | None] = mapped_column(String(10), nullable=True)
    total_kcal: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=FoodScanStatus.AI_ESTIMATED)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    entries: Mapped[list["FoodEntry"]] = relationship(
        "FoodEntry", back_populates="scan", cascade="all, delete-orphan"
    )

    __table_args__ = (Index("ix_foodscan_patient_recorded", "patient_id", "recorded_at"),)


class FoodEntry(Base):
    __tablename__ = "food_entries"

    entry_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scan_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("food_scans.scan_id", ondelete="CASCADE"), index=True, nullable=False
    )

    label: Mapped[str] = mapped_column(String(255), nullable=False)
    portion_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    volume_ml: Mapped[float | None] = mapped_column(Float, nullable=True)
    kcal: Mapped[float | None] = mapped_column(Float, nullable=True)
    protein_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    carbs_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    fat_g: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    fdc_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # User correction preserves the original AI label (never overwritten).
    corrected: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    corrected_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    scan: Mapped[FoodScan] = relationship("FoodScan", back_populates="entries")
