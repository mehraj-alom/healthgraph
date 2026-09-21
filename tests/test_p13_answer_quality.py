"""P13 answer-quality tests (DB-less except P13_LIVE-gated PG checks).

Covers the 15 Phase-11 categories: timeline quote propagation (1),
quote-less behavior (2), invalid/retired/wrong-patient citation
filtering (3-5), comparative intent + two-period resolution + Day
routing (6-8), comparison context structure + missing periods (9-10),
eval schema + runner checks (11-12), isolation (13), no-causation
(14), no-data (15).
"""
import json
import os
import uuid
from types import SimpleNamespace

import pytest

LIVE = os.getenv("P13_LIVE") == "1"
needs_live = pytest.mark.skipif(not LIVE, reason="live PG (P13_LIVE=1)")

EVAL_PATH = os.path.join(os.path.dirname(__file__), "..", "evals",
                         "p13_answer_eval.json")


def _event_stub():
    return SimpleNamespace(
        event_id=uuid.uuid4(),
        verification_status=SimpleNamespace(value="HUMAN_VERIFIED"),
        source_type=SimpleNamespace(value="PATIENT_REPORTED"),
        source_snippet=None,
    )


class TestTimelineQuotePropagation:
    def test_quote_from_evidence_text(self):
        from services.retrieval import hydrate as H

        eid = uuid.uuid4()
        doc = SimpleNamespace(document_id=uuid.uuid4())
        ev = SimpleNamespace(extracted_text="Stored source sentence.", document_id=doc.document_id)
        event = SimpleNamespace(
            event_id=eid,
            verification_status=SimpleNamespace(value="HUMAN_VERIFIED"),
            source_type=SimpleNamespace(value="document"),
            source_snippet=None,
        )
        detail = H._assemble_event_detail(event, ev, doc, "Headache", None, [])
        assert detail["citation"].quote == "Stored source sentence."
        assert detail["citation"].document_id == str(doc.document_id)
        assert detail["citation"].event_id == str(eid)

    def test_snippet_fallback_no_evidence(self):
        from services.retrieval import hydrate as H

        event = _event_stub()
        event.source_snippet = "Patient-logged snippet."
        detail = H._assemble_event_detail(event, None, None, None, None, [])
        assert detail["citation"].quote == "Patient-logged snippet."
        assert detail["citation"].document_id is None

    def test_negative_finding_quote_preserved(self):
        from services.retrieval import hydrate as H

        event = _event_stub()
        ev = SimpleNamespace(
            extracted_text="No evidence of intracranial hemorrhage.",
            document_id=None,
        )
        detail = H._assemble_event_detail(event, ev, None, None, None, [])
        assert "No evidence" in detail["citation"].quote

    def test_enriched_timeline_record_unit(self, monkeypatch):
        import agents.tools.timeline as T

        eid = uuid.uuid4()
        cit = SimpleNamespace(quote="Stored sentence.",
                              document_id=str(uuid.uuid4()))
        records = [{
            "event_id": str(eid), "level_number": 1, "event_date": "2026-09-20",
            "event_type": "SYMPTOM", "source_type": "PATIENT_REPORTED",
            "verification_status": "HUMAN_VERIFIED", "polarity": "positive",
            "experiencer": "patient", "observation_ids": [],
        }]

        class FakeSession:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, *a, **k):
                class R:
                    def __getitem__(self, key):
                        return records[0][key]

                    def get(self, key, default=None):
                        return records[0].get(key, default)
                return [R()]

        class FakeDriver:
            def session(self):
                return FakeSession()

        monkeypatch.setattr(
            T._hydrate, "hydrate_events_batch",
            lambda db, pid, ids: {eid: {"citation": cit}},
        )
        out = T._get_patient_timeline(uuid.uuid4(), 10, object(), FakeDriver())
        assert out[0]["quote_available"] is True
        assert out[0]["citations"] == [cit]

    def test_quoteless_timeline_record_unit(self, monkeypatch):
        import agents.tools.timeline as T

        eid = uuid.uuid4()
        records = [{
            "event_id": str(eid), "level_number": 1, "event_date": "2026-09-20",
            "event_type": "SYMPTOM", "source_type": "PATIENT_REPORTED",
            "verification_status": "UNVERIFIED", "polarity": "positive",
            "experiencer": "patient", "observation_ids": [],
        }]

        class FakeSession:
            def session(self):
                return self

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, *a, **k):
                class R:
                    def __getitem__(self, key):
                        return records[0][key]

                    def get(self, key, default=None):
                        return records[0].get(key, default)
                return [R()]

        class FakeDriver:
            def session(self):
                return FakeSession()

        monkeypatch.setattr(
            T._hydrate, "hydrate_events_batch", lambda db, pid, ids: {})
        out = T._get_patient_timeline(uuid.uuid4(), 10, object(), FakeDriver())
        assert out[0]["quote_available"] is False
        assert out[0]["citation_note"].startswith("quote-unavailable")
        # Legacy P7 envelope preserved verbatim.
        assert out[0]["citations"] == [
            {"node_id": f"timeline_event:{eid}", "event_id": str(eid)}]


