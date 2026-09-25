"""P15 hardening regression tests (DB-less, CI-safe).

Covers the confirmed findings without any live PostgreSQL / Neo4j /
Qdrant / Redis / Firebase:

  - medication source_document_id ownership predicate (FakeSession);
  - graph detail fetch patient-reachability scoping (structural pin);
  - erasure reachability sweep + verify predicates (pure builders);
  - PG residual tripwire counter (FakeSession);
  - ingestion DELETED re-check helper + mapper guard (fakes);
  - SSE per-stream dedup owned-status scoping (structural pins);
  - Redis pipeline-log TTL + patient purge (FakeRedis).
"""

import os
import uuid

os.environ.setdefault("CELERY_BROKER_URL", "redis://localhost:6379/0")
os.environ.setdefault("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")

from app.api.v1.medications import (  # noqa: E402
    validate_source_document_ownership,
)
from core.log_collector import (  # noqa: E402
    LogCollector,
    _LOG_KEY,
    _LOG_TTL_SECONDS,
)
from services.erasure import (  # noqa: E402
    build_patient_graph_deletes,
    build_patient_graph_verify,
    count_patient_postgres_residual,
)
from workers.ingestion_tasks import _document_deleted_or_gone  # noqa: E402


PID_A = uuid.uuid4()
PID_B = uuid.uuid4()
DOC_A = uuid.uuid4()
DOC_B = uuid.uuid4()


class FakeQuery:
    """Minimal chainable query stand-in: query()->filter()->first()/scalar()."""

    def __init__(self, first=None, scalars=None):
        self._first = first
        # Shared reference (not a copy): successive queries consume
        # successive values, modelling per-table counts.
        self._scalars = scalars if scalars is not None else []

    def filter(self, *args, **kwargs):
        return self

    def select_from(self, *args, **kwargs):
        return self

    def first(self):
        return self._first

    def scalar(self):
        if self._scalars:
            return self._scalars.pop(0)
        return 0


class FakeSession:
    def __init__(self, first=None, scalars=None):
        self._first = first
        self._scalars = list(scalars) if scalars is not None else None

    def query(self, *args, **kwargs):
        return FakeQuery(first=self._first, scalars=self._scalars)


class FakeRedis:
    """In-memory list + expiry stand-in (strings, like decode_responses)."""

    def __init__(self):
        self.store = {}
        self.expiries = {}
        self.deleted = []

    def rpush(self, key, *values):
        self.store.setdefault(key, []).extend(values)
        return len(self.store[key])

    def ltrim(self, key, start, end):
        items = self.store.get(key, [])
        self.store[key] = items[start:] if end == -1 else items[start:end + 1]

    def expire(self, key, seconds):
        self.expiries[key] = seconds
        return True

    def lrange(self, key, start, end):
        items = self.store.get(key, [])
        return items[start:] if end == -1 else items[start:end + 1]

    def delete(self, key):
        self.deleted.append(key)
        self.store.pop(key, None)
        return 1


# --- medication source_document_id ownership -------------------------------

def test_owned_document_passes():
    db = FakeSession(first=(DOC_A,))
    assert validate_source_document_ownership(db, PID_A, DOC_A) is True


def test_foreign_document_rejected():
    db = FakeSession(first=None)
    assert validate_source_document_ownership(db, PID_A, DOC_B) is False


# --- graph detail fetch scoping (structural pin) ----------------------------

def _health_graph_source():
    import pathlib
    return pathlib.Path("app/api/v1/health_graph.py").read_text()


def test_generic_fetch_requires_patient_reachability():
    src = _health_graph_source()
    assert "MATCH (p:Patient {id: $patient_id})-[*1..4]-(target {id: $raw_id})" in src
    assert "MATCH (target {id: $raw_id})" not in src


# --- erasure reachability sweep + verify -------------------------------------

def test_sweep_covers_multihop_and_shared_labels_excluded():
    stmts = build_patient_graph_deletes(PID_A)
    sweep = [s for s in stmts if s["description"] == "relationship sweep (excluding shared labels)"]
    assert len(sweep) == 1
    cypher = sweep[0]["cypher"]
    assert "[*1..4]" in cypher
    assert "NOT n:Concept" in cypher and "NOT n:AnatomicalStructure" in cypher
    assert sweep[0]["params"].get("pid") == str(PID_A)


def test_verify_counts_reachable_not_just_tagged():
    verify = build_patient_graph_verify()
    assert "[*1..4]" in verify["cypher"]
    assert "NOT n:Concept" in verify["cypher"]


# --- PG residual tripwire -----------------------------------------------------

def test_pg_residual_zero_when_clean():
    db = FakeSession(scalars=[])
    assert count_patient_postgres_residual(db, PID_A) == 0


