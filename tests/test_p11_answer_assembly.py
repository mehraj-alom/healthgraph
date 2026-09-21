"""P11 answer-assembly tests (no DB / Neo4j / network / LLM).

Covers the 20 P11 categories against the Day-backed tool core
(_get_day_timeline), the router temporal hint, and the grounding
rules (hydration, citations, lifecycle omission, assertion
preservation, no-causation note, taken-vs-order). Live E2E evidence
is recorded in the P11 validation report, not here.
"""
import uuid

import pytest

from agents.tools import day_timeline as dt
from services.retrieval.router import route_question


def _ev(kind, eid, exact):
    return {"kind": kind, "event_id": eid, "exact_time": exact}


class _FakeDetail:
    def __init__(self, **attrs):
        self._attrs = attrs

    def get(self, key, default=None):
        return self._attrs.get(key, default)


def _fake_qdr(monkeypatch, groups):
    import services.retrieval.day_range as dr

    def _fake(driver, pid, start, end, limit=500, kinds=None):
        assert str(pid) == str(_PID)
        rows = [e for g in groups for e in g["events"]
                if kinds is None or e["kind"] in kinds]
        by_day: dict = {}
        for g in groups:
            kept = [e for e in g["events"] if kinds is None or e["kind"] in kinds]
            if kept:
                by_day[g["day"]] = kept
        return [{"day": d, "events": by_day[d]} for d in sorted(by_day)]

    monkeypatch.setattr(dt, "query_day_range", _fake)
    return dr


_PID = uuid.uuid4()


def _run(monkeypatch, groups, hydrates, **kwargs):
    """Drive the tool core with stubbed graph + hydration layers."""
    import services.retrieval.day_range as dr

    monkeypatch.setattr(dt, "query_day_range",
                        lambda *a, **k: groups)

    def _batch(single_name):
        single = hydrates.get(single_name)

        def _go(db, pid, ids):
            out = {}
            for eid in ids:
                try:
                    detail = single(None, None, eid) if single else None
                except Exception:
                    detail = None
                if detail is not None:
                    out[eid] = detail
            return out

        return _go

    stubs = dict(hydrates)
    stubs["hydrate_events_batch"] = staticmethod(_batch("hydrate_event_detail"))
    stubs["hydrate_observations_batch"] = staticmethod(_batch("hydrate_observation_detail"))
    stubs["hydrate_visits_batch"] = staticmethod(_batch("hydrate_visit_detail"))
    monkeypatch.setattr(dt, "_hydrate", type("H", (), stubs)())
    return dt._get_day_timeline(_PID, "2026-08-01", "2026-09-20",
                                kwargs.get("kinds"), 100, object(), object())


def _sleep_detail(eid):
    event = type("E", (), {"event_type": type("T", (), {"value": "SYMPTOM"})(),
                           "polarity": "positive",
                           "event_time": "2026-09-20T10:00:00+00:00",
                           "verification_status": type("V", (), {"value": "UNVERIFIED"})()})()
    return {"event": event, "badge": "UNVERIFIED",
            "citation": {"node_id": f"timeline_event:{eid}", "quote": "Headache."}}


