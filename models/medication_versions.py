"""P2 medication regimen version history.

PUT updates and discontinuations rewrite the medications row in place, so
without this table dose/regimen history is unrecoverable. Every mutation
snapshots the pre-change regimen here first (additive history; the live
row is never rewritten by this module).

The graph links consecutive versions directionally:
  (newer Request)-[:HAS_VERSION]->(ver_new)-[:SUPERSEDES]->(ver_old)
so dose changes are traversable without touching current-state queries.
"""
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Integer, DateTime, ForeignKey, Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from models.base import Base


class MedicationVersion(Base):
    __tablename__ = "medication_versions"

    version_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    medication_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("medications.medication_id", ondelete="CASCADE"), index=True, nullable=False
    )
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("patients.patient_id"), index=True, nullable=False)

    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    # Full pre-change regimen snapshot (dose, frequency, route, status,
    # dates, purpose, prescriber, instructions, prn, strength...).
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    change_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("medication_id", "version_number", name="uq_med_version_number"),
        Index("ix_med_version_patient", "patient_id", "medication_id"),
    )
