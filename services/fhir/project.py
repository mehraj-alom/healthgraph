"""Project parsed FHIR Bundle records into timeline tables.

Medications land as first-class Medication rows (provenance via
source_document_id, graph context synced like the API path).
Observations land as Measurements through the same clinical service the
OCR pipeline uses, so longitudinal series ("LOINC|code") just work.

Per-resource SAVEPOINTs: one malformed row can never fail the document
after sibling rows already committed.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from models.events import Document
from models.measurements import Measurement
from models.medications import Medication, MedicationFrequency, MedicationStatus
from services.clinical.measurements import create_lab_measurement
from services.clinical.occurrences import sync_medication_graph_context

from .bundle import BundleSummary

#: FHIR medication status → local status. Anything else never reaches
#: here (the parser filters), this is the explicit contract.
FHIR_MED_STATUS = {
    "active": MedicationStatus.ACTIVE,
    "completed": MedicationStatus.COMPLETED,
    "on-hold": MedicationStatus.PAUSED,
}


def _medication_exists(db: Session, patient_id: uuid.UUID, document_id: uuid.UUID, name: str) -> bool:
    return (
        db.query(Medication.medication_id)
        .filter(
            Medication.patient_id == patient_id,
            Medication.source_document_id == document_id,
            Medication.name == name,
        )
        .first()
        is not None
    )


def _measurement_exists(
    db: Session,
    patient_id: uuid.UUID,
    document_id: uuid.UUID,
    series_key: str,
    measured_at: datetime,
    value_text: str,
) -> bool:
    return (
        db.query(Measurement.measurement_id)
        .filter(
            Measurement.patient_id == patient_id,
            Measurement.source_document_id == document_id,
            Measurement.series_key == series_key,
            Measurement.measured_at == measured_at,
            Measurement.value_text == value_text,
        )
        .first()
        is not None
    )


def _medication_notes(med: Any) -> str | None:
    parts = []
    if med.dosage_text:
        parts.append(med.dosage_text)
    if med.authored_on:
        parts.append(f"recorded {med.authored_on[:10]}")
    parts.append(f"FHIR {med.status}")
    if med.source_id:
        parts.append(f"resource {med.source_id}")
    text = "; ".join(parts)
    return text[:2000] if text else None


def project_bundle(
    db: Session, document: Document, summary: BundleSummary
) -> dict[str, int]:
    """Write parsed Bundle records. Returns counts (created + skipped)."""
    created_meds = 0
    created_obs = 0
    skipped = 0
    fallback_at = document.created_at or datetime.now(timezone.utc)
    if fallback_at.tzinfo is None:
        fallback_at = fallback_at.replace(tzinfo=timezone.utc)

    for med in summary.medications:
        status = FHIR_MED_STATUS.get(med.status)
        if status is None or not med.name:
            skipped += 1
            continue
        if _medication_exists(db, document.patient_id, document.document_id, med.name):
            skipped += 1
            continue
        try:
            with db.begin_nested():
                row = Medication(
                    patient_id=document.patient_id,
                    name=med.name[:500],
                    status=status,
                    # Frequency is unknown from the file — CUSTOM is honest
                    # ("see notes"), never a guessed schedule.
                    frequency=MedicationFrequency.CUSTOM,
                    reminder_enabled=False,
                    notes=_medication_notes(med),
                    source_document_id=document.document_id,
                )
                db.add(row)
                db.flush()
                sync_medication_graph_context(db, row)
            created_meds += 1
        except Exception:
            skipped += 1

    for obs in summary.observations:
        if not obs.name or obs.value is None:
            skipped += 1
            continue
        measured_at = fallback_at
        if obs.measured_at:
            try:
                parsed = datetime.fromisoformat(obs.measured_at)
                measured_at = (
                    parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
                )
            except ValueError:
                measured_at = fallback_at
        from services.clinical.measurements import series_key_for

        series = series_key_for(obs.terminology, obs.code, obs.name)
        if _measurement_exists(
            db, document.patient_id, document.document_id, series, measured_at, obs.value[:500]
        ):
            skipped += 1
            continue
        try:
            with db.begin_nested():
                create_lab_measurement(
                    db,
                    patient_id=document.patient_id,
                    name=obs.name,
                    value=obs.value,
                    unit=obs.unit,
                    ref_range=obs.ref_range,
                    abnormal_flag=obs.abnormal_flag,
                    terminology=obs.terminology,
                    code=obs.code,
                    display_name=obs.display,
                    measured_at=measured_at,
                    source_event_id=None,
                    source_document_id=document.document_id,
                    evidence_text=f"{obs.name}: {obs.value} {obs.unit or ''}".strip()[:500],
                )
            created_obs += 1
        except Exception:
            skipped += 1

    db.commit()
    return {"medications": created_meds, "measurements": created_obs, "skipped": skipped}
