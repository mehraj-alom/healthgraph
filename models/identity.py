import uuid
from datetime import datetime
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import DateTime, String, Float, Text
from models.base import Base, TimestampMixin

class Patient(Base, TimestampMixin):
    __tablename__ = "patients"
    
    patient_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    firebase_uid: Mapped[str] = mapped_column(String, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String, nullable=True)

    # Health profile (all optional)
    phone_number: Mapped[str | None] = mapped_column(String(32), nullable=True)
    height_cm: Mapped[float | None] = mapped_column(Float, nullable=True)
    weight_kg: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Onboarding preferences (device-owned, server-mirrored for backup).
    # Stored as JSON arrays of stable option ids; the device is the source
    # of truth and overwrites these on every profile save. Nullable so
    # pre-existing rows need no backfill.
    goals_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    focus_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Premium entitlement (server truth; see app/api/v1/billing.py).
    # Set only by a verified Play purchase; 'free' + NULL expiry means
    # the Free tier. Never written by the profile endpoint.
    premium_tier: Mapped[str] = mapped_column(String(20), nullable=False, default="free")
    premium_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

class Provider(Base, TimestampMixin):
    __tablename__ = "providers"
    provider_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String)
    specialty: Mapped[str] = mapped_column(String, nullable=True)

class Facility(Base, TimestampMixin):
    __tablename__ = "facilities"
    facility_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String)