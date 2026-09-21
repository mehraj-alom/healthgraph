"""P14 answer-contract tests (DB-less except P14_LIVE-gated fixture pins).

Covers: Rule-6 paraphrase contract (prompt + checks), period
classification, period metadata envelopes (day + lifestyle),
calendar-label grounding check, period-metadata check, eval-set
invariance (exact same 17 questions), and diversified sleep-fixture
truth (live-gated).
"""
import json
import os
import uuid

import pytest

LIVE = os.getenv("P14_LIVE") == "1"
needs_live = pytest.mark.skipif(not LIVE, reason="live PG/graph (P14_LIVE=1)")

EVAL_PATH = os.path.join(os.path.dirname(__file__), "..", "evals",
                         "p13_answer_eval.json")


class TestRule6Contract:
    def test_prompt_prefers_canonical_allows_safe_paraphrase(self):
        import inspect

        import agents.orchestrator as orch

        src = inspect.getsource(orch.synthesize)
        assert 'prefer the exact sentence: "I don\'t have recorded data for that."' in src
        assert "paraphrase is contract-compliant ONLY" in src
        assert "zero citations" in src

    def test_tool_constant_still_canonical(self):
        from models.clinical_assertion import NO_DATA_RECORDED

        assert NO_DATA_RECORDED == "I don't have recorded data for that."


class TestClassifyWindow:
    def test_calendar_month(self):
        from services.retrieval.day_range import classify_window

        assert classify_window("2026-08-01", "2026-08-31") == {
            "retrieval_type": "calendar_month", "label": "August 2026"}
        assert classify_window("2026-02-01", "2026-02-28")[
            "retrieval_type"] == "calendar_month"

    def test_single_day(self):
        from services.retrieval.day_range import classify_window

        assert classify_window("2026-09-20", "2026-09-20") == {
            "retrieval_type": "single_day", "label": "2026-09-20"}

    def test_lookback_spans_are_not_months(self):
        from services.retrieval.day_range import classify_window

        # The P13 failure shape: days-style spans must never classify
        # as a calendar month, even when month-adjacent.
        assert classify_window("2026-08-22", "2026-09-20") == {
            "retrieval_type": "explicit_range",
            "label": "2026-08-22 to 2026-09-20"}
        assert classify_window("2026-09-01", "2026-09-20")[
            "retrieval_type"] == "explicit_range"
        assert classify_window("2026-08-01", "2026-08-15")[
            "retrieval_type"] == "explicit_range"

    def test_invalid_range(self):
        from services.retrieval.day_range import classify_window

        with pytest.raises(ValueError):
            classify_window("2026-09-20", "2026-08-01")


class TestPeriodMetadata:
    def test_lifestyle_carries_lookback_period(self, monkeypatch):
        from agents.tools import lifestyle as ls

        monkeypatch.setattr(
            ls, "_series_sleep",
            lambda db, pid, start, end, limit: {
                "domain": "sleep", "reading_count": 1, "series": [],
                "citations": []},
        )
        out = ls._get_lifestyle_series(uuid.uuid4(), "sleep", 30, object())
        period = out[0]["period"]
        assert period["retrieval_type"] == "lookback"
        assert period["label"] == "last 30 days"
        assert period["start_date"] < period["end_date"]

    def test_day_preset_is_lookback(self, monkeypatch):
        from agents.tools import day_timeline as dt

        monkeypatch.setattr(dt, "query_day_range", lambda *a, **k: [])
        out = dt._get_day_timeline(
            uuid.uuid4(), "2026-09-14", "2026-09-20", None, 100,
            object(), object(), "last_7_days")
        # No-data envelopes carry the queried period (P14).
        assert out[0]["period"] == {
            "label": "last_7_days", "start_date": "2026-09-14",
            "end_date": "2026-09-20", "retrieval_type": "lookback"}

    def test_lifestyle_no_data_carries_period(self, monkeypatch):
        from agents.tools import lifestyle as ls

        monkeypatch.setattr(
            ls, "_series_sleep",
            lambda db, pid, start, end, limit: {
                "domain": "sleep", "reading_count": 0, "series": [],
                "citations": []},
        )
        out = ls._get_lifestyle_series(uuid.uuid4(), "sleep", 30, object())
        assert out[0]["period"]["retrieval_type"] == "lookback"
        assert out[0]["period"]["label"] == "last 30 days"

    def test_day_explicit_range_classified(self, monkeypatch):
        from types import SimpleNamespace

        from agents.tools import day_timeline as dt

        eid = uuid.uuid4()
        groups = [{"day": "2026-08-22", "events": [
            {"kind": "SleepEpisode", "event_id": str(eid),
             "exact_time": "2026-08-22T23:00:00+00:00"}]}]
        monkeypatch.setattr(dt, "query_day_range", lambda *a, **k: groups)
        monkeypatch.setattr(
            dt._hydrate, "hydrate_events_batch",
            lambda db, pid, ids: {eid: {
                "citation": SimpleNamespace(
                    quote="Stored.", document_id=None, event_id=str(eid),
                    node_id=f"timeline_event:{eid}")}})
        out = dt._get_day_timeline(
            uuid.uuid4(), "2026-08-22", "2026-09-20", None, 100,
            object(), object())
        assert out[0]["period"] == {
            "label": "2026-08-22 to 2026-09-20",
            "start_date": "2026-08-22", "end_date": "2026-09-20",
            "retrieval_type": "explicit_range"}
        out = dt._get_day_timeline(
            uuid.uuid4(), "2026-08-01", "2026-08-31", None, 100,
            object(), object())
        assert out[0]["period"]["retrieval_type"] == "calendar_month"
        assert out[0]["period"]["label"] == "August 2026"

    def test_prompt_forbids_month_renaming(self):
        import inspect

        import agents.orchestrator as orch

        assert "never a calendar month" in inspect.getsource(orch.call_agent)
        assert "never reuse the same preset" in inspect.getsource(orch.call_agent)
        assert "never label a lookback" in inspect.getsource(orch.synthesize)


