"""Graph revision-key cache tests (no DB, no Neo4j, no network).

Covers the stale-while-revalidate contract for GET /health-graph:
- bump_patient_graph_rev mints an opaque key in the caller's transaction
- read_patient_graph_rev returns the key / None on unknown
- every outbox event type routes through the bump (no silent stale cache)
- revision route is registered before /{node_id} (never parsed as a node)
- HealthGraphResponse carries the rev field
"""
import os

os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")
os.environ.setdefault("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")

from app.api.v1.health_graph import GraphRevisionResponse, HealthGraphResponse
from core.neo4j_client import bump_patient_graph_rev, read_patient_graph_rev
from models.outbox import OutboxEventType


class FakeTx:
    def __init__(self):
        self.runs = []

    def run(self, cypher, **params):
        self.runs.append((cypher, params))

        class Result:
            def consume(self):
                return None

        return Result()


class FakeSession:
    def __init__(self, record):
        self._record = record

    def run(self, cypher, **params):
        record = self._record

        class Result:
            def single(self):
                return record

        return Result()


class TestBumpHelper:
    def test_bump_sets_opaque_key_for_patient(self):
        tx = FakeTx()
        bump_patient_graph_rev(tx, "patient-123")
        assert len(tx.runs) == 1
        cypher, params = tx.runs[0]
        assert "MATCH (p:Patient" in cypher
        assert "graph_rev = randomUUID()" in cypher
        assert params == {"pid": "patient-123"}

    def test_bump_noop_on_missing_patient(self):
        for bad in (None, "", "   "):
            tx = FakeTx()
            bump_patient_graph_rev(tx, bad)
            assert tx.runs == []


class TestReadHelper:
    def test_read_returns_key(self):
        session = FakeSession({"rev": "abc-uuid"})
        assert read_patient_graph_rev(session, "patient-123") == "abc-uuid"

    def test_read_none_when_no_record(self):
        assert read_patient_graph_rev(FakeSession(None), "patient-123") is None

    def test_read_none_when_key_absent(self):
        assert read_patient_graph_rev(FakeSession({}), "patient-123") is None
        assert read_patient_graph_rev(FakeSession({"rev": None}), "patient-123") is None


class TestOutboxRouting:
    def test_every_event_type_routes_through_bump(self):
        from workers import graph_sync

        assert set(graph_sync._PROJECTORS.keys()) == set(OutboxEventType), (
            "unrouted event types would leave stale graph caches"
        )

    def test_project_and_bump_shares_one_transaction(self):
        from workers import graph_sync

        seen = []

        def fake_projector(tx, payload):
            seen.append(tx)

        tx = FakeTx()
        graph_sync._project_and_bump(tx, fake_projector, {"patient_id": "p1"})
        assert seen == [tx]
        assert len(tx.runs) == 1
        cypher, params = tx.runs[0]
        assert "graph_rev" in cypher
        assert params == {"pid": "p1"}


class TestResponseContract:
    def test_response_carries_rev(self):
        resp = HealthGraphResponse(nodes=[], edges=[], total_nodes=0, total_edges=0)
        assert resp.rev is None
        resp = HealthGraphResponse(nodes=[], edges=[], total_nodes=0, total_edges=0, rev="k")
        assert resp.rev == "k"

    def test_revision_response_shape(self):
        assert GraphRevisionResponse(rev=None).rev is None
        assert GraphRevisionResponse(rev="k").rev == "k"

    def test_revision_route_registered_before_node_detail(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        rev_pos = src.index('@router.get("/revision"')
        detail_pos = src.index('@router.get("/{node_id:path}"')
        assert rev_pos < detail_pos, "revision must not parse as a node id"
