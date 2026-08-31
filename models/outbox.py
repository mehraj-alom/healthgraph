"""The main work of this model is to define the Outbox table, which is used to reliably queue events for projection into Neo4j."""
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from sqlalchemy import String, DateTime, Enum as SQLEnum, Integer, Text, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from models.base import Base

class OutboxStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    PROCESSED = "processed"
    DEAD_LETTER = "dead_letter"

class OutboxEventType(str, Enum):
    OBSERVATION_RECORDED = "observation_recorded"
    CLINICAL_EVENT_RECORDED = "clinical_event_recorded"

class GraphSyncOutbox(Base):
    """Reliable queue for projecting PostgreSQL state into Neo4j."""
    __tablename__ = "graph_sync_outbox"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    event_type: Mapped[OutboxEventType] = mapped_column(SQLEnum(OutboxEventType), nullable=False)
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    status: Mapped[OutboxStatus] = mapped_column(SQLEnum(OutboxStatus), default=OutboxStatus.PENDING, nullable=False)
    
    # Retry & Lease State Machine
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_outbox_poll", "status", "next_attempt_at", "locked_at"),
    )


# ---------------------------------------------------------------------------
# Shared helpers for outbox producers
# ---------------------------------------------------------------------------

def compute_level_number(event_time: datetime) -> int:
    """Deterministic YYYYMMDD level number derived from event_time."""
    return int(event_time.strftime("%Y%m%d"))


def enqueue_clinical_event(
    db,
    event_id: uuid.UUID,
    patient_id: uuid.UUID,
    event_type,
    source_type,
    verification_status,
    event_time: datetime,
    *,
    level_number: Optional[int] = None,
) -> None:
    """
    Enqueue a ClinicalEvent for projection into Neo4j.

    Call this inside the same database session that created the ClinicalEvent,
    after the ClinicalEvent has been flushed (so event_id is valid).

    The idempotency key is ``event_id`` inside the JSONB payload.  The
    graph_sync worker uses MERGE so re-enqueueing is safe.
    """
    if level_number is None:
        level_number = compute_level_number(event_time)

    db.add(
        GraphSyncOutbox(
            event_type=OutboxEventType.CLINICAL_EVENT_RECORDED,
            payload={
                "patient_id": str(patient_id),
                "event_id": str(event_id),
                "event_type": event_type.value
                if hasattr(event_type, "value")
                else str(event_type),
                "source_type": source_type.value
                if hasattr(source_type, "value")
                else str(source_type),
                "verification_status": verification_status.value
                if hasattr(verification_status, "value")
                else str(verification_status),
                "event_time": event_time.isoformat(),
                "level_number": level_number,
            },
        )
    )


def enqueue_clinical_events_batch(
    db,
    events: list,
) -> None:
    """
    Batch-enqueue multiple ClinicalEvent ORM objects.

    Each event must already be added to the session and flushed so that
    ``event_id`` is populated.
    """
    for event in events:
        enqueue_clinical_event(
            db,
            event_id=event.event_id,
            patient_id=event.patient_id,
            event_type=event.event_type,
            source_type=event.source_type,
            verification_status=event.verification_status,
            event_time=event.event_time,
        )