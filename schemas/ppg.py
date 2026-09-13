"""Camera-PPG derived-measurement schemas.

Privacy contract (hard requirement):
- The backend receives ONLY compact derived measurements.
- Raw camera frames, video, and raw PPG streams are NEVER accepted here.
  ``extra="forbid"`` actively rejects payloads containing raw-signal fields
  (e.g. ``frames``, ``video``, ``rawPpg``) so a misbehaving client fails
  loudly instead of silently uploading bulk sensor data.

Engineering foundation: PPGbetter (MIT) green-channel acquisition approach,
adapted for on-device processing. PPGbetter is a research/engineering
reference, NOT a certified medical-device algorithm. No BP estimation, no
diagnostic claims (see module docstrings and product copy guards).
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MIN_RELIABLE_QUALITY = 0.5
MIN_RELIABLE_DURATION_S = 30
MIN_HEART_RATE_BPM = 25
MAX_HEART_RATE_BPM = 250
ALGORITHM_VERSION_PATTERN = r"^ppg-\d+\.\d+\.\d+$"


class PpgMeasurementCreate(BaseModel):
    """Compact derived measurement produced entirely on-device."""

    model_config = ConfigDict(extra="forbid")

    measurementType: Literal["camera_ppg"] = "camera_ppg"
    measuredAt: datetime
    heartRateBpm: float | None = Field(default=None, ge=MIN_HEART_RATE_BPM, le=MAX_HEART_RATE_BPM)
    signalQuality: float = Field(ge=0.0, le=1.0)
    durationSeconds: int = Field(ge=10, le=300)
    rmssdMs: float | None = Field(default=None, ge=0.0, le=500.0)
    sdnnMs: float | None = Field(default=None, ge=0.0, le=500.0)
    rrIntervalsMs: list[float] | None = Field(default=None, max_length=600)
    algorithmVersion: str = Field(pattern=ALGORITHM_VERSION_PATTERN)

    @field_validator("rrIntervalsMs")
    @classmethod
    def _validate_rr(cls, v: list[float] | None) -> list[float] | None:
        if v is None:
            return v
        # Physiological plausibility window: 300–2000 ms per beat.
        for x in v:
            if not (300.0 <= x <= 2000.0):
                raise ValueError("rrIntervalsMs values must be within 300–2000 ms")
        return v


class PpgMeasurementResponse(BaseModel):
    measurementId: str
    measurementType: Literal["camera_ppg"] = "camera_ppg"
    measuredAt: datetime
    heartRateBpm: float | None
    signalQuality: float
    durationSeconds: int
    rmssdMs: float | None = None
    sdnnMs: float | None = None
    rrIntervalsMs: list[float] | None = None
    algorithmVersion: str
    reliable: bool


def is_reliable(heart_rate_bpm: float | None, signal_quality: float, duration_s: int) -> bool:
    """Server-side reliability gate. Never trust a client 'reliable' flag."""
    return (
        heart_rate_bpm is not None
        and signal_quality >= MIN_RELIABLE_QUALITY
        and duration_s >= MIN_RELIABLE_DURATION_S
    )
