"""Dedicated prescription extraction schema (NOT the generic lab-report one).

The generic EXTRACTION_SCHEMA is document-centric (report/patient/labs) —
prescription scans pushed through it yield loose text the user must retype.
This schema is medication-centric: one object per prescribed medicine with
fields aligned 1:1 to MedicationCreate, so the review UI pre-fills the Add
Medication form and the user only confirms or tweaks.

Each medicine carries ``confidence`` (0-1), ``needs_review`` and
``review_reasons`` so the UI can badge shaky rows instead of blocking the
whole prescription on them.
"""

import json

FREQUENCIES = [
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
]

ROUTES = [
    "ORAL",
    "TOPICAL",
    "INJECTION",
    "INHALED",
    "SUBLINGUAL",
    "RECTAL",
    "NASAL",
    "OPHTHALMIC",
    "OTHER",
]

PRESCRIPTION_MED_SCHEMA = {
    "type": "object",
    "description": (
        "A clinician-written prescription. Extract EVERY medicine listed, "
        "even if handwriting is partial — mark low confidence instead of "
        "dropping the row. Never invent medicines, doses, or times that are "
        "not written on the page."
    ),
    "properties": {
        "prescriber": {
            "type": "string",
            "description": "Prescribing clinician name as written, empty string if absent.",
        },
        "prescription_date": {
            "type": "string",
            "description": "Date written on the prescription in YYYY-MM-DD, empty string if absent.",
        },
        "pharmacy": {
            "type": "string",
            "description": "Pharmacy name if printed, empty string if absent.",
        },
        "medications": {
            "type": "array",
            "description": "One entry per prescribed medicine, in page order.",
            "items": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "Medicine name exactly as written (brand or generic).",
                    },
                    "generic_name": {"type": "string", "description": "Generic name if distinguishable, else empty string."},
                    "brand_name": {"type": "string", "description": "Brand name if distinguishable, else empty string."},
                    "strength": {"type": "string", "description": "Strength number as written, e.g. '500'. Empty if absent."},
                    "strength_unit": {"type": "string", "description": "Strength unit, e.g. 'mg', 'mcg', 'ml'. Empty if absent."},
                    "dose_amount": {
                        "type": "number",
                        "description": "Amount per dose as a number, e.g. 1 for '1 tablet'. Null if absent.",
                    },
                    "dose_unit": {
                        "type": "string",
                        "description": "Dose unit, e.g. 'tablet', 'capsule', 'ml', 'puff'. Empty if absent.",
                    },
                    "route": {
                        "type": "string",
                        "enum": ROUTES,
                        "description": "Route of administration. Use OTHER when unclear.",
                    },
                    "frequency": {
                        "type": "string",
                        "enum": FREQUENCIES,
                        "description": (
                            "Dosing frequency using exactly one of the allowed values. "
                            "'1-0-1' or 'twice daily' is TWICE_DAILY; 'as needed'/'SOS' "
                            "is AS_NEEDED; anything unmappable is CUSTOM with the raw "
                            "text in instructions."
                        ),
                    },
                    "scheduled_times": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": (
                            "Dose times as HH:MM 24h. Use written times when present; "
                            "otherwise suggest sensible defaults for the frequency "
                            "(morning ~09:00, evening ~21:00). Empty array if none."
                        ),
                    },
                    "duration_text": {
                        "type": "string",
                        "description": "Duration as written, e.g. 'for 10 days', 'x 1 month'. Empty if absent.",
                    },
                    "start_date": {"type": "string", "description": "Start date YYYY-MM-DD if derivable, else empty string."},
                    "end_date": {"type": "string", "description": "End date YYYY-MM-DD if derivable, else empty string."},
                    "quantity": {"type": "string", "description": "Dispensed quantity as written, e.g. '30 tablets'. Empty if absent."},
                    "refills": {"type": "string", "description": "Refill count as written. Empty if absent."},
                    "purpose": {"type": "string", "description": "Condition/reason if written, else empty string."},
                    "instructions": {
                        "type": "string",
                        "description": "Administration instructions: with food, before bed, etc. Raw frequency text goes here when frequency is CUSTOM.",
                    },
                    "warnings": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Cautions printed on the prescription (alcohol, driving, pregnancy...).",
                    },
                    "confidence": {
                        "type": "number",
                        "description": "0-1: legibility/completeness of THIS row. Below 0.6 the UI flags review.",
                    },
                    "needs_review": {
                        "type": "boolean",
                        "description": "True when any critical field (name, dose, frequency) is guessed or missing.",
                    },
                    "review_reasons": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "Short reasons, e.g. 'dose unreadable', 'frequency ambiguous'.",
                    },
                },
                "required": ["name", "frequency", "confidence", "needs_review"],
            },
        },
    },
    "required": ["medications"],
}


def prescription_schema_json() -> str:
    """Serialized schema for the ADE v2 extract call."""
    return json.dumps(PRESCRIPTION_MED_SCHEMA)
