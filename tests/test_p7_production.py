"""P7 production readiness tests (no live DB/Neo4j/Qdrant/network).

Covers:
- startup/config/health (ready endpoint, Firebase fail-fast, prod gates,
  CORS, logging level, shutdown dispose, gitignore, env docs)
- ingestion reliability (sweeper, single-commit mapping, hash scope,
  dedup behavior, idempotency single-store)
- worker reliability (per-event commit, continue-on-transient, AuthError
  fast DLQ, condition recency guard) — behavioral via fakes
- DLQ endpoint + Neo4j 503s + evidence degraded mode
- retrieval caps + batched citations
- chat citation envelopes + post-hoc validation
- frontend contracts (linked, chat citations)
- backfill guards + migration chain + lifecycle preservation
"""
import re
import uuid

from services.retrieval import templates as tpl


class TestStartupConfig:
    def test_ready_endpoint_semantics(self):
        with open("app/main.py") as f:
            src = f.read()
        assert '@app.get("/ready"' in src
        assert '"not-ready"' in src
        assert '"/ready"' in src  # exempt from the readiness gate

    def test_firebase_false_is_fatal(self):
        with open("app/main.py") as f:
            src = f.read()
        assert "if _firebase_ok is False:" in src

    def test_engine_dispose_on_shutdown(self):
        with open("app/main.py") as f:
            src = f.read()
        assert "_engine.dispose()" in src

    def test_prod_gates_cover_db_and_usda(self):
        with open("core/config.py") as f:
            src = f.read()
        assert "DATABASE_URL points at a local" in src
        assert "USDA_API_KEY is unset or the" in src

    def test_cors_production_deny(self):
        with open("app/main.py") as f:
            src = f.read()
        assert 'cors_origins = [] if settings.APP_ENV == "production" else ["*"]' in src

    def test_log_level_env_based(self):
        import importlib

        import logger as _logger_mod

        assert 'os.getenv("APP_ENV", "local")' in open("logger.py").read()
        import logging
        assert _logger_mod._LOG_LEVEL in (logging.DEBUG, logging.INFO)

    def test_get_db_rolls_back(self):
        with open("core/db.py") as f:
            src = f.read()
        assert "db.rollback()" in src

    def test_gitignore_covers_firebase(self):
        src = open(".gitignore").read()
        assert "firebase_credentials.json" in src

    def test_env_docs_cover_app_vars(self):
        src = open(".env.example").read()
        for var in ("APP_ENV=", "DOC_ENCRYPTION_KEY=", "RATE_LIMIT_TRUST_PROXY_HEADERS="):
            assert var in src, var
        assert "fails fast" in src.lower() or "FAIL FAST" in src

    def test_celery_binding_and_limits(self):
        with open("workers/graph_sync.py") as f:
            src = f.read()
        assert "@celery_app.task(" in src
        assert "@shared_task" not in src
        with open("core/celery_app.py") as f:
            cc = f.read()
        assert "task_time_limit=900" in cc
        assert "broker_connection_retry_on_startup=True" in cc

    def test_sweeper_task_and_beat(self):
        with open("workers/ingestion_tasks.py") as f:
            src = f.read()
        assert "sweep_stuck_documents" in src
        assert 'status.in_(["PROCESSING", "EXTRACTED"])' in src
        assert "STUCK_DOCUMENT_LEASE_MINUTES = 15" in src
        with open("core/celery_app.py") as f:
            cc = f.read()
        assert "sweep-stuck-documents-every-5-minutes" in cc

    def test_general_limiter_fail_closed_outside_local(self):
        with open("app/api/dependencies.py") as f:
            src = f.read()
        assert 'fail_open=settings.APP_ENV == "local"' in src