class TestCalendarLabelCheck:
    def test_dateless_month_section_fails(self):
        from services.evaluation.checks import check_calendar_labels

        bad = ("### August\n- Average Sleep Duration: 420 minutes\n"
               "- Episodes: 6")
        corpus = ['{"date": "2026-08-22", "duration_minutes": 410}']
        passed, reason = check_calendar_labels(bad, corpus)
        assert passed is False
        assert "august" in reason

    def test_grounded_month_section_passes(self):
        from services.evaluation.checks import check_calendar_labels

        good = ("### August 2026\n- August 22: Logged an activity.\n"
                "### September 2026\n- September 13: Logged sleep.")
        corpus = ['{"day": "2026-08-22"}', '{"day": "2026-09-13"}']
        assert check_calendar_labels(good, corpus)[0] is True

    def test_inline_event_dates_never_trigger(self):
        from services.evaluation.checks import check_calendar_labels

        assert check_calendar_labels(
            "On September 13 you slept. Events of September 20, 2026.", [])[0] is True
        assert check_calendar_labels("No months here.", [])[0] is True

    def test_period_metadata_check(self):
        from services.evaluation.checks import check_period_metadata

        calls = [{"name": "get_lifestyle_series",
                  "args": {"domain": "sleep", "days": 30}}]
        assert check_period_metadata(
            calls, ['{"period": {"retrieval_type": "lookback"}}'])[0] is True
        assert check_period_metadata(calls, ['{"series": []}'])[0] is False
        assert check_period_metadata(
            [{"name": "get_patient_overview", "args": {}}], [])[0] is True


class TestEvalSetInvariance:
    def test_exact_same_17_questions(self):
        questions = json.load(open(EVAL_PATH))["questions"]
        assert len(questions) == 17
        assert {q["qid"] for q in questions} == {
            "sleep-2mo", "sleep-week", "week-view", "month-compare",
            "co-occur", "ppg-activity", "meds-taken", "timeline",
            "doc-evidence", "negative", "no-data", "explicit-date",
            "ambiguous", "B-sleep", "compare-week", "compare-month",
            "compare-anchor"}


class TestDiversifiedFixture:
    @needs_live
    def test_sleep_values_vary_by_period(self):
        from dotenv import load_dotenv
        from sqlalchemy import text
        from core.db import SessionLocal

        load_dotenv("/home/opticpulse/healthgraph/.env")
        db = SessionLocal()
        try:
            rows = db.execute(
                text("select e.event_time, p.duration_minutes from payload_sleep p "
                     "join clinical_events e on e.event_id=p.event_id "
                     "where e.patient_id='e10a1111-2222-3333-4444-999999999999' "
                     "order by 1")).fetchall()
            aug = [r[1] for r in rows if r[0].month == 8]
            sep = [r[1] for r in rows if r[0].month == 9]
            assert len(aug) == 2 and round(sum(aug) / len(aug)) == 425
            assert len(sep) == 5 and round(sum(sep) / len(sep)) == 414
            assert len(set(r[1] for r in rows)) > 1
        finally:
            db.close()

    @needs_live
    def test_graph_matches_pg_values(self):
        import importlib

        from dotenv import load_dotenv

        load_dotenv("/home/opticpulse/healthgraph/.env")
        import core.neo4j_client as nc

        importlib.reload(nc)
        from sqlalchemy import text
        from core.db import SessionLocal

        db = SessionLocal()
        try:
            with nc.neo4j_driver.session() as s:
                for eid, d in db.execute(
                        text("select p.event_id, p.duration_minutes from payload_sleep p "
                             "join clinical_events e on e.event_id=p.event_id "
                             "where e.patient_id='e10a1111-2222-3333-4444-999999999999'")).fetchall():
                    g = s.run(
                        "MATCH (x:SleepEpisode {id:$e}) RETURN x.duration_minutes AS d",
                        e=str(eid)).data()
                    assert g and g[0]["d"] == d, eid
        finally:
            db.close()