class TestAnswers:
    def test_sleep_longitudinal_answer(self, monkeypatch):
        groups = [{"day": "2026-09-19", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-616358830111", "2026-09-19T23:00:00+00:00")]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: _sleep_detail("e0000000-0000-4000-8000-616358830111")})
        assert out[0]["days"][0]["records"][0]["detail"]["event_time"] == "2026-09-20T10:00:00+00:00"
        assert out[0]["citations"] == [{
            "node_id": "timeline_event:e0000000-0000-4000-8000-616358830111",
            "quote": "Headache."}]

    def test_all_domain_weekly_answer(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [
            _ev("SleepEpisode", "e0000000-0000-4000-8000-017958618597", None), _ev("ActivityEvent", "e0000000-0000-4000-8000-782248135936", None),
            _ev("Visit", "e0000000-0000-4000-8000-350780523314", None)]}]
        hydrates = {
            "hydrate_event_detail": lambda *a: {"event": None, "badge": "b", "citation": {"node_id": "e"}},
            "hydrate_visit_detail": lambda *a: {"visit": type("V", (), {"visit_type": "daily-checkin", "visit_date": "2026-09-20"})(),
                                                "badge": None, "citation": None},
        }
        out = _run(monkeypatch, groups, hydrates)
        kinds = {r["kind"] for r in out[0]["days"][0]["records"]}
        assert kinds == {"SleepEpisode", "ActivityEvent", "Visit"}

    def test_month_comparison_shape(self, monkeypatch):
        # Two months present as data; hydrate-None drops records per
        # lifecycle omission (covered); here hydration succeeds so both
        # months survive for comparison.
        groups = [{"day": "2026-08-22", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-616358830111", None)]},
                  {"day": "2026-09-20", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-419468414749", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        assert [g["day"] for g in out[0]["days"]] == ["2026-08-22", "2026-09-20"]
        assert "manufactur" not in str(out).lower()

    def test_sleep_same_day_context(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [
            _ev("SleepEpisode", "e0000000-0000-4000-8000-017958618597", None), _ev("PPGMeasurement", "e0000000-0000-4000-8000-490496797177", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        rec = out[0]["days"][0]["records"]
        assert {r["kind"] for r in rec} == {"SleepEpisode", "PPGMeasurement"}
        assert "not causation" in out[0]["note"]

    def test_ppg_activity_same_period(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [
            _ev("PPGMeasurement", "e0000000-0000-4000-8000-490496797177", "2026-09-20T07:30:00+00:00"),
            _ev("ActivityEvent", "e0000000-0000-4000-8000-782248135936", "2026-09-20T08:00:00+00:00")]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        times = [r["exact_time"] for r in out[0]["days"][0]["records"]]
        assert times == ["2026-09-20T07:30:00+00:00", "2026-09-20T08:00:00+00:00"]

    def test_medication_taken_history(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("MedicationTakenEvent", "e0000000-0000-4000-8000-065079445228", "2026-09-20T09:00:00+00:00")]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": {"node_id": "x"}}})
        assert out[0]["days"][0]["records"][0]["kind"] == "MedicationTakenEvent"

    def test_timeline_query(self, monkeypatch):
        groups = [{"day": "2026-09-19", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-000000000019", None)]},
                  {"day": "2026-09-20", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-000000000020", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        assert [g["day"] for g in out[0]["days"]] == ["2026-09-19", "2026-09-20"]

    def test_temporal_boundaries_passthrough(self, monkeypatch):
        import services.retrieval.day_range as dr

        seen = {}

        def _fake(driver, pid, start, end, limit=500, kinds=None):
            seen.update(start=start, end=end)
            return []

        monkeypatch.setattr(dt, "query_day_range", _fake)
        out = dt._get_day_timeline(_PID, "2026-09-14", "2026-09-20", None, 100, object(), object())
        assert (seen["start"], seen["end"]) == ("2026-09-14", "2026-09-20")
        assert out[0].get("message")


class TestGrounding:
    def test_hydration_none_means_deleted_skipped(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("SleepEpisode", "gone", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: None})
        assert out[0].get("message")  # no-data, never invented

    def test_graph_only_kinds_marked(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("FoodScan", "e0000000-0000-4000-8000-918818512330", None)]}]
        out = _run(monkeypatch, groups, {})
        rec = out[0]["days"][0]["records"][0]
        assert rec["detail"] is None and "no PG hydrator" in rec["detail_note"]

    def test_citation_filtering_invalid_dropped(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-017958618597", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        assert out[0]["citations"] == []

    def test_retired_document_exclusion_by_omission(self, monkeypatch):
        # Hydrate returning None (deleted doc/event) removes the record;
        # assembly never backfills from graph text.
        groups = [{"day": "2026-09-20", "events": [_ev("TimelineEvent", "e0000000-0000-4000-8000-878528612668", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: None})
        assert out[0].get("message")

    def test_assertion_preserved(self, monkeypatch):
        event = type("E", (), {"event_type": type("T", (), {"value": "DIAGNOSIS"})(),
                               "polarity": "negative",
                               "event_time": "2026-08-03T00:00:00+00:00",
                               "verification_status": type("V", (), {"value": "UNVERIFIED"})()})()
        groups = [{"day": "2026-08-03", "events": [_ev("TimelineEvent", "e0000000-0000-4000-8000-878528612668", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": event, "badge": "b", "citation": None}})
        assert out[0]["days"][0]["records"][0]["detail"]["polarity"] == "negative"

    def test_missing_data_no_guess(self, monkeypatch):
        out = _run(monkeypatch, [], {"hydrate_event_detail": lambda *a: None})
        assert out[0].get("message") and out[0]["citations"] == []

    def test_no_causation_note(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("SleepEpisode", "e0000000-0000-4000-8000-017958618597", None)]}]
        out = _run(monkeypatch, groups, {"hydrate_event_detail": lambda *a: {"event": None, "badge": None, "citation": None}})
        assert "not causation" in out[0]["note"]

    def test_duplicate_prevention_single_path(self, monkeypatch):
        # Same (day,event) twice collapses (P10 grouping contract);
        # assembly therefore cannot duplicate from multi-path rows.
        import services.retrieval.day_range as dr

        class _Rows:
            def data(self):
                r = {"day": "2026-09-20", "kind": "SleepEpisode",
                     "event_id": "e0000000-0000-4000-8000-616358830111", "exact_time": None}
                return [dict(r), dict(r)]

        class _Session:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cypher, **params):
                return _Rows()

        class _Driver:
            def session(self):
                return _Session()

        out = dr.query_day_range(_Driver(), uuid.uuid4(), "2026-09-20", "2026-09-20")
        assert len(out[0]["events"]) == 1

    def test_unknown_kind_skipped_not_invented(self, monkeypatch):
        groups = [{"day": "2026-09-20", "events": [_ev("MysteryNode", "e0000000-0000-4000-8000-065079445228", None)]}]
        out = _run(monkeypatch, groups, {})
        assert out[0].get("message")


class TestIsolation:
    def test_session_required(self):
        import asyncio

        with pytest.raises(ValueError, match="session_patient_id"):
            asyncio.run(dt.get_day_timeline.ainvoke(
                {"start_date": "2026-09-20", "end_date": "2026-09-20"}, config={}))

    def test_router_temporal_hint(self):
        assert "get_day_timeline" in __import__(
            "services.retrieval.router", fromlist=["route_question"]).route_question(
            "How has my sleep been over the last 2 months?")
        assert "get_day_timeline" in __import__(
            "services.retrieval.router", fromlist=["route_question"]).route_question(
            "Give me a timeline of my recent health events.")
        assert __import__(
            "services.retrieval.router", fromlist=["route_question"]).route_question(
            "What is diabetes?") == []

    def test_tool_registered(self):
        import agents.orchestrator as orch

        names = [t.name for t in orch.tools]
        assert "get_day_timeline" in names

    def test_cross_domain_isolation_by_patient_binding(self, monkeypatch):
        import services.retrieval.day_range as dr

        seen = {}

        def _fake(driver, pid, start, end, limit=500, kinds=None):
            seen["pid"] = str(pid)
            return []

        monkeypatch.setattr(dt, "query_day_range", _fake)
        dt._get_day_timeline(_PID, "2026-09-19", "2026-09-20", None, 100, object(), object())
        assert seen["pid"] == str(_PID)
