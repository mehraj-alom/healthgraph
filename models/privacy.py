"""P0 privacy / data-lifecycle engineering foundations.

Tables here implement ONLY engineering controls identified in the P0 report:
consent receipts + withdrawal flags, data-subject-request (DSR) intake with
SLA tracking, and an append-only audit trail. They do not, by themselves,
constitute legal compliance — notices, policies, DPAs, and counsel memos
 remain required (see report sections 15-17, all marked accordingly).

All tables are additive. Nothing here alters existing clinical tables.
"""
import uuid
from datetime import datetime, timezone
from enum import Enum
from sqlalchemy import String, Text, DateTime, Boolean, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class ConsentScope(str, Enum):
    CLINICAL_STORAGE = "clinical_storage"
    AI_PROCESSING = "ai_processing"
    ANALYTICS = "analytics"


class DSRType(str, Enum):
    ACCESS = "access"
    EXPORT = "export"
    CORRECTION = "correction"
    ERASURE = "erasure"


class DSRStatus(str, Enum):
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    FULFILLED = "fulfilled"
    REJECTED = "rejected"


class ConsentReceipt(Base):
    """Proof of notice + consent per patient/scope (DPDP R.3 / GDPR Art. 7 lite).

    Grandfathering rule (code-enforced in app/api/v1/privacy.py): patients
    without any receipt keep existing functionality, but calls are audit-logged
    as consent_unknown so policy can decide an enforcement date.
    """

    __tablename__ = "consent_receipts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True, nullable=False)
    scope: Mapped[str] = mapped_column(String(40), nullable=False)
    notice_version: Mapped[str] = mapped_column(String(64), nullable=False)
    notice_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    age_confirmed_18_plus: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_guardian_consent: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    method: Mapped[str] = mapped_column(String(40), nullable=False, default="app")
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_consent_patient_scope", "patient_id", "scope"),)


class DataSubjectRequest(Base):
    """DSR intake + SLA tracking (DPDP <=90 days / GDPR 1 month — policy owns the clock)."""

    __tablename__ = "data_subject_requests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), index=True, nullable=False)
    request_type: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=DSRStatus.OPEN.value)
    details: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    fulfilled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_dsr_patient_status", "patient_id", "status"),)


class AuditEvent(Base):
    """Append-only audit trail for privacy-relevant actions.

    Application code must only INSERT (never update/delete). Contains
    identifiers only — never extracted clinical text or PHI values.
    """

    __tablename__ = "audit_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (Index("ix_audit_patient_action", "patient_id", "action"),)


def log_audit(db, *, action: str, patient_id=None, entity_type: str | None = None,
              entity_id: str | None = None, meta: dict | None = None) -> None:
    """Append an audit row in the caller's session (caller commits)."""
    db.add(
        AuditEvent(
            patient_id=patient_id,
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id) if entity_id is not None else None,
            meta=meta or {},
        )
    )