class TestIngestionSafety:
    def test_single_commit_mapping(self):
        import inspect

        from services.ocr import extraction_mapper as em

        src = inspect.getsource(em.ExtractionMapper.map_to_timeline)
        assert "db.flush()" in src
        assert "db.commit()" not in src

    def test_hash_scope_per_patient(self):
        from models.events import Document

        cols = {c.key: c for c in Document.__table__.columns}
        assert cols["file_hash"].unique is not True
        uniques = [c for c in Document.__table__.constraints
                   if type(c).__name__ == "UniqueConstraint"]
        assert any(set(u.columns.keys()) == {"patient_id", "file_hash"} for u in uniques)

    def test_upload_handles_races_and_deleted(self):
        with open("app/api/v1/documents.py") as f:
            src = f.read()
        assert 'Document.status != "DELETED"' in src
        assert "except IntegrityError:" in src
        assert "upload_dedup_race" in src

    def test_single_idempotency_store_in_submit(self):
        import inspect

        import app.api.v1.daily_logs as dl

        src = inspect.getsource(dl.submit_daily_checkin)
        assert src.count("store_idempotency_key(") == 1


class _FakeEvent:
    def __init__(self, event_type, payload, fail=None):
        from models.outbox import OutboxStatus

        self.id = uuid.uuid4()
        self.event_type = event_type
        self.payload = payload
        self.status = OutboxStatus.PENDING
        self.attempt_count = 0
        self.next_attempt_at = None
        self.locked_at = None
        self.processed_at = None
        self.last_error = None
        self._fail = fail


class _FakeScalars:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeExecResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return _FakeScalars(self._rows)


class _FakeDB:
    def __init__(self, events):
        self._events = events
        self.commits = 0

    def execute(self, *a, **k):
        return _FakeExecResult(self._events)

    def commit(self):
        self.commits += 1


class _FakeNeoSession:
    def __init__(self, behaviors):
        self.behaviors = behaviors  # event_id -> "ok" | exception instance
        self.calls = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute_write(self, fn, payload):
        from workers import graph_sync as _g

        key = (payload.get("event_id") or payload.get("observation_id")
               or payload.get("medication_id") or "x")
        self.calls.append(key)
        behavior = self.behaviors.get(key, "ok")
        if behavior != "ok":
            raise behavior
        # Run the real projection against a recording tx to prove the
        # worker actually invokes it (not just marks success).
        tx = _RecordingTx()
        fn(tx, payload)


class _RecordingTx:
    def __init__(self):
        self.ran = []

    def run(self, cypher, **kwargs):
        self.ran.append((cypher, kwargs))

        class R:
            def consume(self):
                return None
        return R()


class _FakeDriver:
    def __init__(self, behaviors):
        self.session_obj = _FakeNeoSession(behaviors)

    def session(self):
        return self.session_obj


def _clinical_payload(eid):
    return {
        "patient_id": "p1", "event_id": eid, "event_type": "LAB_RESULT",
        "source_type": "LAB_REPORT", "verification_status": "EXTRACTED",
        "event_time": "2026-01-01", "level_number": 20260101,
    }


