"""P10 longitudinal validation tests (no DB / Neo4j / network).

Covers the 24 P10 categories against the query contract
(resolve_window / query_day_range / group_records) with a fake
driver, plus boundary-rule, midnight, dedupe, isolation, P9-compat,
and determinism assertions. Live Neo4j evidence is recorded in the
P10 validation report, not here.
"""
import uuid
from datetime import date

import pytest

from services.retrieval import day_range as dr
from services.retrieval import templates as tpl


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def data(self):
        return list(self._rows)


class _FakeDriver:
    def __init__(self, rows):
        self._rows = rows
        self.seen_params: dict = {}
        self.calls = 0

    def session(self):
        outer = self

        class _Session:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cypher, **params):
                outer.seen_params = params
                outer.calls += 1
                assert "HAS_DAY" in cypher and "HAS_EVENT" in cypher
                return _Rows(outer._rows)

        return _Session()


def _row(day, kind, eid, exact):
    return {"day": day, "kind": kind, "event_id": eid, "exact_time": exact}


@pytest.fixture()
def pid():
    return uuid.uuid4()


class TestPresets:
    TODAY = date(2026, 9, 20)

    def test_today_yesterday(self):
        assert dr.resolve_window("today", self.TODAY) == ("2026-09-20", "2026-09-20")
        assert dr.resolve_window("yesterday", self.TODAY) == ("2026-09-19", "2026-09-19")

    def test_day_windows(self):
        assert dr.resolve_window("last_7_days", self.TODAY) == ("2026-09-14", "2026-09-20")
        assert dr.resolve_window("last_30_days", self.TODAY) == ("2026-08-22", "2026-09-20")

    def test_calendar_months(self):
        assert dr.resolve_window("last_2_months", self.TODAY) == ("2026-08-01", "2026-09-20")
        assert dr.resolve_window("last_6_months", self.TODAY) == ("2026-04-01", "2026-09-20")

    def test_custom_and_rejections(self):
        assert dr.resolve_window("2026-09-01:2026-09-20") == ("2026-09-01", "2026-09-20")
        with pytest.raises(ValueError):
            dr.resolve_window("someday", self.TODAY)
        with pytest.raises(ValueError):
            dr.resolve_window("2026-09-20:2026-09-01")


class TestDomainRanges:
    def test_sleep_7_30_2mo(self, pid):
        rows = [_row("2026-09-20", "SleepEpisode", "s1", "2026-09-20T23:00:00+00:00")]
        for preset in ("last_7_days", "last_30_days", "last_2_months"):
            start, end = dr.resolve_window(preset, date(2026, 9, 20))
            drv = _FakeDriver(rows)
            out = dr.query_day_range(drv, pid, start, end, kinds=["SleepEpisode"])
            assert drv.seen_params["kinds"] == ["SleepEpisode"]
            assert out[0]["events"][0]["exact_time"] == "2026-09-20T23:00:00+00:00"

    def test_activity_weekly_monthly(self, pid):
        rows = [_row("2026-09-15", "ActivityEvent", "a1", "2026-09-15T08:00:00+00:00")]
        drv = _FakeDriver(rows)
        out = dr.query_day_range(drv, pid, "2026-09-14", "2026-09-20", kinds=["ActivityEvent"])
        assert dr.group_records(out, "week")[0]["period"] == "2026-W38"
        assert dr.group_records(out, "month")[0]["period"] == "2026-09"

    def test_food_daily_monthly(self, pid):
        rows = [_row("2026-09-20", "FoodScan", "f1", "2026-09-20T12:35:00+00:00"),
                _row("2026-09-20", "NutritionIntake", "n1", "2026-09-20T12:30:00+00:00")]
        drv = _FakeDriver(rows)
        out = dr.query_day_range(drv, pid, "2026-09-20", "2026-09-20",
                                 kinds=["FoodScan", "NutritionIntake"])
        assert {e["kind"] for e in out[0]["events"]} == {"FoodScan", "NutritionIntake"}

    def test_ppg_window_preserves_exact_time(self, pid):
        rows = [_row("2026-09-20", "PPGMeasurement", "p1", "2026-09-20T07:30:00+00:00")]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-08-22", "2026-09-20",
                                 kinds=["PPGMeasurement"])
        assert out[0]["events"][0]["exact_time"] == "2026-09-20T07:30:00+00:00"

    def test_medication_taken_only(self, pid):
        rows = [_row("2026-09-20", "MedicationTakenEvent", "m1", "2026-09-20T09:00:00+00:00")]
        drv = _FakeDriver(rows)
        out = dr.query_day_range(drv, pid, "2026-08-01", "2026-09-20",
                                 kinds=["MedicationTakenEvent"])
        assert drv.seen_params["kinds"] == ["MedicationTakenEvent"]
        assert out[0]["events"][0]["kind"] == "MedicationTakenEvent"
        # MedicationRequest/Medication (order ontology) are a different
        # question and must not leak into taken-history queries.
        assert "MedicationRequest" not in drv.seen_params["kinds"]