class TestCitationFiltering:
    def test_invalid_citations_dropped(self):
        from services.retrieval.evidence import filter_valid_citations

        class FakeToolMessage:  # type name must carry "tool" for the filter
            def __init__(self, content):
                self.content = content

        corpus = [FakeToolMessage("tool output with event "
                     "11111111-2222-3333-4444-555555555555")]
        bad = [{"node_id": "timeline_event:99999999-2222-3333-4444-555555555555",
                "event_id": "99999999-2222-3333-4444-555555555555"}]
        assert filter_valid_citations(bad, corpus) == []

    def test_retired_document_citation_dropped(self):
        # Retirement removes the document's ids from tool outputs; the
        # post-hoc filter then rejects any citation referencing them.
        from services.retrieval.evidence import filter_valid_citations

        class FakeToolMessage:  # type name must carry "tool" for the filter
            def __init__(self, content):
                self.content = content

        retired_doc = str(uuid.uuid4())
        corpus = [FakeToolMessage("timeline record with no document references")]
        cit = [{"node_id": f"document:{retired_doc}",
                "document_id": retired_doc, "quote": "stale quote here"}]
        assert filter_valid_citations(cit, corpus) == []

    def test_wrong_patient_citation_dropped(self):
        from services.retrieval.evidence import filter_valid_citations

        class FakeToolMessage:  # type name must carry "tool" for the filter
            def __init__(self, content):
                self.content = content

        other_doc = str(uuid.uuid4())
        corpus = [FakeToolMessage("patient A tool output, document aaaaaaaa-...")]
        cit = [{"node_id": f"document:{other_doc}", "document_id": other_doc,
                "quote": "other patient quote, long enough to test"}]
        assert filter_valid_citations(cit, corpus) == []

    def test_duplicate_evidence_ids_survive_once_each(self):
        from services.retrieval.evidence import filter_valid_citations

        class FakeToolMessage:  # type name must carry "tool" for the filter
            def __init__(self, content):
                self.content = content

        doc = "102f9659-8826-40a0-b90a-f9bbeacd1e3c"
        corpus = [FakeToolMessage(f"evidence for document {doc} page 1")]
        cits = [
            {"node_id": "timeline_event:aaaaaaaa-2222-3333-4444-555555555555",
             "event_id": "aaaaaaaa-2222-3333-4444-555555555555",
             "document_id": doc, "quote": "The sella is unremarkable."},
            {"node_id": "timeline_event:bbbbbbbb-2222-3333-4444-555555555555",
             "event_id": "bbbbbbbb-2222-3333-4444-555555555555",
             "document_id": doc, "quote": "The sella is unremarkable."},
        ]
        kept = filter_valid_citations(cits, corpus)
        # Same document, distinct events: both kept (no collapsing).
        assert len(kept) == 2


