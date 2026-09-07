"""
Idempotency key model for safe offline synchronization.

Stores client-generated mutation IDs to prevent duplicate record creation
when the same mutation is retried.
"""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class IdempotencyKey(Base):
    """Stores idempotency keys for client mutations."""

    __tablename__ = "idempotency_keys"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("patients.patient_id"), nullable=False, index=True
    )
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    operation: Mapped[str] = mapped_column(String(100), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="completed"
    )  # completed, failed
    http_status: Mapped[int | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("patient_id", "key", name="uq_idempotency_patient_key"),
        Index("ix_idempotency_lookup", "patient_id", "key"),
        Index("ix_idempotency_expires", "expires_at"),
    )

    @staticmethod
    def create_key(patient_id: uuid.UUID, key: str, operation: str, request_hash: str, ttl_hours: int = 72):
        """Create a new idempotency key record."""
        return IdempotencyKey(
            patient_id=patient_id,
            key=key,
            operation=operation,
            request_hash=request_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=ttl_hours),
        )
