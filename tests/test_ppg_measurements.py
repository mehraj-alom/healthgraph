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


def _rppg_base(**overrides):
    data = {
        "measurementType": "face_rppg",
        "measuredAt": datetime.now(timezone.utc).isoformat(),
        "heartRateBpm": 71,
        "signalQuality": 0.82,
        "durationSeconds": 6,
        "algorithmVersion": "rppg-1.0.0",
        "modelVersion": "physformer-rppg-1.0.0",
        "samplingRateHz": 30.0,
    }
    data.update(overrides)
    return data


def test_valid_face_rppg_payload():
    m = PpgMeasurementCreate(**_rppg_base())
    assert m.measurementType == "face_rppg"
    assert m.modelVersion == "physformer-rppg-1.0.0"
    assert m.samplingRateHz == 30.0
    # HRV stays null for face rPPG: the short window cannot support it.
    assert m.rmssdMs is None
    assert m.sdnnMs is None
    assert m.rrIntervalsMs is None


def test_face_rppg_without_optional_provenance():
    m = PpgMeasurementCreate(**_rppg_base(modelVersion=None, samplingRateHz=None))
    assert m.modelVersion is None
    assert m.samplingRateHz is None


def test_unknown_measurement_type_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(measurementType="wrist_band"))


def test_fingertip_algorithm_version_rejected_on_face_path():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(algorithmVersion="ppg-1.1.0-x"))


def test_bad_model_version_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(modelVersion="not a version!!"))


def test_implausible_sampling_rate_rejected():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(samplingRateHz=240.0))


def test_raw_frames_rejected_on_face_path():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(frames=[1, 2, 3]))


def test_raw_video_rejected_on_face_path():
    with pytest.raises(ValidationError):
        PpgMeasurementCreate(**_rppg_base(faceVideo="base64..."))


def test_face_window_short_duration_is_reliable():
    # 160-frame window (~5 s at 30 fps) is a complete face capture.
    assert is_reliable(71, 0.82, 6, "face_rppg")


def test_same_duration_unreliable_for_fingertip():
    # Identical duration stays unreliable on the fingertip path (30 s rule).
    assert not is_reliable(71, 0.82, 6, "camera_ppg")


def test_face_null_hr_is_unreliable():
    assert not is_reliable(None, 0.82, 6, "face_rppg")