class TestComparisonRouting:
    def test_intent_detected(self):
        from services.retrieval.router import resolve_comparison_windows as r

        T = "2026-09-20"
        assert r("Compare my sleep last week versus this week", T)["periods"]
        assert r("What changed between last month and this month?", T)["periods"]
        assert r("sleep before and after 2026-08-15", T)["periods"]
        assert r("How has my sleep changed over time?", T) is not None
        assert r("How has my sleep been over the last 2 months?", T) is None
        assert r("What did my head CT report say about hemorrhage?", T) is None

    def test_between_dates_not_comparison(self):
        from services.retrieval.router import resolve_comparison_windows as r

        assert r("What happened between 2026-08-01 and 2026-08-31?",
                 "2026-09-20") is None

    def test_two_period_resolution(self):
        from services.retrieval.router import resolve_comparison_windows as r

        T = "2026-09-20"
        p = r("Compare my sleep last month versus this month.", T)["periods"]
        assert [(x["start"], x["end"]) for x in p] == [
            ("2026-08-01", "2026-08-31"), ("2026-09-01", "2026-09-20")]
        p = r("Compare my sleep last week versus this week", T)["periods"]
        assert [(x["start"], x["end"]) for x in p] == [
            ("2026-09-07", "2026-09-13"), ("2026-09-14", "2026-09-20")]
        p = r("How did my sleep change before and after August 15, 2026?",
              T)["periods"]
        assert [(x["start"], x["end"]) for x in p] == [
            ("2026-07-16", "2026-08-14"), ("2026-08-15", "2026-09-14")]

    def test_day_timeline_first_for_comparisons(self):
        from services.retrieval.router import route_question as q

        names = q("How did my sleep change between last month and this month?")
        assert names[0] == "get_day_timeline"
        names = q("Compare my sleep last week versus this week")
        assert names[0] == "get_day_timeline"

    def test_noncomparison_routing_unchanged(self):
        from services.retrieval.router import route_question as q

        assert q("What did my head CT report say about hemorrhage?") == [
            "get_condition_evidence"]
        assert q("diabetes") == []
        assert "get_day_timeline" in q(
            "How has my sleep been over the last 2 months?")


class TestComparisonContext:
    def test_agent_prompt_has_comparison_rule(self):
        import inspect

        import agents.orchestrator as orch

        src = inspect.getsource(orch.call_agent)
        assert "once per period" in src
        assert "never invent values" in src

    def test_synthesize_has_rule_7e(self):
        import inspect

        import agents.orchestrator as orch

        src = inspect.getsource(orch.synthesize)
        assert "7e. Comparisons" in src
        assert "Never imply equal coverage" in src

    def test_missing_period_no_data_envelope(self, monkeypatch):
        from agents.tools import day_timeline as dt
        from models.clinical_assertion import NO_DATA_RECORDED

        monkeypatch.setattr(dt, "query_day_range", lambda *a, **k: [])
        out = dt._get_day_timeline(
            uuid.uuid4(), "2026-08-01", "2026-08-31", None, 100,
            object(), object())
        # P14: the no-data envelope keeps the message contract and adds
        # the queried period (2026-08-01..31 is exactly a calendar month).
        assert out[0]["message"] == NO_DATA_RECORDED
        assert out[0]["citations"] == []
        assert out[0]["period"] == {
            "label": "August 2026", "start_date": "2026-08-01",
            "end_date": "2026-08-31", "retrieval_type": "calendar_month"}

    def test_day_envelope_carries_window(self, monkeypatch):
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
            uuid.uuid4(), "2026-08-01", "2026-08-31", None, 100,
            object(), object())
        assert out[0]["window"] == {"start_date": "2026-08-01",
                                    "end_date": "2026-08-31"}
        assert out[0]["days"][0]["day"] == "2026-08-22"


