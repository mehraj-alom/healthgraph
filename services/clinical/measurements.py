"""P2 measurement helpers (PostgreSQL source of truth).

- parse_number / parse_range: deterministic numeric parsing of lab strings.
- derive_interpretation: flag mapping first (lab-assigned, SOURCE_FACT),
  then range comparison (SYSTEM_DERIVED). Never guessed beyond that.
- create_lab_measurement / create_vital_measurement: row + outbox enqueue
  (callers own the transaction; helpers flush, never commit).
"""
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.clinical_assertion import classify_assertion
from models.measurements import Measurement, MeasurementInterpretation
from models.outbox import enqueue_measurement
from services.ocr.term_normalization import MedicalTermNormalizer

_NUMBER_RE = re.compile(r"[-+]?\d+(?:\.\d+)?")
_RANGE_RE = re.compile(r"([-+]?\d+(?:\.\d+)?)\s*[-–—~to]+\s*([-+]?\d+(?:\.\d+)?)", re.IGNORECASE)

_HIGH_FLAGS = {"H", "HH", "HIGH", "CRITICAL", "PANIC", "A", "ABNORMAL"}
_LOW_FLAGS = {"L", "LL", "LOW"}
_CRITICAL_TOKENS = {"CRITICAL", "PANIC", "HH", "LL"}


def parse_number(text: str | None) -> float | None:
    if not text:
        return None
    m = _NUMBER_RE.search(str(text).replace(",", ""))
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def parse_range(ref_range: str | None) -> tuple[float | None, float | None]:
    """Parse 'low - high' reference strings; returns (low, high)."""
    if not ref_range:
        return None, None
    m = _RANGE_RE.search(str(ref_range).replace(",", ""))
    if not m:
        return None, None
    try:
        return float(m.group(1)), float(m.group(2))
    except ValueError:
        return None, None


def derive_interpretation(
    value_number: float | None,
    abnormal_flag: str | None,
    range_low: float | None,
    range_high: float | None,
    critical_text: str | None = None,
) -> str:
    """Flag mapping first (lab-assigned fact), then range comparison
    (deterministic derivation). Anything else is UNKNOWN — never guessed."""
    flag = (abnormal_flag or "").strip().upper()
    if flag in _CRITICAL_TOKENS or (critical_text or "").strip():
        return MeasurementInterpretation.CRITICAL
    if flag in _HIGH_FLAGS:
        return MeasurementInterpretation.ABOVE_RANGE
    if flag in _LOW_FLAGS:
        return MeasurementInterpretation.BELOW_RANGE
    if value_number is not None and (range_low is not None or range_high is not None):
        if range_high is not None and value_number > range_high:
            return MeasurementInterpretation.ABOVE_RANGE
        if range_low is not None and value_number < range_low:
            return MeasurementInterpretation.BELOW_RANGE
        return MeasurementInterpretation.WITHIN_RANGE
    return MeasurementInterpretation.UNKNOWN


def series_key_for(terminology: str | None, code: str | None, name: str) -> str:
    if terminology and code:
        return f"{terminology}|{code}"
    return MedicalTermNormalizer.lexical_text(name) or name.lower()


