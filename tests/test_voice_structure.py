"""Whole-answer check-in extraction contract (slice A2).

Tests the pure contract module only (no app import — the full app needs
the CI environment). Route behavior (auth, caps, sidecar mapping) mirrors
test_voice_transcribe.py patterns and runs in CI via pr-checks.
"""
from app.services.checkin_extract import (
    EXTRACTION_FIELDS,
    EXTRACTION_PROMPT,
    CheckinExtraction,
    clamp_fields,
)


def test_schema_has_exactly_five_optional_fields():
    assert set(CheckinExtraction.model_fields.keys()) == set(EXTRACTION_FIELDS)
    blank = CheckinExtraction()
    assert all(getattr(blank, f) is None for f in EXTRACTION_FIELDS)


def test_prompt_constrains_to_fields_or_null():
    prompt = EXTRACTION_PROMPT.lower()
    for field in EXTRACTION_FIELDS:
        assert field in prompt, field
    assert "null" in prompt
    assert "never guess" in prompt


def test_clamp_scales_snap_1_to_5():
    out = clamp_fields({"overall_wellbeing": 4, "energy_level": 3.4, "stress_level": 2.6})
    assert out["overall_wellbeing"] == 4
    assert out["energy_level"] == 3
    assert out["stress_level"] == 3


def test_clamp_rejects_out_of_range_and_nonsense():
    out = clamp_fields({
        "overall_wellbeing": 99,
        "energy_level": 0,
        "stress_level": "high",
        "sleep_hours": 30,
        "water_glasses": -1,
    })
    assert out == {
        "overall_wellbeing": None,
        "energy_level": None,
        "stress_level": None,
        "sleep_hours": None,
        "water_glasses": None,
    }


def test_clamp_sleep_halves_and_water_wholes():
    out = clamp_fields({"sleep_hours": 7.5, "water_glasses": 2.0})
    assert out["sleep_hours"] == 7.5
    assert out["water_glasses"] == 2
    assert clamp_fields({}) == {f: None for f in EXTRACTION_FIELDS}
    assert clamp_fields(None) == {f: None for f in EXTRACTION_FIELDS}
    assert clamp_fields({"overall_wellbeing": True})["overall_wellbeing"] is None
