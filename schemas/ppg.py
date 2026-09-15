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
MIN_RELIABLE_RPPG_DURATION_S = 5
MIN_HEART_RATE_BPM = 25
MAX_HEART_RATE_BPM = 250
ALGORITHM_VERSION_PATTERN = r"^(ppg|rppg)-\d+\.\d+\.\d+$"
MODEL_VERSION_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"


class PpgMeasurementCreate(BaseModel):
    """Compact derived measurement produced entirely on-device."""

    model_config = ConfigDict(extra="forbid")

    measurementType: Literal["camera_ppg", "face_rppg"] = "camera_ppg"
    measuredAt: datetime
    heartRateBpm: float | None = Field(default=None, ge=MIN_HEART_RATE_BPM, le=MAX_HEART_RATE_BPM)
    signalQuality: float = Field(ge=0.0, le=1.0)
    # Floor 5 s: a face-rPPG window seals ~160 frames (~5 s at 30 fps).
    # Fingertip sessions still run 10–300 s natively; the reliability gate
    # below keeps the modality-aware minimum durations.
    durationSeconds: int = Field(ge=5, le=300)
    rmssdMs: float | None = Field(default=None, ge=0.0, le=500.0)
    sdnnMs: float | None = Field(default=None, ge=0.0, le=500.0)
    rrIntervalsMs: list[float] | None = Field(default=None, max_length=600)
    algorithmVersion: str = Field(pattern=ALGORITHM_VERSION_PATTERN)
    # Face-rPPG provenance (ignored for fingertip payloads, stays None).
    # HRV is unavailable for the short rPPG window: rmssd/sdnn/rr stay null.
    modelVersion: str | None = Field(default=None, max_length=64, pattern=MODEL_VERSION_PATTERN)
    samplingRateHz: float | None = Field(default=None, ge=1.0, le=120.0)

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
    measurementType: Literal["camera_ppg", "face_rppg"] = "camera_ppg"
    measuredAt: datetime
    heartRateBpm: float | None
    signalQuality: float
    durationSeconds: int
    rmssdMs: float | None = None
    sdnnMs: float | None = None
    rrIntervalsMs: list[float] | None = None
    algorithmVersion: str
    modelVersion: str | None = None
    samplingRateHz: float | None = None
    reliable: bool


def is_reliable(
    heart_rate_bpm: float | None,
    signal_quality: float,
    duration_s: int,
    measurement_type: str = "camera_ppg",
) -> bool:
    """Server-side reliability gate. Never trust a client 'reliable' flag.

    Minimum duration is modality-aware: fingertip sessions run ~60 s while a
    face-rPPG capture seals a 160-frame window (~5 s at 30 fps).
    """
    min_duration = (
        MIN_RELIABLE_RPPG_DURATION_S
        if measurement_type == "face_rppg"
        else MIN_RELIABLE_DURATION_S
    )
    return (
        heart_rate_bpm is not None
        and signal_quality >= MIN_RELIABLE_QUALITY
        and duration_s >= min_duration
    )