class TestDailyAndCrossDomain:
    def test_single_day_all_domains(self, pid):
        rows = [_row("2026-09-20", k, f"e{i}", f"2026-09-20T0{i}:00:00+00:00")
                for i, k in enumerate(["SleepEpisode", "ActivityEvent", "FoodScan",
                                       "NutritionIntake", "PPGMeasurement",
                                       "MedicationTakenEvent", "TimelineEvent", "Visit"])]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-09-20", "2026-09-20")
        assert len(out) == 1 and len(out[0]["events"]) == 8

    def test_cross_domain_range(self, pid):
        rows = [_row("2026-09-19", "SleepEpisode", "s", "2026-09-19T23:00:00+00:00"),
                _row("2026-09-20", "PPGMeasurement", "p", "2026-09-20T07:30:00+00:00")]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-08-22", "2026-09-20",
                                 kinds=["SleepEpisode", "PPGMeasurement"])
        assert [g["day"] for g in out] == ["2026-09-19", "2026-09-20"]

    def test_no_manufactured_records(self, pid):
        out = dr.query_day_range(_FakeDriver([]), pid, "2026-09-20", "2026-09-20")
        assert out == []


class TestGrouping:
    def test_daily_identity(self):
        groups = [{"day": "2026-09-20", "events": [{"kind": "SleepEpisode"}]}]
        assert dr.group_records(groups, "day") == groups

    def test_weekly_iso(self):
        groups = [{"day": "2026-09-14", "events": []}, {"day": "2026-09-20", "events": []}]
        weeks = dr.group_records(groups, "week")
        assert [w["period"] for w in weeks] == ["2026-W38"]
        assert len(weeks[0]["days"]) == 2

    def test_monthly(self):
        groups = [{"day": "2026-08-22", "events": []}, {"day": "2026-09-20", "events": []}]
        months = dr.group_records(groups, "month")
        assert [m["period"] for m in months] == ["2026-08", "2026-09"]

    def test_bad_granularity(self):
        with pytest.raises(ValueError):
            dr.group_records([], "fortnight")


class TestBoundaries:
    def test_inclusive_passthrough_no_off_by_one(self, pid):
        drv = _FakeDriver([])
        dr.query_day_range(drv, pid, "2026-09-14", "2026-09-20")
        assert drv.seen_params["start_date"] == "2026-09-14"
        assert drv.seen_params["end_date"] == "2026-09-20"

    def test_outside_range_never_added(self, pid):
        # The service forwards the window verbatim; Cypher day-granular
        # inclusion does the rest (contract §boundary rule).
        drv = _FakeDriver([_row("2026-09-20", "SleepEpisode", "s", None)])
        out = dr.query_day_range(drv, pid, "2026-09-20", "2026-09-20")
        assert [g["day"] for g in out] == ["2026-09-20"]

    def test_empty_range(self, pid):
        assert dr.query_day_range(_FakeDriver([]), pid, "2026-01-01", "2026-01-31") == []

    def test_midnight_events(self, pid):
        rows = [_row("2026-09-20", "SleepEpisode", "s", "2026-09-20T00:00:00+00:00")]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-09-20", "2026-09-20")
        assert out[0]["events"][0]["exact_time"] == "2026-09-20T00:00:00+00:00"


class TestDuplicates:
    def test_exact_dupes_collapse(self, pid):
        dup = _row("2026-09-20", "SleepEpisode", "s1", "2026-09-20T23:00:00+00:00")
        out = dr.query_day_range(_FakeDriver([dup, dict(dup)]), pid, "2026-09-20", "2026-09-20")
        assert len(out[0]["events"]) == 1

    def test_same_event_two_days_kept(self, pid):
        # A moved-then-replayed event is (day, event) distinct per day;
        # collapsing must never merge across days.
        rows = [_row("2026-09-19", "SleepEpisode", "s1", None),
                _row("2026-09-20", "SleepEpisode", "s1", None)]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-09-19", "2026-09-20")
        assert len(out) == 2


class TestIsolation:
    def test_patient_binding_in_params(self, pid):
        drv = _FakeDriver([])
        dr.query_day_range(drv, pid, "2026-09-19", "2026-09-20")
        assert drv.seen_params["patient_id"] == str(pid)

    def test_template_is_patient_anchored(self):
        assert tpl.check_cypher_safety(tpl.CYPHER_DAY_RANGE) == []
        assert "(p:Patient {id: $patient_id})" in tpl.CYPHER_DAY_RANGE


class TestTerminalEnforcement:
    def test_medication_is_terminal(self):
        assert "Medication" in tpl.TERMINAL_LABELS
        assert "AnatomicalStructure" in tpl.TERMINAL_LABELS
        assert "Concept" in tpl.TERMINAL_LABELS

    def test_bridge_pattern_flagged(self):
        bridge = (
            "MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_TAKEN]->(e)"
            "-[:TAKEN_FROM]->(m:Medication)-[:TAKEN_FROM]->(e2) RETURN e2"
        )
        violations = tpl.check_cypher_safety(bridge)
        assert any("terminal label Medication" in v for v in violations)

    def test_no_registered_template_leaves_terminal(self):
        for tid, tm in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(tm.cypher) == [], tid


class TestCompatibility:
    def test_kinds_optional_preserves_p9_signature(self, pid):
        drv = _FakeDriver([_row("2026-09-20", "SleepEpisode", "s", None)])
        out = dr.query_day_range(drv, pid, "2026-09-20", "2026-09-20")
        assert drv.seen_params["kinds"] is None
        assert out[0]["events"][0]["kind"] == "SleepEpisode"

    def test_determinism(self, pid):
        rows = [_row("2026-09-20", "SleepEpisode", "s2", "2026-09-20T23:00:00+00:00"),
                _row("2026-09-19", "SleepEpisode", "s1", "2026-09-19T23:00:00+00:00")]
        out = dr.query_day_range(_FakeDriver(rows), pid, "2026-09-19", "2026-09-20")
        assert [g["day"] for g in out] == ["2026-09-19", "2026-09-20"]
