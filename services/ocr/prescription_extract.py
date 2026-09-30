"""Prescription-medicine extraction: scan markdown -> form-ready medicine rows.

Uses the dedicated PRESCRIPTION_MED_SCHEMA (not the generic lab-report
schema), then normalizes every row into MedicationCreate-compatible
payloads the review UI can pre-fill 1:1:
- frequency constrained to the MedicationFrequency enum (unmappable ->
  CUSTOM with raw text preserved in instructions, flagged for review)
- scheduled_times validated to HH:MM, defaulted per frequency when absent
- dose_amount coerced to float, garbage -> None + review flag
"""
import json
import re

from logger import logger

from services.ocr.extraction import get_ade_client
from services.ocr.prescription_schema import prescription_schema_json

VALID_FREQUENCIES = {
    "ONCE_DAILY",
    "TWICE_DAILY",
    "THREE_TIMES_DAILY",
    "FOUR_TIMES_DAILY",
    "EVERY_MORNING",
    "EVERY_EVENING",
    "EVERY_NIGHT",
    "EVERY_8_HOURS",
    "EVERY_12_HOURS",
    "WEEKLY",
    "AS_NEEDED",
    "CUSTOM",
}

# Sensible defaults when the page gives frequency but no clock times.
DEFAULT_TIMES = {
    "ONCE_DAILY": ["09:00"],
    "TWICE_DAILY": ["09:00", "21:00"],
    "THREE_TIMES_DAILY": ["09:00", "14:00", "21:00"],
    "FOUR_TIMES_DAILY": ["08:00", "13:00", "18:00", "22:00"],
    "EVERY_MORNING": ["08:00"],
    "EVERY_EVENING": ["18:00"],
    "EVERY_NIGHT": ["22:00"],
    "EVERY_8_HOURS": ["08:00", "16:00", "00:00"],
    "EVERY_12_HOURS": ["09:00", "21:00"],
    "WEEKLY": ["09:00"],
    "AS_NEEDED": [],
    "CUSTOM": [],
}

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _clean_str(value) -> str:
    return value.strip() if isinstance(value, str) else ""


def _clean_times(raw) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for t in raw:
        if not isinstance(t, str):
            continue
        t = t.strip()
        # Accept "9am"/"9:00 pm" style leftovers from the model.
        m = re.match(r"^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?$", t, re.IGNORECASE)
        if m:
            hour = int(m.group(1)) % 12
            if m.group(3).lower() == "p":
                hour += 12
            t = f"{hour:02d}:{m.group(2) or '00'}"
        if _TIME_RE.match(t) and t not in out:
            out.append(t)
    return out


def _clean_float(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _leading_number(text) -> float | None:
    """Parse the leading number of strings like '30 tablets' or '2'."""
    import re as _re

    if isinstance(text, (int, float)):
        return float(text)
    if not isinstance(text, str):
        return None
    m = _re.match(r"\s*(\d+(?:[.,]\d+)?)", text)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", "."))
    except ValueError:
        return None


def normalize_medicine(raw: dict) -> dict:
    """Normalize one raw model row into a form-ready medicine dict."""
    raw = raw if isinstance(raw, dict) else {}
    review_reasons = [r for r in (raw.get("review_reasons") or []) if isinstance(r, str)]

    frequency = _clean_str(raw.get("frequency")).upper().replace(" ", "_")
    if frequency not in VALID_FREQUENCIES:
        if frequency:
            review_reasons.append(f"frequency '{raw.get('frequency')}' mapped to CUSTOM")
        frequency = "CUSTOM"

    times = _clean_times(raw.get("scheduled_times"))
    if not times:
        times = list(DEFAULT_TIMES[frequency])

    dose = _clean_float(raw.get("dose_amount"))
    if raw.get("dose_amount") not in (None, "") and dose is None:
        review_reasons.append("dose amount unreadable")

    name = _clean_str(raw.get("name"))
    if not name:
        review_reasons.append("medicine name missing")

    try:
        confidence = float(raw.get("confidence", 0) or 0)
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    needs_review = bool(raw.get("needs_review")) or confidence < 0.6 or bool(review_reasons)

    route = _clean_str(raw.get("route")).upper() or "ORAL"

    return {
        "name": name,
        "generic_name": _clean_str(raw.get("generic_name")) or None,
        "brand_name": _clean_str(raw.get("brand_name")) or None,
        "strength": _clean_str(raw.get("strength")) or None,
        "strength_unit": _clean_str(raw.get("strength_unit")) or None,
        "dose_amount": dose,
        "dose_unit": _clean_str(raw.get("dose_unit")) or None,
        "route": route,
        "frequency": frequency,
        "scheduled_times": times,
        "duration_text": _clean_str(raw.get("duration_text")) or None,
        "start_date": _clean_str(raw.get("start_date")) or None,
        "end_date": _clean_str(raw.get("end_date")) or None,
        "quantity": _clean_str(raw.get("quantity")) or None,
        "refills": _clean_str(raw.get("refills")) or None,
        "supply_quantity": _leading_number(raw.get("quantity")),
        "refills_left": (
            int(_leading_number(raw.get("refills")))
            if _leading_number(raw.get("refills")) is not None
            else None
        ),
        "purpose": _clean_str(raw.get("purpose")) or None,
        "instructions": _clean_str(raw.get("instructions")) or None,
        "warnings": [w for w in (raw.get("warnings") or []) if isinstance(w, str)],
        "confidence": confidence,
        "needs_review": needs_review,
        "review_reasons": review_reasons,
    }


def normalize_prescription_result(result: dict) -> dict:
    """Normalize a raw ADE extraction into the review-screen contract."""
    result = result if isinstance(result, dict) else {}
    meds = result.get("medications")
    if not isinstance(meds, list):
        meds = []
    return {
        "prescriber": _clean_str(result.get("prescriber")) or None,
        "prescription_date": _clean_str(result.get("prescription_date")) or None,
        "pharmacy": _clean_str(result.get("pharmacy")) or None,
        "medications": [normalize_medicine(m) for m in meds],
    }


def _coerce_extraction_payload(payload) -> dict:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            parsed = json.loads(payload)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def extract_prescription_meds(markdown_text: str) -> dict:
    """Run the prescription schema over scan markdown; return normalized rows."""
    if not markdown_text or not markdown_text.strip():
        raise ValueError("No extracted scan text available yet.")
    try:
        client = get_ade_client()
        raw = client.extract_(markdown_text, schema=prescription_schema_json())
    except Exception as e:
        logger.warning("Prescription medicine extraction failed (%s).", type(e).__name__)
        raise RuntimeError("Medicine extraction is unavailable right now. Try again later.")
    payload = raw.get("extraction", raw) if isinstance(raw, dict) else {}
    return normalize_prescription_result(_coerce_extraction_payload(payload))
