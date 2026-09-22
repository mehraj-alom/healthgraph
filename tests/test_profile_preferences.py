"""
Profile preferences mirror tests (goals + focus backup on the patient row).

Pure tests, no database required: schema sanitization, JSON round-trip,
and endpoint logic against a stubbed session. The device is the source
of truth — the server stores exactly what the device sends (sanitized)
and echoes it back on GET.
"""

import json
import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.v1.profile import _decode_ids, get_profile, update_profile
from schemas.profile import PatientProfileUpdate, clean_id_list


class TestCleanIdList:
    def test_none_passthrough(self):
        assert clean_id_list(None) is None

    def test_strings_trimmed_and_capped(self):
        assert clean_id_list(['  sleep ', 'heart']) == ['sleep', 'heart']
        assert len(clean_id_list([f'id-{i}' for i in range(50)])) == 20

    def test_non_strings_dropped(self):
        assert clean_id_list(['sleep', 42, None, {'x': 1}, 'heart']) == ['sleep', 'heart']


class TestDecodeIds:
    def test_round_trip(self):
        assert _decode_ids(json.dumps(['sleep', 'heart'])) == ['sleep', 'heart']

    def test_empty_and_corrupt_read_as_unset(self):
        assert _decode_ids(None) is None
        assert _decode_ids('') is None
        assert _decode_ids('[]') is None
        assert _decode_ids('not-json{{{') is None
        assert _decode_ids(json.dumps('sleep')) is None


def _session_with(patient: SimpleNamespace) -> MagicMock:
    db = MagicMock()
    db.get.return_value = patient
    return db


def _patient() -> SimpleNamespace:
    return SimpleNamespace(
        patient_id=uuid.uuid4(),
        full_name=None,
        phone_number=None,
        height_cm=None,
        weight_kg=None,
        goals_json=None,
        focus_json=None,
    )


class TestPreferencesMirror:
    def test_put_stores_sanitized_mirror(self):
        patient = _patient()
        db = _session_with(patient)
        resp = update_profile(
            PatientProfileUpdate(goals=[' sleep ', 42, 'heart'], focus=['fitness']),
            patient.patient_id,
            db,
        )
        assert json.loads(patient.goals_json) == ['sleep', 'heart']
        assert json.loads(patient.focus_json) == ['fitness']
        assert resp.goals == ['sleep', 'heart']
        assert resp.focus == ['fitness']
        db.commit.assert_called_once()

    def test_put_omitted_fields_untouched(self):
        patient = _patient()
        patient.goals_json = json.dumps(['sleep'])
        db = _session_with(patient)
        update_profile(PatientProfileUpdate(display_name='Test'), patient.patient_id, db)
        assert json.loads(patient.goals_json) == ['sleep']

    def test_put_explicit_null_clears_mirror(self):
        patient = _patient()
        patient.focus_json = json.dumps(['fitness'])
        db = _session_with(patient)
        update_profile(PatientProfileUpdate(focus=None), patient.patient_id, db)
        assert patient.focus_json is None

    def test_get_echoes_mirror(self):
        patient = _patient()
        patient.goals_json = json.dumps(['sleep'])
        patient.focus_json = 'corrupt{{{'
        db = _session_with(patient)
        resp = get_profile(patient.patient_id, db)
        assert resp.goals == ['sleep']
        assert resp.focus is None
