"""FHIR Bundle parsing tests (stdlib-only, no backend deps).

Run: python -m pytest tests/test_fhir_bundle.py
Covers: Bundle validation, MedicationStatement/Request mapping, Observation
mapping (LOINC preference, units, ranges, flags, dates), skip accounting,
narrative blindness, and import-log honesty.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.fhir.bundle import (
    MAX_BUNDLE_ENTRIES,
    parse_bundle,
    summary_lines,
)


def _bundle(entries, **over):
    doc = {"resourceType": "Bundle", "type": "collection", "entry": entries}
    doc.update(over)
    return doc


def _entry(resource):
    return {"fullUrl": f"urn:uuid:{resource.get('id', 'x')}", "resource": resource}


MED_STATEMENT = {
    "resourceType": "MedicationStatement",
    "id": "med-1",
    "status": "active",
    "medicationCodeableConcept": {
        "coding": [
            {
                "system": "http://www.nlm.nih.gov/research/umls/rxnorm",
                "code": "12345",
                "display": "Atorvastatin 20mg",
            }
        ],
        "text": "Atorvastatin 20mg daily",
    },
    "dosage": [{"text": "1 tablet every morning"}],
    "dateAsserted": "2026-09-01",
}

LAB_OBS = {
    "resourceType": "Observation",
    "id": "obs-1",
    "status": "final",
    "category": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/observation-category", "code": "laboratory"}]}],
    "code": {
        "coding": [
            {"system": "http://loinc.org", "code": "2339-0", "display": "Glucose"},
            {"system": "http://snomed.info/sct", "code": "99999", "display": "Other"},
        ],
        "text": "Glucose",
    },
    "valueQuantity": {"value": 5.6, "unit": "mmol/L"},
    "referenceRange": [{"text": "3.9 - 5.5 mmol/L"}],
    "interpretation": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": "H"}]}],
    "effectiveDateTime": "2026-10-01T08:30:00Z",
}


def test_rejects_non_bundles():
    import pytest

    for bad, reason in [
        (None, "not-a-json-object"),
        ([], "not-a-json-object"),
        ({"resourceType": "Patient"}, "not-a-fhir-bundle"),
        ({"resourceType": "Bundle"}, "bundle-without-entries"),
        ({"resourceType": "Bundle", "entry": []}, "bundle-without-entries"),
    ]:
        with pytest.raises(ValueError, match=reason):
            parse_bundle(bad)


def test_rejects_oversized_bundle():
    import pytest

    entries = [{"resource": {"resourceType": "Patient", "id": str(i)}} for i in range(MAX_BUNDLE_ENTRIES + 1)]
    with pytest.raises(ValueError, match="bundle-too-large"):
        parse_bundle(_bundle(entries))


def test_medication_statement_maps():
    summary = parse_bundle(_bundle([_entry(MED_STATEMENT)]))
    assert len(summary.medications) == 1
    med = summary.medications[0]
    assert med.name == "Atorvastatin 20mg daily"
    assert med.status == "active"
    assert med.dosage_text == "1 tablet every morning"
    assert med.authored_on.startswith("2026-09-01")
    assert med.source_id == "med-1"


def test_medication_request_maps_and_bad_status_skips():
    req = {
        "resourceType": "MedicationRequest",
        "id": "req-1",
        "status": "active",
        "medicationCodeableConcept": {"text": "Metformin 500mg"},
        "authoredOn": "2026-08-15T10:00:00+02:00",
    }
    summary = parse_bundle(_bundle([_entry(req)]))
    assert len(summary.medications) == 1
    assert summary.medications[0].authored_on.endswith("+02:00")

    bad = dict(req, status="entered-in-error")
    summary = parse_bundle(_bundle([_entry(bad)]))
    assert summary.medications == []
    assert summary.skipped.get("MedicationRequest:status") == 1


def test_reference_only_medication_skips():
    res = {
        "resourceType": "MedicationStatement",
        "id": "m2",
        "status": "active",
        "medicationReference": {"reference": "Medication/contained-1"},
    }
    summary = parse_bundle(_bundle([_entry(res)]))
    assert summary.medications == []
    assert summary.skipped.get("MedicationStatement:reference-only") == 1


def test_lab_observation_prefers_loinc():
    summary = parse_bundle(_bundle([_entry(LAB_OBS)]))
    assert len(summary.observations) == 1
    obs = summary.observations[0]
    assert (obs.terminology, obs.code) == ("LOINC", "2339-0")
    assert obs.value == "5.6"
    assert obs.unit == "mmol/L"
    assert obs.ref_range == "3.9 - 5.5 mmol/L"
    assert obs.abnormal_flag == "H"
    assert obs.measured_at == "2026-10-01T08:30:00+00:00"
    assert obs.source_id == "obs-1"


def test_observation_status_and_category_gates():
    cancelled = dict(LAB_OBS, status="entered-in-error")
    summary = parse_bundle(_bundle([_entry(cancelled)]))
    assert summary.observations == []
    assert summary.skipped.get("Observation:status") == 1

    survey = dict(
        LAB_OBS,
        category=[{"coding": [{"code": "survey"}]}],
    )
    summary = parse_bundle(_bundle([_entry(survey)]))
    assert summary.observations == []
    assert summary.skipped.get("Observation:category") == 1


def test_observation_value_shapes():
    string_obs = dict(
        LAB_OBS,
        id="o2",
        valueQuantity=None,
        valueString="Positive",
    )
    string_obs.pop("valueQuantity", None)
    summary = parse_bundle(_bundle([_entry(string_obs)]))
    assert summary.observations[0].value == "Positive"
    assert summary.observations[0].unit is None

    valueless = dict(LAB_OBS, id="o3")
    valueless.pop("valueQuantity", None)
    summary = parse_bundle(_bundle([_entry(valueless)]))
    assert summary.observations == []
    assert summary.skipped.get("Observation:valueless") == 1


def test_range_synthesis_and_naive_dates():
    obs = dict(
        LAB_OBS,
        id="o4",
        referenceRange=[{"low": {"value": 3.9, "unit": "mmol/L"}, "high": {"value": 5.5}}],
        effectiveDateTime="2026-10-01T08:30:00",
    )
    obs.pop("interpretation", None)
    summary = parse_bundle(_bundle([_entry(obs)]))
    parsed = summary.observations[0]
    assert parsed.ref_range == "3.9 - 5.5 mmol/L"
    assert parsed.measured_at.endswith("+00:00")
    assert parsed.abnormal_flag is None


def test_unknown_resources_counted_not_fatal():
    summary = parse_bundle(
        _bundle(
            [
                _entry({"resourceType": "Patient", "id": "p1"}),
                _entry({"resourceType": "AllergyIntolerance", "id": "a1"}),
                _entry(LAB_OBS),
                {"broken": True},
            ]
        )
    )
    assert len(summary.observations) == 1
    assert summary.skipped.get("ignored:Patient") == 1
    assert summary.skipped.get("ignored:AllergyIntolerance") == 1
    assert summary.skipped.get("entry:unresolved") == 1


def test_summary_lines_carry_no_narrative():
    summary = parse_bundle(
        _bundle(
            [
                _entry(MED_STATEMENT),
                _entry(
                    dict(
                        LAB_OBS,
                        text={"div": "<div>Secret narrative nobody should store</div>"},
                    )
                ),
            ]
        )
    )
    text = summary_lines(summary)
    assert "Secret narrative" not in text
    assert "MED active: Atorvastatin 20mg daily" in text
    assert "LOINC|2339-0" in text


def _repo_src(rel):
    return (Path(__file__).resolve().parent.parent / rel).read_text()


def test_upload_allowlist_accepts_fhir_json():
    docs = _repo_src("app/api/v1/documents.py")
    assert '".json"' in docs
    assert "application/fhir+json" in docs
    assert "application/json" in docs


def test_worker_routes_json_past_ocr():
    worker = _repo_src("workers/ingestion_tasks.py")
    assert "_process_fhir_bundle" in worker
    assert 'endswith(".json")' in worker
    assert "parse_bundle" in worker
    assert "project_bundle" in worker
