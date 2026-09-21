"""P1 Visit/Encounter entity (lightweight grouping node).

A Visit groups clinical facts that belong to the same encounter context so
the graph can express "symptoms + measurements during the same visit"
without routing everything through Patient. Visits are created
deterministically — one per (patient, date, type) — never LLM-grouped.

Types: document (doc-derived facts) | daily-checkin (patient-reported,
manual, taken events) | manual (explicit user encounter; reserved).
"""
import uuid
from datetime import datetime, timezone, date
from sqlalchemy import String, Text, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base, TimestampMixin


class VisitType(str):
    DOCUMENT = "document"
    DAILY_CHECKIN = "daily-checkin"
    MANUAL = "manual"


class Visit(Base, TimestampMixin):
    __tablename__ = "visits"

    visit_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    visit_type: Mapped[str] = mapped_column(String(40), nullable=False, default=VisitType.DAILY_CHECKIN)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str | None] = mapped_column(String(128), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("patient_id", "visit_date", "visit_type", name="uq_visit_patient_date_type"),
        Index("ix_visit_patient_date", "patient_id", "visit_date"),
    )
