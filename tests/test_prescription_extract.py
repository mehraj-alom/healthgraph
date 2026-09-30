"""Prescription-medicine extraction tests (no DB, no network, no LLM).

Covers the pure normalizer: enum constraining, clock-time validation and
defaults, dose coercion, confidence clamping, and review flagging — the
contract the review UI pre-fills from.
"""
import json

from services.ocr.prescription_extract import (
    normalize_medicine,
    normalize_prescription_result,
)
from services.ocr.prescription_schema import prescription_schema_json


class TestSchema:
    def test_schema_is_valid_json_with_required_medicine_fields(self):
        schema = json.loads(prescription_schema_json())
        med_props = schema["properties"]["medications"]["items"]["properties"]
        for field in ("name", "frequency", "confidence", "needs_review"):
            assert field in med_props
        assert set(schema["properties"]["medications"]["items"]["required"]) == {
            "name",
            "frequency",
            "confidence",
            "needs_review",
        }
        assert "TWICE_DAILY" in med_props["frequency"]["enum"]
        assert "AS_NEEDED" in med_props["frequency"]["enum"]


class TestNormalizeMedicine:
    def test_clean_row_passes_through(self):
        med = normalize_medicine({
            "name": "Amoxicillin",
            "strength": "500",
            "strength_unit": "mg",
            "dose_amount": 1,
            "dose_unit": "capsule",
            "route": "oral",
            "frequency": "TWICE_DAILY",
            "scheduled_times": ["09:00", "21:00"],
            "confidence": 0.9,
            "needs_review": False,
        })
        assert med["name"] == "Amoxicillin"
        assert med["frequency"] == "TWICE_DAILY"
        assert med["scheduled_times"] == ["09:00", "21:00"]
        assert med["route"] == "ORAL"
        assert med["needs_review"] is False
        assert med["review_reasons"] == []

    def test_unknown_frequency_becomes_custom_with_reason(self):
        med = normalize_medicine({"name": "X", "frequency": "every lunch", "confidence": 0.9})
        assert med["frequency"] == "CUSTOM"
        assert med["needs_review"] is True
        assert any("every lunch" in r for r in med["review_reasons"])

    def test_times_defaulted_per_frequency_and_validated(self):
        med = normalize_medicine({"name": "X", "frequency": "TWICE_DAILY", "confidence": 0.9})
        assert med["scheduled_times"] == ["09:00", "21:00"]
        med = normalize_medicine({
            "name": "X",
            "frequency": "ONCE_DAILY",
            "scheduled_times": ["25:00", "09:00", "9pm", "09:00"],
            "confidence": 0.9,
        })
        assert med["scheduled_times"] == ["09:00", "21:00"]

    def test_garbage_dose_flagged_not_fatal(self):
        med = normalize_medicine({"name": "X", "frequency": "ONCE_DAILY", "dose_amount": "a lot", "confidence": 0.9})
        assert med["dose_amount"] is None
        assert med["needs_review"] is True

    def test_low_confidence_and_missing_name_flag_review(self):
        med = normalize_medicine({"name": "", "frequency": "ONCE_DAILY", "confidence": 0.4})
        assert med["needs_review"] is True
        assert med["review_reasons"] != []

    def test_confidence_clamped(self):
        assert normalize_medicine({"name": "X", "frequency": "ONCE_DAILY", "confidence": 7})["confidence"] == 1.0
        assert normalize_medicine({"name": "X", "frequency": "ONCE_DAILY", "confidence": -2})["confidence"] == 0.0


class TestNormalizeResult:
    def test_top_level_fields_and_non_list_meds(self):
        out = normalize_prescription_result({
            "prescriber": " Dr Who ",
            "prescription_date": "2026-09-01",
            "medications": "not-a-list",
        })
        assert out["prescriber"] == "Dr Who"
        assert out["medications"] == []

    def test_empty_result(self):
        out = normalize_prescription_result(None)
        assert out == {"prescriber": None, "prescription_date": None, "pharmacy": None, "medications": []}


class TestSupplyParsing:
    def test_quantity_and_refills_parsed(self):
        from services.ocr.prescription_extract import normalize_medicine
        med = normalize_medicine({
            "name": "X",
            "frequency": "ONCE_DAILY",
            "quantity": "30 tablets",
            "refills": "2",
            "confidence": 0.9,
        })
        assert med["supply_quantity"] == 30.0
        assert med["refills_left"] == 2

    def test_unparseable_supply_is_none(self):
        from services.ocr.prescription_extract import normalize_medicine
        med = normalize_medicine({"name": "X", "frequency": "ONCE_DAILY", "confidence": 0.9})
        assert med["supply_quantity"] is None
        assert med["refills_left"] is None
