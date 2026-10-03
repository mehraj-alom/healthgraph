"""
Early-access waitlist signups from the marketing landing page.

One row per person who asks for early access on healthgraph.shop.
Email is unique: repeat submissions create nothing, the API answers
"already registered" instead of failing.
"""

import uuid

from sqlalchemy import String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class EarlyAccessSignup(Base, TimestampMixin):
    """A person on the early-access waitlist."""

    __tablename__ = "early_access_signups"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    city: Mapped[str] = mapped_column(String(120), nullable=False)
    source: Mapped[str] = mapped_column(String(40), nullable=False, server_default="landing_page")
