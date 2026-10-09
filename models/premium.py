"""
Premium purchases — who bought which paid tier, and when.

One row per verified purchase event reported by the app after Google Play
Billing (via RevenueCat) completes. The store stays the source of truth
for entitlement; this table is the business record: support lookups,
churn/win-back, revenue reconciliation, and the in-app "your plan" state.

Upsert key: (patient_id, purchase_token) when the store gives a token,
otherwise the newest row per patient wins for status resolution.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

TIER_GENERAL = "general"
TIER_ALLIN = "allin"
ALLOWED_TIERS = (TIER_GENERAL, TIER_ALLIN)

STATUS_ACTIVE = "active"
STATUS_EXPIRED = "expired"
STATUS_CANCELLED = "cancelled"
STATUS_REFUNDED = "refunded"
STATUS_GRACE = "grace"
ALLOWED_STATUSES = (
    STATUS_ACTIVE,
    STATUS_EXPIRED,
    STATUS_CANCELLED,
    STATUS_REFUNDED,
    STATUS_GRACE,
)


class PremiumPurchase(Base, TimestampMixin):
    """A paid-tier purchase (General €11/mo, All-in €18/mo)."""

    __tablename__ = "premium_purchases"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("patients.patient_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    tier: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default=STATUS_ACTIVE
    )
    # Store provenance. purchase_token is the Play purchase token when known
    # (unique: the same token reported twice updates one row).
    provider: Mapped[str] = mapped_column(
        String(32), nullable=False, server_default="google_play"
    )
    product_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    entitlement: Mapped[str | None] = mapped_column(String(64), nullable=True)
    purchase_token: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True
    )
    order_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    environment: Mapped[str | None] = mapped_column(String(16), nullable=True)
    auto_renewing: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(), nullable=True)

    __table_args__ = (
        Index("ix_premium_purchases_patient_status", "patient_id", "status"),
    )