class TestEvalSchema:
    def test_fixed_set_shape(self):
        entries = json.load(open(EVAL_PATH))
        assert entries["version"] == 1
        questions = entries["questions"]
        assert len(questions) == 17
        required = {"qid", "question", "patient", "patient_id", "category",
                    "window_spec", "expected_tools", "required",
                    "required_any", "forbidden", "no_data_expected",
                    "citation_expectation", "safety", "isolation_probe",
                    "comparison"}
        for q in questions:
            assert required <= set(q), q.get("qid")

    def test_p12_qids_retained_verbatim(self):
        # The 13 P12 baseline questions (hard-coded: the fixed set must
        # not drift; /tmp artifacts are ephemeral and not referenced).
        p12 = {
            "sleep-2mo": "How has my sleep been over the last 2 months?",
            "week-view": "What happened to my health this week?",
            "month-compare": "What changed between last month and this month?",
            "co-occur": "On days when I slept less, what else happened?",
            "ppg-activity": "Show my PPG and activity during the same period.",
            "meds-taken": "What medications did I actually take during this period?",
            "timeline": "Give me a timeline of my recent health events.",
            "doc-evidence": "What did my head CT report say about hemorrhage?",
            "no-data": "Show my marathon training runs from last year.",
            "negative": "Was there any intracranial hemorrhage on my CT?",
            "explicit-date": "What happened on September 20?",
            "ambiguous": "Tell me about my pressure.",
            "B-sleep": "How has my sleep been over the last 2 months?",
        }
        questions = {q["qid"]: q for q in json.load(open(EVAL_PATH))["questions"]}
        for qid, text in p12.items():
            assert qid in questions, qid
            assert questions[qid]["question"] == text, qid

    def test_categories_covered(self):
        cats = {q["category"] for q in json.load(open(EVAL_PATH))["questions"]}
        for cat in ("sleep-2mo", "sleep-week", "week-view", "month-compare",
                    "co-occur", "ppg-activity", "meds-taken", "timeline",
                    "doc-evidence", "negative", "no-data", "isolation",
                    "ambiguous", "comparison-week", "comparison-month",
                    "comparison-anchor", "explicit-date"):
            assert cat in cats, cat


class TestEvalRunner:
    def test_expected_tool_check(self):
        from services.evaluation.checks import check_expected_tool

        calls = [{"name": "get_day_timeline", "args": {}}]
        assert check_expected_tool(calls, ["get_day_timeline"])[0] is True
        assert check_expected_tool(calls, ["get_lifestyle_series"])[0] is False

    def test_periods_via_days_arg(self):
        from datetime import date

        from services.evaluation.checks import check_periods_covered

        today = date(2026, 9, 20)
        calls = [{"name": "get_lifestyle_series",
                  "args": {"domain": "sleep", "days": 60}}]
        periods = [{"label": "last_2_months", "start": "2026-08-01",
                    "end": "2026-09-20"}]
        assert check_periods_covered(calls, periods, today)[0] is True
        assert check_periods_covered(
            calls, [{"label": "x", "start": "2026-01-01",
                     "end": "2026-01-31"}], today)[0] is False

    def test_quote_normalization_escaped_newlines(self):
        from services.evaluation.checks import check_quote_substance

        quote = "**Impression:** " + chr(10) + "No evidence of hemorrhage here."
        corpus = str([{"quote": quote, "page_number": 1}])
        assert "\\n" in corpus  # str() escapes the newline
        assert check_quote_substance([{"quote": quote}], [corpus])[0] is True
        assert check_quote_substance(
            [{"quote": "invented text nowhere in corpus xyzzy"}],
            [corpus])[0] is False

    def test_no_data_contract_allows_safe_paraphrase(self):
        # P14 Rule-6 decision: the canonical sentence is preferred, but a
        # safe paraphrase (plain lack statement, zero citations, no
        # patient facts) is contract-compliant.
        from services.evaluation.checks import check_no_data

        ok, _ = check_no_data(
            "I don't have recorded data for that.", [], "recorded")
        assert ok is True
        paraphrase, _ = check_no_data(
            "I don't have recorded data for your marathon runs.", [],
            "recorded")
        assert paraphrase is True
        with_citation, _ = check_no_data(
            "I don't have recorded data for that.",
            [{"node_id": "x"}], "recorded")
        assert with_citation is False
        with_fact, _ = check_no_data(
            "I don't have recorded data, but your heart rate was 66 bpm.",
            [], "recorded")
        assert with_fact is False
        vague, _ = check_no_data(
            "Let me look into that for you.", [], "recorded")
        assert vague is False

    def test_no_causation_with_disclaimer(self):
        from services.evaluation.checks import check_no_causation

        assert check_no_causation(
            "Records co-occurred in time; co-occurrence is not causation.")[0] is True
        assert check_no_causation(
            "Poor sleep caused your headaches.")[0] is False

    def test_isolation_cross(self):
        from services.evaluation.checks import check_isolation_cross

        assert check_isolation_cross(["aaa"], ["bbb"])[0] is True
        assert check_isolation_cross(["aaa"], ["aaa", "bbb"])[0] is False

    def test_forbidden_and_required(self):
        from services.evaluation.checks import check_forbidden, check_required

        assert check_forbidden("no evidence of hemorrhage",
                               ["positive for hemorrhage"])[0] is True
        assert check_forbidden("positive for hemorrhage",
                               ["positive for hemorrhage"])[0] is False
        assert check_required("value 66 bpm", ["66"], None)[0] is True
        assert check_required("no data", None, ["negat", "normal"])[0] is False