def create_lab_measurement(
    db: Session,
    *,
    patient_id: uuid.UUID,
    name: str,
    value: str,
    unit: str | None,
    ref_range: str | None,
    abnormal_flag: str | None,
    terminology: str | None,
    code: str | None,
    display_name: str | None,
    measured_at: datetime,
    source_event_id: uuid.UUID | None,
    source_document_id: uuid.UUID | None,
    evidence_text: str | None,
    visit_id=None,
    enqueue: bool = True,
) -> Measurement:
    value_number = parse_number(value)
    range_low, range_high = parse_range(ref_range)
    interpretation = derive_interpretation(value_number, abnormal_flag, range_low, range_high)
    assertion = classify_assertion(evidence_text or f"{name}: {value} {unit or ''}")
    measurement = Measurement(
        measurement_id=uuid.uuid4(),
        patient_id=patient_id,
        name=(display_name or name).strip()[:500],
        series_key=series_key_for(terminology, code, name),
        terminology=terminology,
        code=code,
        display_name=display_name,
        value_number=value_number,
        value_text=str(value)[:500],
        unit=(unit or None),
        range_low=range_low,
        range_high=range_high,
        range_text=(ref_range or None),
        interpretation=interpretation,
        abnormal_flag=(abnormal_flag or None),
        measured_at=measured_at,
        method="ADE",
        source_type="LAB_REPORT",
        verification_status="EXTRACTED",
        polarity=assertion.polarity.value,
        experiencer=assertion.experiencer.value,
        source_event_id=source_event_id,
        source_document_id=source_document_id,
        evidence_text=(evidence_text or "")[:500] or None,
    )
    db.add(measurement)
    db.flush()
    if enqueue:
        enqueue_measurement(
            db,
            measurement_id=measurement.measurement_id,
            patient_id=patient_id,
            name=measurement.name,
            series_key=measurement.series_key,
            value_number=value_number,
            value_text=measurement.value_text,
            unit=measurement.unit,
            range_low=range_low,
            range_high=range_high,
            range_text=measurement.range_text,
            interpretation=interpretation,
            abnormal_flag=measurement.abnormal_flag,
            terminology=terminology,
            code=code,
            display_name=display_name,
            measured_at=measured_at.isoformat(),
            recorded_at=measurement.recorded_at.isoformat() if measurement.recorded_at else None,
            method="ADE",
            source_type="LAB_REPORT",
            verification_status="EXTRACTED",
            polarity=measurement.polarity,
            experiencer=measurement.experiencer,
            event_id=source_event_id,
            document_id=source_document_id,
            evidence_text=measurement.evidence_text,
            visit_id=visit_id,
        )
    return measurement


def create_vital_measurement(
    db: Session,
    *,
    patient_id: uuid.UUID,
    name: str,
    concept_display: str | None,
    value_number: float | None,
    value_text: str,
    unit: str | None,
    terminology: str | None = None,
    code: str | None = None,
    measured_at: datetime | None = None,
    source_event_id: uuid.UUID | None = None,
    visit_id=None,
    enqueue: bool = True,
) -> Measurement:
    measured = measured_at or datetime.now(timezone.utc)
    measurement = Measurement(
        measurement_id=uuid.uuid4(),
        patient_id=patient_id,
        name=(concept_display or name).strip()[:500],
        series_key=series_key_for(terminology, code, concept_display or name),
        terminology=terminology,
        code=code,
        display_name=concept_display,
        value_number=value_number,
        value_text=value_text[:500],
        unit=unit,
        interpretation=MeasurementInterpretation.UNKNOWN,
        measured_at=measured,
        method="manual",
        source_type="PATIENT_REPORTED",
        verification_status="HUMAN_VERIFIED",
        polarity="positive",
        experiencer="patient",
        source_event_id=source_event_id,
    )
    db.add(measurement)
    db.flush()
    if enqueue:
        enqueue_measurement(
            db,
            measurement_id=measurement.measurement_id,
            patient_id=patient_id,
            name=measurement.name,
            series_key=measurement.series_key,
            value_number=value_number,
            value_text=measurement.value_text,
            unit=measurement.unit,
            interpretation=MeasurementInterpretation.UNKNOWN,
            terminology=terminology,
            code=code,
            display_name=concept_display,
            measured_at=measured.isoformat(),
            recorded_at=measurement.recorded_at.isoformat() if measurement.recorded_at else None,
            method="manual",
            source_type="PATIENT_REPORTED",
            verification_status="HUMAN_VERIFIED",
            polarity="positive",
            experiencer="patient",
            event_id=source_event_id,
            visit_id=visit_id,
        )
    return measurement
