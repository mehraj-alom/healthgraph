"""Tests for the camera-PPG derived-only backend contract."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from schemas.ppg import PpgMeasurementCreate, is_reliable


def _base(**overrides):
    data = {
        "measurementType": "camera_ppg",
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "heartRateBpm": 68,
        "signalQuality": 0.94,
        "durationSeconds": 60,
        "algorithmVersion": "ppg-1.0.0",
    }
    data.update(overrides)
    return data


def test_valid_derived_payload():
    m = PpgMeasurementCreate(**_base())
    assert m.heartRateBpm == 68
    assert m.signalQuality == 0.94


def test_valid_payload_with_hrv():
    m = PpgMeasurementCreate(**_base(rmssdMs=42.3, sdnnMs=51.7))
    assert m.rmssdMs == 42.3


def test_raw_frames_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(frames=[1, 2, 3]))


def test_raw_video_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(video="base64..."))


def test_raw_ppg_stream_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(rawPpg=[0.1, 0.2]))


def test_bp_fields_rejected_on_ppg_path():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(systolicBp=120, diastolicBp=80))


def test_low_quality_is_unreliable():
    assert not is_reliable(68, 0.2, 60)


def test_null_hr_is_unreliable():
    assert not is_reliable(None, 0.94, 60)


def test_short_duration_is_unreliable():
    assert not is_reliable(68, 0.94, 15)


def test_good_measurement_is_reliable():
    assert is_reliable(68, 0.94, 60)


def test_implausible_rr_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(rrIntervalsMs=[50.0]))


def test_bad_algorithm_version_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_base(algorithmVersion="v1"))