class TestWorkerReliability:
    def test_per_event_commit_and_continue(self):
        from models.outbox import OutboxEventType, OutboxStatus
        from workers import graph_sync as g

        e1 = _FakeEvent(OutboxEventType.CLINICAL_EVENT_RECORDED, _clinical_payload("e1"))
        e2 = _FakeEvent(OutboxEventType.CLINICAL_EVENT_RECORDED, _clinical_payload("e2"),
                        fail=RuntimeError("boom"))
        e3 = _FakeEvent(OutboxEventType.CLINICAL_EVENT_RECORDED, _clinical_payload("e3"))
        db = _FakeDB([e1, e2, e3])
        driver = _FakeDriver({"e2": RuntimeError("boom")})
        g._process_outbox_events(db, driver, batch_size=50)
        assert e1.status == OutboxStatus.PROCESSED
        assert e2.status == OutboxStatus.PENDING  # transient → retry, not stuck
        assert e3.status == OutboxStatus.PROCESSED  # siblings unaffected
        assert db.commits >= 4  # claim + one per event (not a single batch commit)
        assert driver.session_obj.calls == ["e1", "e2", "e3"]

    def test_permanent_failure_dead_letters(self):
        from models.outbox import OutboxEventType, OutboxStatus
        from workers import graph_sync as g

        bad = _FakeEvent(OutboxEventType.CLINICAL_EVENT_RECORDED, {"patient_id": "p1"})
        db = _FakeDB([bad])
        g._process_outbox_events(db, _FakeDriver({}), batch_size=50)
        assert bad.status == OutboxStatus.DEAD_LETTER
        assert bad.last_error

    def test_auth_error_fast_dead_letter(self):
        from neo4j.exceptions import AuthError
        from models.outbox import OutboxEventType, OutboxStatus
        from workers import graph_sync as g

        e1 = _FakeEvent(OutboxEventType.CLINICAL_EVENT_RECORDED, _clinical_payload("e1"))
        db = _FakeDB([e1])
        g._process_outbox_events(db, _FakeDriver({"e1": AuthError("unauthorized")}), batch_size=50)
        assert e1.status == OutboxStatus.DEAD_LETTER
        assert e1.attempt_count == 0  # no retries burned
        assert "auth" in (e1.last_error or "")

    def test_condition_recency_guard(self):
        from workers import graph_sync as g

        tx = _RecordingTx()
        g._project_condition_tx(tx, {
            "patient_id": "p1", "condition_id": "c1", "name": "X", "normalized_name": "x"})
        assert "c.pg_updated_at IS NULL OR $pg_updated_at IS NULL" in tx.ran[0][0]

    def test_retirement_handler_allow_list(self):
        from workers import graph_sync as g
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        tx = _RecordingTx()
        g._project_node_retired_tx(tx, {"patient_id": "p1", "node_label": "SleepEpisode", "node_id": "e1"})
        assert "DETACH DELETE n" in tx.ran[0][0]
        assert "(p)-->(n)" in tx.ran[0][0]
        with _pytest.raises(PermanentProjectionError):
            g._project_node_retired_tx(_RecordingTx(), {
                "patient_id": "p1", "node_label": "Concept", "node_id": "x"})


