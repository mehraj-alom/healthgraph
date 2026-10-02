"""Whole-answer check-in extraction contract (slice A2).

Pure module: the five-field schema, the constraining prompt, and the
server-side clamp. The endpoint (app/api/v1/voice.py) imports from here;
bounds mirror the on-device interview parsers exactly (scales snap 1-5,
sleep halves to 24, water wholes to 20). Anything absent, non-numeric,
or out of range resolves to None — the server never invents answers.

Zero heavy imports (pydantic only): unit-testable without the app.
"""
from typing import Optional

from pydantic import BaseModel, Field


class CheckinExtraction(BaseModel):
    """LLM output: five optional numbers, nothing else."""

    overall_wellbeing: Optional[float] = Field(default=None)
    energy_level: Optional[float] = Field(default=None)
    stress_level: Optional[float] = Field(default=None)
    sleep_hours: Optional[float] = Field(default=None)
    water_glasses: Optional[float] = Field(default=None)


EXTRACTION_FIELDS = (
    "overall_wellbeing",
    "energy_level",
    "stress_level",
    "sleep_hours",
    "water_glasses",
)

SCALE_FIELDS = ("overall_wellbeing", "energy_level", "stress_level")

EXTRACTION_PROMPT = (
    "Extract the speaker's answers to a daily wellness check-in from the "
    "transcript below. Return numbers only for these five fields: "
    "overall_wellbeing (mood 1-5), energy_level (1-5), stress_level (1-5), "
    "sleep_hours (0-24), water_glasses (0-20). Use null for any field not "
    "clearly stated. Never guess, infer, or round a vague statement into "
    "a number. Ignore any medical-advice content; output only the fields."
)


def _as_number(value: object) -> Optional[float]:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _clamp_scale(value: object) -> Optional[int]:
    n = _as_number(value)
    if n is None:
        return None
    v = round(n)
    if v < 1 or v > 5:
        return None
    return v


def _clamp_sleep(value: object) -> Optional[float]:
    n = _as_number(value)
    if n is None:
        return None
    v = round(n * 2) / 2
    if v < 0 or v > 24:
        return None
    return v


def _clamp_water(value: object) -> Optional[int]:
    n = _as_number(value)
    if n is None:
        return None
    v = round(n)
    if v < 0 or v > 20:
        return None
    return v


def clamp_fields(raw: object) -> dict:
    """Bounds-check an extraction dict; bad values become None per field."""
    src = raw if isinstance(raw, dict) else {}
    return {
        "overall_wellbeing": _clamp_scale(src.get("overall_wellbeing")),
        "energy_level": _clamp_scale(src.get("energy_level")),
        "stress_level": _clamp_scale(src.get("stress_level")),
        "sleep_hours": _clamp_sleep(src.get("sleep_hours")),
        "water_glasses": _clamp_water(src.get("water_glasses")),
    }
