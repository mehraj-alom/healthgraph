"""FHIR Bundle parsing for patient-provided record exports (ePA/IPS downloads).

Pure stdlib: dict in, normalized records out. No network, no database, no
model calls — the Celery worker and the unit tests share this module.

Scope (v1): Bundle resources MedicationStatement, MedicationRequest,
Observation (laboratory + vital-signs with a value). Everything else is
counted in ``skipped`` and ignored. Narrative XHTML (``text.div``) is
never read and never stored. Patient identity always comes from auth —
a ``Patient`` resource in the file is ignored beyond counting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

# Coding system URLs we normalize to the short terminology names the
# ontology and Measurement.series_key ("TERMINOLOGY|code") already use.
SYSTEM_TO_TERMINOLOGY = {
    "http://loinc.org": "LOINC",
    "http://snomed.info/sct": "SNOMED",
    "http://www.nlm.nih.gov/research/umls/rxnorm": "RXNORM",
}

# Observation statuses worth importing. entered-in-error / cancelled /
# unknown are clinical garbage — counted, never stored.
IMPORTABLE_OBSERVATION_STATUS = {"final", "amended", "corrected"}

# MedicationStatement.status values worth importing.
IMPORTABLE_MED_STATEMENT_STATUS = {"active", "completed"}

# MedicationRequest.status values worth importing.
IMPORTABLE_MED_REQUEST_STATUS = {"active", "completed", "on-hold"}

# Observation category codes worth importing (by code, any system).
IMPORTABLE_OB_CATEGORY = {"laboratory", "vital-signs"}

#: DoS guard: a single upload must stay reviewable by a human-scale import.
MAX_BUNDLE_ENTRIES = 5000


@dataclass
class FhirMedication:
    """One importable medication statement/request."""

    name: str
    status: str
    dosage_text: Optional[str] = None
    authored_on: Optional[str] = None
    source_id: Optional[str] = None


@dataclass
class FhirObservation:
    """One importable lab/vital observation."""

    name: str
    terminology: Optional[str] = None
    code: Optional[str] = None
    display: Optional[str] = None
    value: Optional[str] = None
    unit: Optional[str] = None
    ref_range: Optional[str] = None
    abnormal_flag: Optional[str] = None
    measured_at: Optional[str] = None
    source_id: Optional[str] = None


@dataclass
class BundleSummary:
    bundle_id: Optional[str] = None
    bundle_type: Optional[str] = None
    medications: list = field(default_factory=list)
    observations: list = field(default_factory=list)
    skipped: dict = field(default_factory=dict)

    @property
    def medications_typed(self) -> list[FhirMedication]:
        return self.medications

    @property
    def observations_typed(self) -> list[FhirObservation]:
        return self.observations


def _skip(summary: BundleSummary, reason: str) -> None:
    summary.skipped[reason] = summary.skipped.get(reason, 0) + 1


def _as_list(value: Any) -> list:
    return value if isinstance(value, list) else []


def _first_coding(concept: Any) -> Optional[dict]:
    """First coding dict of a CodeableConcept, or None."""
    if not isinstance(concept, dict):
        return None
    for coding in _as_list(concept.get("coding")):
        if isinstance(coding, dict):
            return coding
    return None


def _concept_text(concept: Any) -> Optional[str]:
    if not isinstance(concept, dict):
        return None
    text = concept.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()[:500]
    coding = _first_coding(concept)
    if coding:
        display = coding.get("display")
        if isinstance(display, str) and display.strip():
            return display.strip()[:500]
    return None


def _preferred_coding(concept: Any) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """(terminology, code, display) — LOINC first, else first known coding."""
    if not isinstance(concept, dict):
        return None, None, None
    codings = [c for c in _as_list(concept.get("coding")) if isinstance(c, dict)]
    ordered = sorted(
        codings,
        key=lambda c: 0 if c.get("system") == "http://loinc.org" else 1,
    )
    for coding in ordered:
        system = coding.get("system")
        code = coding.get("code")
        if not isinstance(code, str) or not code.strip():
            continue
        terminology = SYSTEM_TO_TERMINOLOGY.get(system) if isinstance(system, str) else None
        display = coding.get("display")
        return (
            terminology,
            code.strip()[:100],
            display.strip()[:500] if isinstance(display, str) and display.strip() else None,
        )
    return None, None, None


def _instant(value: Any) -> Optional[str]:
    """FHIR instant/dateTime/date → ISO string. Naive datetimes are UTC."""
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.isoformat()


def _dosage_text(dosages: Any) -> Optional[str]:
    for dosage in _as_list(dosages):
        if not isinstance(dosage, dict):
            continue
        text = dosage.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()[:500]
        instruction = dosage.get("patientInstruction")
        if isinstance(instruction, str) and instruction.strip():
            return instruction.strip()[:500]
    return None


def _parse_medication(resource: dict, summary: BundleSummary) -> None:
    rtype = resource.get("resourceType")
    status = resource.get("status")
    allowed = (
        IMPORTABLE_MED_STATEMENT_STATUS
        if rtype == "MedicationStatement"
        else IMPORTABLE_MED_REQUEST_STATUS
    )
    if not isinstance(status, str) or status not in allowed:
        _skip(summary, f"{rtype or 'Medication'}:status")
        return
    concept = resource.get("medicationCodeableConcept")
    if concept is None:
        # medicationReference (contained [#ID] or absolute) cannot be
        # resolved honestly without a contained-resource pass — skip.
        _skip(summary, f"{rtype or 'Medication'}:reference-only")
        return
    name = _concept_text(concept)
    if not name:
        _skip(summary, f"{rtype or 'Medication'}:unnamed")
        return
    authored = _instant(resource.get("authoredOn") or resource.get("dateAsserted"))
    summary.medications.append(
        FhirMedication(
            name=name,
            status=status,
            dosage_text=_dosage_text(resource.get("dosage")),
            authored_on=authored,
            source_id=resource.get("id") if isinstance(resource.get("id"), str) else None,
        )
    )


def _obs_value(resource: dict) -> tuple[Optional[str], Optional[str]]:
    """(value, unit) from valueQuantity / valueString / valueCodeableConcept."""
    quantity = resource.get("valueQuantity")
    if isinstance(quantity, dict):
        value = quantity.get("value")
        if isinstance(value, (int, float)):
            unit = quantity.get("unit")
            return str(value), unit.strip()[:50] if isinstance(unit, str) and unit.strip() else None
    text = resource.get("valueString")
    if isinstance(text, str) and text.strip():
        return text.strip()[:500], None
    concept = resource.get("valueCodeableConcept")
    concept_text = _concept_text(concept)
    if concept_text:
        return concept_text, None
    return None, None


def _obs_range(resource: dict) -> Optional[str]:
    for rng in _as_list(resource.get("referenceRange")):
        if not isinstance(rng, dict):
            continue
        text = rng.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()[:255]
        low = rng.get("low", {}) if isinstance(rng.get("low"), dict) else {}
        high = rng.get("high", {}) if isinstance(rng.get("high"), dict) else {}
        low_v = low.get("value") if isinstance(low.get("value"), (int, float)) else None
        high_v = high.get("value") if isinstance(high.get("value"), (int, float)) else None
        if low_v is not None or high_v is not None:
            unit = ""
            if isinstance(low, dict) and isinstance(low.get("unit"), str):
                unit = f" {low['unit'].strip()[:20]}"
            elif isinstance(high, dict) and isinstance(high.get("unit"), str):
                unit = f" {high['unit'].strip()[:20]}"
            return f"{low_v if low_v is not None else '?'} - {high_v if high_v is not None else '?'}{unit}"[:255]
    return None


def _obs_flag(resource: dict) -> Optional[str]:
    for interp in _as_list(resource.get("interpretation")):
        if not isinstance(interp, dict):
            continue
        inner = interp.get("coding", interp)
        coding = _first_coding({"coding": inner} if isinstance(inner, list) else inner)
        if coding and isinstance(coding.get("code"), str):
            return coding["code"].strip().upper()[:20]
        if isinstance(interp.get("text"), str) and interp["text"].strip():
            return interp["text"].strip().upper()[:20]
    return None


def _obs_category_ok(resource: dict) -> bool:
    categories = _as_list(resource.get("category"))
    if not categories:
        return True
    for category in categories:
        if not isinstance(category, dict):
            continue
        for coding in _as_list(category.get("coding")):
            if isinstance(coding, dict) and coding.get("code") in IMPORTABLE_OB_CATEGORY:
                return True
    return False


def _parse_observation(resource: dict, summary: BundleSummary) -> None:
    status = resource.get("status")
    if not isinstance(status, str) or status not in IMPORTABLE_OBSERVATION_STATUS:
        _skip(summary, "Observation:status")
        return
    if not _obs_category_ok(resource):
        _skip(summary, "Observation:category")
        return
    concept = resource.get("code")
    terminology, code, display = _preferred_coding(concept)
    name = _concept_text(concept) or (f"{terminology}|{code}" if code else None)
    if not name:
        _skip(summary, "Observation:uncoded")
        return
    value, unit = _obs_value(resource)
    if value is None:
        _skip(summary, "Observation:valueless")
        return
    measured = _instant(resource.get("effectiveDateTime") or resource.get("issued"))
    summary.observations.append(
        FhirObservation(
            name=name,
            terminology=terminology,
            code=code,
            display=display,
            value=value,
            unit=unit,
            ref_range=_obs_range(resource),
            abnormal_flag=_obs_flag(resource),
            measured_at=measured,
            source_id=resource.get("id") if isinstance(resource.get("id"), str) else None,
        )
    )


def parse_bundle(document: Any) -> BundleSummary:
    """Parse a FHIR Bundle dict into importable records.

    Raises ValueError on anything that is not a usable Bundle (wrong
    type, missing entries, entry overload). Individual bad resources are
    skipped with counts, never fatal.
    """
    summary = BundleSummary()
    if not isinstance(document, dict):
        raise ValueError("not-a-json-object")
    if document.get("resourceType") != "Bundle":
        raise ValueError("not-a-fhir-bundle")
    entries = document.get("entry")
    if not isinstance(entries, list) or not entries:
        raise ValueError("bundle-without-entries")
    if len(entries) > MAX_BUNDLE_ENTRIES:
        raise ValueError("bundle-too-large")
    bundle_id = document.get("id")
    summary.bundle_id = bundle_id if isinstance(bundle_id, str) else None
    bundle_type = document.get("type")
    summary.bundle_type = bundle_type if isinstance(bundle_type, str) else None
    for wrapper in entries:
        resource = wrapper.get("resource") if isinstance(wrapper, dict) else None
        if not isinstance(resource, dict):
            _skip(summary, "entry:unresolved")
            continue
        rtype = resource.get("resourceType")
        if rtype in ("MedicationStatement", "MedicationRequest"):
            _parse_medication(resource, summary)
        elif rtype == "Observation":
            _parse_observation(resource, summary)
        else:
            _skip(summary, f"ignored:{rtype}" if isinstance(rtype, str) else "ignored:untyped")
    return summary


def summary_lines(summary: BundleSummary) -> str:
    """Human-readable import log. Counts and codes only — never PHI."""
    lines = [
        f"FHIR Bundle {summary.bundle_id or 'unidentified'} ({summary.bundle_type or 'untyped'}): "
        f"{len(summary.medications)} medications, {len(summary.observations)} observations."
    ]
    for med in summary.medications:
        lines.append(f"MED {med.status}: {med.name}")
    for obs in summary.observations:
        code = f"{obs.terminology}|{obs.code}" if obs.code else "uncoded"
        lines.append(f"OBS {code} {obs.name}: {obs.value} {obs.unit or ''}".rstrip())
    if summary.skipped:
        skipped = ", ".join(f"{k}×{v}" for k, v in sorted(summary.skipped.items()))
        lines.append(f"Skipped: {skipped}.")
    return "\n".join(lines)
