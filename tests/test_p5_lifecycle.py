"""P5 data integrity, lifecycle & graph operations tests (no DB/Neo4j/network).

Covers:
- retirement outbox type + label allow-list (shared labels excluded)
- retirement worker handler (scoped delete, replay-safe, patient-bound)
- recency guards (stale replays cannot regress newer state)
- ACTIVE edge lifecycle (terminal statuses detach, history via request)
- PUT retirement enqueue + review re-enqueue + cascade coverage (static)
- retrieval lifecycle (DELETED doc gate, discontinued-via-request)
- deterministic router unit tests
- wellbeing selector (note-shadowing regression)
- integrity diff unit tests
- legacy compatibility + migration chain integrity
"""
import re
import uuid
from datetime import date, datetime, timezone

from services.retrieval import templates as tpl


class _FakeResult:
    def consume(self):
        return None


class _FakeTx:
    def __init__(self):
        self.cypher = ""
        self.kwargs: dict = {}

    def run(self, cypher, **kwargs):
        self.cypher = cypher
        self.kwargs = kwargs
        return _FakeResult()


class TestRetirementOutbox:
    def test_event_type_and_allow_list(self):
        from models.outbox import OutboxEventType, RETIREABLE_NODE_LABELS

        assert OutboxEventType.GRAPH_NODE_RETIRED.value == "graph_node_retired"
        for label in ("TimelineEvent", "SleepEpisode", "ActivityEvent", "NutritionIntake",
                      "MedicationTakenEvent", "Measurement", "PatientStatement"):
            assert label in RETIREABLE_NODE_LABELS, label
        # Shared, grouping, and deduped rows can NEVER retire this way.
        for label in ("Concept", "AnatomicalStructure", "Medication", "MedicationRequest",
                      "Visit", "ConditionOccurrence", "MedicationVersion",
                      "SleepEpisodeX", "TimelineEvent; MATCH"):
            assert label not in RETIREABLE_NODE_LABELS, label

    def test_enqueue_retirement_payload(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_graph_node_retired, OutboxEventType

        enqueue_graph_node_retired(FakeDB(), uuid.uuid4(), "SleepEpisode", uuid.uuid4())
        assert calls[0].event_type == OutboxEventType.GRAPH_NODE_RETIRED
        assert calls[0].payload["node_label"] == "SleepEpisode"
        assert calls[0].payload["reason"] == "correction"

    def test_recency_kwargs_optional(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_clinical_event, enqueue_medication
        from datetime import datetime, timezone

        enqueue_clinical_event(
            FakeDB(), event_id=uuid.uuid4(), patient_id=uuid.uuid4(),
            event_type="LAB_RESULT", source_type="LAB_REPORT",
            verification_status="EXTRACTED", event_time=datetime.now(timezone.utc),
        )
        assert "pg_updated_at" not in calls[0].payload
        enqueue_medication(FakeDB(), medication_id=uuid.uuid4(), patient_id=uuid.uuid4(), name="X",
                           pg_updated_at="2026-01-02T00:00:00+00:00")
        assert calls[1].payload["pg_updated_at"] == "2026-01-02T00:00:00+00:00"


class TestRetirementWorker:
    def test_retire_scoped_detach(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_node_retired_tx(tx, {
            "patient_id": "p1", "node_label": "SleepEpisode", "node_id": "e1"})
        assert "DETACH DELETE n" in tx.cypher
        assert "$patient_id" in tx.cypher
        assert "(p)-->(n)" in tx.cypher  # direct patient edge required
        assert tx.kwargs["node_id"] == "e1"

    def test_retire_rejects_shared_labels(self):
        from workers import graph_sync
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        for label in ("Concept", "AnatomicalStructure", "Medication", "Visit",
                      "ConditionOccurrence", "Patient", "SleepEpisode) DETACH DELETE (p"):
            with _pytest.raises(PermanentProjectionError):
                graph_sync._project_node_retired_tx(
                    _FakeTx(), {"patient_id": "p1", "node_label": label, "node_id": "x"})

    def test_retire_requires_keys(self):
        from workers import graph_sync
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_node_retired_tx(_FakeTx(), {"patient_id": "p1"})

    def test_retire_label_interpolated_only_after_gate(self):
        with open("workers/graph_sync.py") as f:
            src = f.read()
        handler = src[src.index("def _project_node_retired_tx"):]
        gate_pos = handler.index("RETIREABLE_NODE_LABELS")
        interp_pos = handler.index("MATCH (p:Patient")
        assert gate_pos < interp_pos  # gate precedes interpolation


class TestRecencyGuards:
    def _clinical_payload(self, **over):
        base = {
            "patient_id": "p1", "event_id": "e1", "event_type": "LAB_RESULT",
            "source_type": "LAB_REPORT", "verification_status": "EXTRACTED",
            "event_time": "2026-01-01", "level_number": 20260101,
        }
        base.update(over)
        return base

    def _med_payload(self, **over):
        base = {
            "patient_id": "p1", "medication_id": "m1", "name": "Lisinopril",
            "status": "ACTIVE",
        }
        base.update(over)
        return base

    def test_clinical_has_recency_guard(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_clinical_event_tx(tx, self._clinical_payload())
        assert "t.pg_updated_at IS NULL OR $pg_updated_at IS NULL" in tx.cypher
        assert "t.pg_updated_at <= $pg_updated_at" in tx.cypher

    def test_medication_has_recency_guard_and_active_lifecycle(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_tx(tx, self._med_payload())
        assert "m.pg_updated_at IS NULL OR $pg_updated_at IS NULL" in tx.cypher
        # ACTIVE edge maintained conditionally; request edge unconditional.
        assert "ACTIVE_MEDICATION" in tx.cypher
        assert "HAS_MEDICATION_REQUEST" in tx.cypher
        assert "DISCONTINUED" in tx.cypher and "COMPLETED" in tx.cypher
        assert "DELETE _" in tx.cypher  # terminal statuses detach

    def test_old_rows_without_stamp_still_project(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_tx(tx, self._med_payload())
        assert tx.kwargs["pg_updated_at"] is None  # guard passes via IS NULL
        tx2 = _FakeTx()
        graph_sync._project_clinical_event_tx(tx2, self._clinical_payload())
        assert tx2.kwargs["pg_updated_at"] is None


class TestLifecycleWiring:
    def test_put_enqueues_retirements(self):
        with open("app/api/v1/daily_logs.py") as f:
            src = f.read()
        assert "enqueue_graph_node_retired" in src
        assert '"MedicationTakenEvent", e.event_id' in src or "MedicationTakenEvent" in src
        # Domain label map mirrors the projections.
        for label in ("SleepEpisode", "ActivityEvent", "NutritionIntake",
                      "MedicationTakenEvent", "TimelineEvent"):
            assert label in src

    def test_review_reenqueues_same_id(self):
        with open("app/api/v1/review.py") as f:
            src = f.read()
        assert "enqueue_clinical_event" in src
        assert "pg_updated_at" in src
        # Same event id → MERGE update, not a duplicate node.
        assert "event_id=event.event_id" in src

    def test_document_cascade_covers_all_doc_paths(self):
        with open("app/api/v1/documents.py") as f:
            src = f.read()
        for path in ("HAS_OBSERVATION", "HAS_TIMELINE_EVENT", "HAS_CONDITION",
                     "HAS_MEDICATION_REQUEST", "HAS_MEASUREMENT"):
            assert path in src, path

    def test_medication_detail_reachable_via_request_edge(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert "HAS_MEDICATION_REQUEST]->(req:MedicationRequest {id: $raw_id})" in src

    def test_deleted_document_returns_not_found(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert '_doc_status == "DELETED"' in src


class TestRouter:
    def test_medication_routing(self):
        from services.retrieval.router import route_question

        assert "get_medication_context" in route_question("Why am I taking this medicine?")
        assert "get_medication_context" in route_question("What dose am I on?")

    def test_window_routing(self):
        from services.retrieval.router import route_question

        assert "get_context_around" in route_question("What changed around the time I started lisinopril?")
        assert "get_context_around" in route_question("What did I log the same day?")

    def test_domain_routing(self):
        from services.retrieval.router import route_question

        assert "get_lifestyle_series" in route_question("Show my sleep over the last 30 days")
        assert "get_measurement_trend" in route_question("Show my blood pressure trend")
        assert "get_condition_evidence" in route_question("What evidence supports this condition?")
        assert "get_daily_log" in route_question("What did I log on March 1?")

    def test_empty_and_multi(self):
        from services.retrieval.router import route_question

        assert route_question("") == []
        assert route_question(None) == []
        routed = route_question("Why am I taking this and what changed around the start?")
        assert "get_context_around" in routed and "get_medication_context" in routed
        assert len(routed) == len(set(routed))  # de-duplicated

    def test_suggested_tools_exist(self):
        from services.retrieval.router import route_question
        import agents.orchestrator as orch

        tool_names = {t.name for t in orch.tools}
        for q in ("Why am I taking this?", "Show my sleep and heart rate around March 1",
                  "What evidence supports hypertension?", "bp trend last month"):
            for suggested in route_question(q):
                assert suggested in tool_names, suggested


class TestWellbeingSelector:
    def test_first_scored_hit_wins(self):
        from app.api.v1.daily_metrics import select_wellbeing_hit

        hits = [("note-id", "t0"), ("score-id", "t1")]
        assert select_wellbeing_hit(hits, {"score-id": object()}) == ("score-id", "t1")

    def test_all_notes_returns_none(self):
        from app.api.v1.daily_metrics import select_wellbeing_hit

        assert select_wellbeing_hit([("n1", "t0")], {}) is None
        assert select_wellbeing_hit([], {}) is None

    def test_scan_order_preserved(self):
        from app.api.v1.daily_metrics import select_wellbeing_hit

        hits = [("a", "t0"), ("b", "t1")]
        assert select_wellbeing_hit(hits, {"a": object(), "b": object()}) == ("a", "t0")


class TestIntegrityDiff:
    def test_missing_and_orphaned(self):
        import sys
        sys.path.insert(0, "scripts")
        from check_projection_integrity import diff_projection

        d = diff_projection({"a", "b", "c"}, {"b", "c", "d"})
        assert d["missing_in_graph"] == ["a"]
        assert d["orphaned_in_graph"] == ["d"]
        assert d["pg_count"] == 3 and d["graph_count"] == 3

    def test_clean_diff(self):
        import sys
        sys.path.insert(0, "scripts")
        from check_projection_integrity import diff_projection

        d = diff_projection({"a"}, {"a"})
        assert d["missing_in_graph"] == [] and d["orphaned_in_graph"] == []


class TestLegacyAndChainP5:
    def test_nothing_retired_in_p5(self):
        with open("app/api/v1/health_graph.py") as f:
            hg = f.read()
        with open("workers/graph_sync.py") as f:
            gs = f.read()
        assert "SOURCE_DOCUMENT" in gs and "DOCUMENTED_IN" in gs
        assert "LOGGED_ON" in gs and "OCCURRED_DURING" in gs
        assert "DERIVED_SAME_DAY" in hg

    def test_allow_list_unchanged_no_causal(self):
        assert "GRAPH_NODE_RETIRED" not in tpl.ALLOWED_TRAVERSAL_RELS  # outbox-only, not a rel
        with open("workers/graph_sync.py") as f:
            src = f.read()
        for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
            for name in group.split("|"):
                name = name.strip().rstrip("*0123456789. ")
                if not name:
                    continue
                assert name not in ("CAUSES", "TREATS", "NEXT"), name

    def test_migration_chain_single_head(self):
        import glob

        revs = {}
        downs = set()
        for path in glob.glob("alembic/versions/*.py"):
            with open(path) as f:
                src = f.read()
            m = re.search(r"^revision[^=]*=\s*['\"]([^'\"]+)", src, re.M)
            d = re.search(r"^down_revision[^=]*=\s*['\"]([^'\"]+)", src, re.M)
            if m:
                revs[m.group(1)] = path
            if d:
                downs.add(d.group(1))
        heads = [r for r in revs if r not in downs]
        assert len(heads) == 1, heads
        for d in downs:
            assert d in revs, f"dangling down_revision {d}"

    def test_versions_excluded_from_regimen(self):
        with open("agents/tools/medication_context.py") as f:
            src = f.read()
        assert "snapshot" not in src  # versions live in detail dose_history only