class TestLifecycleWiring:
    def test_dlq_endpoint_patient_scoped(self):
        with open("app/api/v1/outbox.py") as f:
            src = f.read()
        assert 'payload["patient_id"]' in src
        assert "dead_letter" in src

    def test_neo4j_503s(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert "Retry-After" in src
        assert src.count("raise _neo4j_unavailable()") == 3

    def test_evidence_degraded_mode(self):
        with open("agents/tools/evidence.py") as f:
            src = f.read()
        assert "temporarily unavailable; structured records and provenance remain available" in src

    def test_qdrant_timeout(self):
        with open("services/vectorization/qdrant_client.py") as f:
            src = f.read()
        assert src.count("timeout=15") == 2

    def test_logs_scoped(self):
        with open("app/api/v1/logs.py") as f:
            src = f.read()
        assert "_patient_document_ids" in src
        assert "not in owned" in src


class TestRetrievalCaps:
    def test_neighbour_fetch_bounded(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert "WITH target, r, connected LIMIT 50" in src

    def test_tool_and_hydrate_caps(self):
        assert ".limit(50)" in open("agents/tools/documents.py").read()
        hyd = open("services/retrieval/hydrate.py").read()
        assert ".limit(50)" in hyd  # versions
        assert ".limit(100)" in hyd  # food entries
        assert ".limit(20)" in hyd  # condition meds/statements
        assert ".limit(500)" in hyd  # daily-log day
        life = open("agents/tools/lifestyle.py").read()
        assert "scans[:30]" in life

    def test_condition_citations_batched(self):
        with open("services/retrieval/context_windows.py") as f:
            src = f.read()
        assert "outerjoin" in src
        assert "hydrate_condition_detail" not in src


class TestChatCitations:
    def test_tool_envelopes(self):
        for path, key in (("agents/tools/timeline.py", '"citations"'),
                          ("agents/tools/observations.py", '"citations"'),
                          ("agents/tools/documents.py", '"citations"'),
                          ("agents/tools/body_state.py", '"citations"')):
            assert key in open(path).read(), path

    def test_evidence_chunk_keys(self):
        src = open("agents/tools/evidence.py").read()
        # P8.1: the citation envelope is built by the shared backend
        # search; the tool passes the keys through unchanged.
        assert "search_evidence_chunks" in src
        assert '"node_id": hit["node_id"]' in src
        assert '"quote"' in src
        assert '"evidence_level"' in src
        svc = open("services/vectorization/vector_indexing.py").read()
        assert '"node_id": f"document:{doc_id}"' in svc

    def test_posthoc_filter(self):
        from langchain_core.messages import ToolMessage
        from services.retrieval.evidence import filter_valid_citations

        real_id = str(uuid.uuid4())
        msgs = [ToolMessage(content=f'{{"document_id": "{real_id}", "quote": "exact supporting sentence here ok"}}',
                            tool_call_id="1")]
        good = {"document_id": real_id, "quote": "exact supporting sentence here ok"}
        bad = {"document_id": str(uuid.uuid4()), "quote": "invented reference text here"}
        short = {"node_id": "observation:abc"}
        kept = filter_valid_citations([good, bad, short], msgs)
        assert kept == [good]

    def test_posthoc_cap(self):
        from langchain_core.messages import ToolMessage
        from services.retrieval.evidence import filter_valid_citations

        real_id = str(uuid.uuid4())
        msgs = [ToolMessage(content=real_id * 1, tool_call_id="1")]
        many = [{"document_id": real_id} for _ in range(20)]
        assert len(filter_valid_citations(many, msgs)) == 10

    def test_synthesize_validates(self):
        with open("agents/orchestrator.py") as f:
            src = f.read()
        assert "filter_valid_citations(result.citations" in src

    def test_frontend_chat_citations(self):
        chat = open("frontend/src/screens/Chat/ChatScreen.tsx").read()
        assert "citations" in chat
        assert "DocumentDetail" in chat
        types = open("frontend/src/types/index.ts").read()
        assert "ChatCitation" in types
        hook = open("frontend/src/hooks/useHealthGraph.ts").read()
        assert "linked?:" in hook


class TestBackfillsAndChain:
    def test_backfill_guards(self):
        for path in ("scripts/backfill_p1_clinical_graph.py",
                     "scripts/backfill_p3_daily_domains.py",
                     "scripts/backfill_resolved_verifications.py"):
            assert "existing_outbox_refs" in open(path).read(), path
        assert "def existing_outbox_refs" in open("scripts/outbox_guards.py").read()

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

    def test_p7_migration_contents(self):
        with open("alembic/versions/p7c9e52d18f0_p7_dedup_scope_indexes.py") as f:
            src = f.read()
        assert "uq_document_patient_hash" in src
        assert "gin_trgm_ops" in src
        assert "ix_obs_event_id" in src

    def test_wellbeing_selector(self):
        from app.api.v1.daily_metrics import select_wellbeing_hit

        assert select_wellbeing_hit([("n", "t0"), ("s", "t1")], {"s": object()}) == ("s", "t1")
        assert select_wellbeing_hit([("n", "t0")], {}) is None

    def test_no_causal_edges(self):
        import glob

        for path in ["workers/graph_sync.py", "services/retrieval/templates.py",
                     "services/retrieval/context_windows.py"] + glob.glob("agents/tools/*.py"):
            with open(path) as f:
                src = f.read()
            for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
                for name in group.split("|"):
                    name = name.strip().rstrip("*0123456789. ")
                    if name:
                        assert name not in ("CAUSES", "TREATS", "NEXT"), f"{path}: {name}"