class TestIsolation:
    @needs_live
    def test_wrong_patient_hydrate_returns_none(self):
        from dotenv import load_dotenv
        from sqlalchemy import text
        from core.db import SessionLocal
        from services.retrieval import hydrate as H

        load_dotenv("/home/opticpulse/healthgraph/.env")
        pid_a = uuid.UUID("e10a1111-2222-3333-4444-999999999999")
        pid_b = uuid.UUID("e10a2222-3333-4444-5555-000000000000")
        db = SessionLocal()
        try:
            eid = db.execute(
                text("select event_id from clinical_events "
                     "where patient_id=:p limit 1"),
                {"p": str(pid_a)}).fetchone()[0]
            assert H.hydrate_event_detail(db, pid_b, eid) is None
        finally:
            db.close()

    @needs_live
    def test_enriched_timeline_carries_quote_live(self):
        import importlib

        from dotenv import load_dotenv

        load_dotenv("/home/opticpulse/healthgraph/.env")
        # core.neo4j_client reads NEO4J_* at import; pytest imports it
        # before any dotenv runs, so reload to pick up the real env
        # (test-only; production entry points load env first).
        import core.neo4j_client as nc

        importlib.reload(nc)
        from core.db import SessionLocal
        from agents.tools.timeline import _get_patient_timeline

        db = SessionLocal()
        try:
            out = _get_patient_timeline(
                uuid.UUID("c82a2222-3333-4444-5555-666666666666"),
                3, db, nc.neo4j_driver)
            assert out, "expected timeline events"
            quoted = [n for n in out if n.get("quote_available")]
            assert quoted, "document-backed events must carry quotes"
            c = quoted[0]["citations"][0]
            assert c.quote and len(c.quote.strip()) >= 20
            assert c.document_id == "102f9659-8826-40a0-b90a-f9bbeacd1e3c"
        finally:
            db.close()


class TestNoDataContract:
    def test_no_data_result_shape(self):
        from services.retrieval.evidence import no_data_result

        assert no_data_result() == {
            "message": "I don't have recorded data for that.",
            "citations": [],
        }

    def test_citation_cap(self):
        from services.evaluation.checks import check_citation_cap

        assert check_citation_cap([{}] * 10)[0] is True
        assert check_citation_cap([{}] * 11)[0] is False