def test_pg_residual_counts_survivors():
    db = FakeSession(scalars=[0, 2] + [0] * 20)
    assert count_patient_postgres_residual(db, PID_A) == 2


# --- ingestion DELETED re-check ------------------------------------------------

def test_deleted_document_aborts():
    assert _document_deleted_or_gone(FakeSession(first=("DELETED",)), DOC_A) is True


def test_missing_document_aborts():
    assert _document_deleted_or_gone(FakeSession(first=None), DOC_A) is True


def test_live_document_continues():
    assert _document_deleted_or_gone(FakeSession(first=("COMPLETED",)), DOC_A) is False


def test_read_error_fails_open_to_pipeline():
    class ExplodingSession(FakeSession):
        def query(self, *args, **kwargs):
            raise ConnectionError("db down")

    assert _document_deleted_or_gone(ExplodingSession(), DOC_A) is False


def test_mapper_skips_deleted_document():
    from services.ocr.extraction_mapper import ExtractionMapper

    class Raw:
        extraction = {"document": {}}

    class Doc:
        status = "DELETED"

    class FakeDb:
        def __init__(self):
            self.calls = 0

        def scalars(self, *args, **kwargs):
            outer = self

            class OneShot:
                def first(self):
                    outer.calls += 1
                    return Raw() if outer.calls == 1 else Doc()

            return OneShot()

    assert ExtractionMapper.map_to_timeline(FakeDb(), DOC_A) == (0, [])


# --- graph drain erasure fence ---------------------------------------------------

def test_erasure_fence_drops_erased_patient_events():
    from models.outbox import OutboxStatus
    from workers.graph_sync import _drop_erased_patient_events

    class Ev:
        def __init__(self, pid):
            self.payload = {"patient_id": str(pid)}
            self.status = "PROCESSING"
            self.locked_at = "x"
            self.last_error = None

    class Q:
        def all(self):
            return [(PID_A,)]

    class DB:
        def __init__(self):
            self.committed = 0

        def query(self, *args, **kwargs):
            return Q()

        def commit(self):
            self.committed += 1

    live, dead = Ev(PID_A), Ev(PID_B)
    kept = _drop_erased_patient_events(DB(), [live, dead])
    assert kept == [live]
    assert dead.status == OutboxStatus.DEAD_LETTER
    assert dead.last_error == "patient erased; projection dropped"
    assert dead.locked_at is None


def test_erasure_fence_keeps_events_when_check_fails():
    from workers.graph_sync import _drop_erased_patient_events

    class Ev:
        def __init__(self):
            self.payload = {"patient_id": str(PID_B)}

    class BrokenDB:
        def query(self, *args, **kwargs):
            raise ConnectionError("db down")

        def commit(self):
            raise AssertionError("must not commit on check failure")

    ev = Ev()
    assert _drop_erased_patient_events(BrokenDB(), [ev]) == [ev]


# --- SSE per-stream scoping (structural pins) -----------------------------------

def _logs_source():
    import pathlib
    return pathlib.Path("app/api/v1/logs.py").read_text()


def test_no_module_global_dedup_state():
    assert "_seen_keys" not in _logs_source()


def test_owned_scope_excludes_deleted():
    assert 'Document.status != "DELETED"' in _logs_source()


# --- Redis pipeline logs: TTL + purge -------------------------------------------

def _entry(doc, msg):
    import json
    return json.dumps({"t": 0.0, "l": "INFO", "d": doc, "m": msg})


def test_append_sets_ttl():
    collector = LogCollector()
    fake = FakeRedis()
    collector._redis = fake
    collector.append("info", "hello", document_id="doc-1")
    assert fake.expiries.get(_LOG_KEY) == _LOG_TTL_SECONDS
    assert len(fake.store[_LOG_KEY]) == 1


def test_purge_removes_only_patient_entries():
    collector = LogCollector()
    fake = FakeRedis()
    collector._redis = fake
    fake.store[_LOG_KEY] = [
        _entry("doc-a", "m1"),
        _entry("doc-b", "m2"),
        _entry("-", "m3"),
    ]
    removed = collector.purge_patient_logs({"doc-a"})
    assert removed == 1
    assert len(fake.store[_LOG_KEY]) == 2
    assert fake.expiries.get(_LOG_KEY) == _LOG_TTL_SECONDS


def test_purge_empty_set_touches_nothing():
    collector = LogCollector()
    fake = FakeRedis()
    collector._redis = fake
    assert collector.purge_patient_logs(set()) == 0
    assert fake.store == {}


def test_purge_redis_failure_returns_zero():
    collector = LogCollector()

    class Broken:
        def __getattr__(self, name):
            raise ConnectionError("redis down")

    collector._redis = Broken()
    assert collector.purge_patient_logs({"doc-a"}) == 0
