"""P2 medication regimen versioning (PostgreSQL source of truth).

snapshot_before_mutation() copies the live regimen row into
medication_versions BEFORE any PUT-update or discontinue mutation, bumps
version_number, and enqueues MEDICATION_VERSION_RECORDED so the graph can
chain (newer Request)-[:HAS_VERSION]->(ver)-[:SUPERSEDES]->(older ver).

History rows are append-only: never updated, never deleted by this module.
"""
import uuid
from sqlalchemy.orm import Session

from models.medication_versions import MedicationVersion
from models.medications import Medication
from models.outbox import enqueue_medication_version

_REGIMEN_FIELDS = (
    "name", "generic_name", "brand_name", "strength", "strength_unit",
    "dose_amount", "dose_unit", "route", "frequency", "scheduled_times",
    "scheduled_weekdays", "start_date", "end_date", "status", "purpose",
    "instructions", "prescriber", "prn", "reminder_enabled", "notes",
)


def regimen_snapshot(medication: Medication) -> dict:
    """Serialize the live regimen columns (JSON-safe, enums → values)."""
    snap: dict = {}
    for field in _REGIMEN_FIELDS:
        value = getattr(medication, field, None)
        if hasattr(value, "value"):
            value = value.value
        elif hasattr(value, "isoformat") and value is not None:
            try:
                value = value.isoformat()
            except Exception:
                value = str(value)
        snap[field] = value
    return snap


def snapshot_before_mutation(
    db: Session, medication: Medication, change_reason: str | None = None
):
    """Append a version row for the CURRENT regimen; bump the live counter.

    Call BEFORE mutating the live row, inside the caller's transaction.
    Returns the created MedicationVersion.
    """
    current = int(medication.version_number or 1)
    version = MedicationVersion(
        version_id=uuid.uuid4(),
        medication_id=medication.medication_id,
        patient_id=medication.patient_id,
        version_number=current,
        snapshot=regimen_snapshot(medication),
        change_reason=change_reason,
    )
    db.add(version)
    db.flush()
    medication.version_number = current + 1
    # The previous version (if any) is superseded by this new snapshot.
    supersedes_id = None
    if current > 1:
        prev = (
            db.query(MedicationVersion)
            .filter(
                MedicationVersion.medication_id == medication.medication_id,
                MedicationVersion.version_number == current - 1,
            )
            .first()
        )
        supersedes_id = prev.version_id if prev else None
    enqueue_medication_version(
        db,
        version_id=version.version_id,
        medication_id=medication.medication_id,
        patient_id=medication.patient_id,
        version_number=current,
        snapshot=version.snapshot,
        change_reason=change_reason,
        recorded_at=version.recorded_at.isoformat() if version.recorded_at else None,
        supersedes_version_id=supersedes_id,
    )
    db.flush()
    return version
