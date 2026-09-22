"""P15 security/privacy fix regression tests.

Covers the defects verified in HealthGraph_P15_Security_Privacy_Audit.md:

- D7  Redis client refuses the deployment's ``ssl_cert_reqs=CERT_REQUIRED``
      spelling on redis-py >= 8, so every limiter hit its Redis-error path.
- D2  Cypher safety was only asserted over the registered template
      registry; inline Cypher in agents/tools bypassed it.
- D1  ``ClinicalEvent.source_snippet`` survived document deletion and was
      still emitted as a citation quote.
- D4  ``/api/v1/system/logs`` filtered on a payload key that
      ``LogEntry.to_dict()`` never emits, so it always returned nothing.

Pure/CI-safe: no live Redis, Neo4j, Qdrant or PostgreSQL required.
"""

import ast
import os
import pathlib
import uuid

import pytest
import redis as redis_lib

from app.api.v1 import logs as app_logs
from core.log_collector import LOG_DOC_KEY, LOG_DOC_UNSCOPED
from core.redis_client import (
    InvalidSslCertReqs,
    build_redis_client,
    normalize_redis_url,
    normalize_ssl_cert_reqs,
)
from services.retrieval.templates import (
    ALL_CYPHER,
    TERMINAL_LABELS,
    TOOL_CYPHER,
    UnsafeCypherError,
    check_cypher_safety,
    run_patient_cypher,
)

LIVE = os.getenv("P15_LIVE") == "1"
needs_live = pytest.mark.skipif(not LIVE, reason="live Neo4j/graph (P15_LIVE=1)")

# The exact deployment shape (credentials redacted).
_UPPER_URL = (
    "rediss://default:token@example-host.upstash.io:6379/0"
    "?ssl_cert_reqs=CERT_REQUIRED"
)


class TestD7SslCertReqsNormalization:
    """D7 — the configured TLS flag must be accepted by redis-py >= 8."""

    @staticmethod
    def _build_connection(url):
        """Build the connection object the pool would hand out, offline.

        from_url() is lazy and get_connection() dials the host, so the
        pool's own connection_class/connection_kwargs are used to exercise
        exactly the constructor that validated the flag in production.
        """
        pool = redis_lib.from_url(url).connection_pool
        return pool.connection_class(**pool.connection_kwargs)

    def test_original_uppercase_url_is_rejected_by_redis(self):
        """REPRODUCES the outage: the raw deployment URL cannot build a
        connection — redis-py validates the flag in SSLConnection.__init__."""
        with pytest.raises(redis_lib.RedisError, match="Invalid SSL Certificate"):
            self._build_connection(_UPPER_URL)

    def test_normalized_url_builds_a_connection(self):
        """After the fix the same URL yields a usable TLS connection."""
        conn = self._build_connection(normalize_redis_url(_UPPER_URL))
        assert type(conn).__name__ == "SSLConnection"

    def test_fix_keeps_certificate_verification_enabled(self):
        """The fix corrects the spelling only — verification stays ON.

        This is the anti-regression guard against "fix" by downgrading to
        CERT_NONE, which would silently disable TLS verification.
        """
        import ssl

        conn = self._build_connection(normalize_redis_url(_UPPER_URL))
        assert conn.cert_reqs == ssl.CERT_REQUIRED
        assert conn.cert_reqs != ssl.CERT_NONE

    @pytest.mark.parametrize(
        "given,expected",
        [
            ("CERT_REQUIRED", "required"),
            ("cert_required", "required"),
            ("required", "required"),
            ("CERT_NONE", "none"),
            ("none", "none"),
            ("CERT_OPTIONAL", "optional"),
            ("optional", "optional"),
        ],
    )
    def test_spelling_variants_map_to_canonical_tokens(self, given, expected):
        assert normalize_ssl_cert_reqs(given) == expected

    def test_required_spellings_all_mean_verification_enabled(self):
        """Normalisation must not downgrade: CERT_REQUIRED -> 'required'."""
        assert normalize_ssl_cert_reqs("CERT_REQUIRED") == "required"
        assert normalize_ssl_cert_reqs("required") == "required"

    @pytest.mark.parametrize("bad", ["", "yes", "CERT_MAYBE", "true", "2"])
    def test_unknown_value_raises_instead_of_downgrading(self, bad):
        """An unrecognised flag must fail loudly, never fall back to no-verify."""
        with pytest.raises(InvalidSslCertReqs):
            normalize_ssl_cert_reqs(bad)

    def test_normalize_preserves_credentials_host_and_path(self):
        out = normalize_redis_url(_UPPER_URL)
        assert out.startswith("rediss://default:token@example-host.upstash.io:6379/0")
        assert "ssl_cert_reqs=required" in out

    def test_normalize_preserves_other_query_params(self):
        url = (
            "rediss://u:p@h:6379/0?ssl_cert_reqs=CERT_REQUIRED"
            "&socket_timeout=5&db=0"
        )
        out = normalize_redis_url(url)
        assert "ssl_cert_reqs=required" in out
        assert "socket_timeout=5" in out
        assert "db=0" in out

    def test_normalize_is_idempotent(self):
        once = normalize_redis_url(_UPPER_URL)
        assert normalize_redis_url(once) == once

    def test_urls_without_the_flag_are_untouched(self):
        plain = "redis://localhost:6379/0"
        assert normalize_redis_url(plain) == plain
        assert normalize_redis_url("redis://localhost:6379/0?a=b") == (
            "redis://localhost:6379/0?a=b"
        )
        assert normalize_redis_url(None) is None
        assert normalize_redis_url("") == ""

    def test_build_client_from_explicit_url(self):
        client = build_redis_client(_UPPER_URL, decode_responses=True, db=0)
        assert client is not None


# ---------------------------------------------------------------------------
# D2 — terminal-label protection for inline / tool Cypher
# ---------------------------------------------------------------------------

# The exact cross-patient shape verified live on 2026-09-20:
#   P10A --HAS_MEDICATION_TAKEN--> MedicationTakenEvent --TAKEN_FROM-->
#        (m:Medication {norm_key: 'vitamin d'}) <--TAKEN_FROM--
#        MedicationTakenEvent <--HAS_MEDICATION_TAKEN-- other patient
# Six such 3-hop paths exist in the live graph between e10a1111 (P10A) and
# d91a1111; executing it anchored at P10A returns the other patient's
# MedicationTakenEvent id.
P10A = "e10a1111-2222-3333-4444-999999999999"
OTHER_PATIENT = "d91a1111-2222-3333-4444-777777777777"

BRIDGE_CYPHER = """
MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_TAKEN]->(e1:MedicationTakenEvent)
      -[:TAKEN_FROM]->(m:Medication)<-[:TAKEN_FROM]-(e2:MedicationTakenEvent)
      <-[:HAS_MEDICATION_TAKEN]-(b:Patient)
WHERE b.id <> $patient_id
RETURN b.id AS other_patient, e2.id AS other_event
"""

# The form the pre-P15 checker was written against (edge leaving the shared
# node written as an outgoing arrow). Both must be rejected.
BRIDGE_OUTGOING_CYPHER = (
    "MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_TAKEN]->(e)"
    "-[:TAKEN_FROM]->(m:Medication)-[:TAKEN_FROM]->(e2) RETURN e2"
)


def _looks_like_cypher(text: str) -> bool:
    return any(
        k in text
        for k in ("MATCH (", "OPTIONAL MATCH", "MERGE (", "DETACH DELETE")
    )


def _inline_cypher_statements() -> list[tuple[str, str]]:
    """AST-scan agents/tools for module-level Cypher string literals."""
    found: list[tuple[str, str]] = []
    tools_dir = pathlib.Path(__file__).resolve().parent.parent / "agents" / "tools"
    for path in sorted(tools_dir.glob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Assign)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
                and _looks_like_cypher(node.value.value)
            ):
                found.append((f"{path.name}:{node.lineno}", node.value.value))
    return found


class _BoomSession:
    """Session that fails the test if any query reaches Neo4j."""

    def run(self, *args, **kwargs):  # pragma: no cover - must never run
        raise AssertionError(
            "unsafe Cypher reached the database instead of being rejected"
        )


class TestD2TerminalTraversalProtection:
    def test_medication_is_a_terminal_label(self):
        assert "Medication" in TERMINAL_LABELS
        assert "Concept" in TERMINAL_LABELS
        assert "AnatomicalStructure" in TERMINAL_LABELS

    def test_real_bridge_shape_is_flagged(self):
        """REGRESSION: the live P10A -> vitamin d -> other-patient shape.

        The pre-fix checker only matched edges written as `(m:Medication)-[..]->`
        and therefore did NOT flag this query, even though it is the bridge that
        actually exists in the graph.
        """
        violations = check_cypher_safety(BRIDGE_CYPHER)
        assert any("terminal label Medication" in v for v in violations), violations

    def test_outgoing_bridge_shape_is_still_flagged(self):
        violations = check_cypher_safety(BRIDGE_OUTGOING_CYPHER)
        assert any("terminal label Medication" in v for v in violations), violations

    @pytest.mark.parametrize(
        "label,cypher",
        [
            (
                "Concept",
                "MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)"
                "-[:HAS_CODE]->(c:Concept)<-[:HAS_CODE]-(o2) RETURN o2",
            ),
            (
                "AnatomicalStructure",
                "MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(o:Observation)"
                "-[:AFFECTS]->(s:AnatomicalStructure)<-[:AFFECTS]-(o2) RETURN o2",
            ),
        ],
    )
    def test_every_shared_label_is_protected_in_both_directions(self, label, cypher):
        assert any(
            f"terminal label {label}" in v for v in check_cypher_safety(cypher)
        )

    def test_contains_carve_out_preserved(self):
        """Global anatomy hierarchy traversal stays legal."""
        down = (
            "MATCH (p:Patient {id: $patient_id}) "
            "MATCH (t:AnatomicalStructure {id: $s})-[:CONTAINS*0..]->(x:AnatomicalStructure) "
            "RETURN x"
        )
        up = (
            "MATCH (p:Patient {id: $patient_id}) "
            "MATCH (t:AnatomicalStructure {id: $s})<-[:CONTAINS*1..]-(a:AnatomicalStructure) "
            "RETURN a"
        )
        assert check_cypher_safety(down) == []
        assert check_cypher_safety(up) == []

    def test_all_registered_and_tool_statements_are_safe(self):
        unsafe = {k: check_cypher_safety(v) for k, v in ALL_CYPHER.items()}
        assert {k: v for k, v in unsafe.items() if v} == {}
        assert len(ALL_CYPHER) >= 25

    def test_tool_statements_are_registered(self):
        """Every statement an agent tool runs is in the registry."""
        for expected in (
            "T-OBS",
            "T-OBS-EXACT",
            "T-TIME",
            "T-DOC-PROVENANCE",
            "T-STRUCT-CTX",
            "T-STRUCT-CTX-EXACT",
        ):
            assert expected in TOOL_CYPHER

    def test_run_patient_cypher_refuses_bridge_without_querying(self):
        """The gate must reject before the session is used."""
        with pytest.raises(UnsafeCypherError):
            run_patient_cypher(
                _BoomSession(), BRIDGE_CYPHER, {"patient_id": P10A},
                statement_id="BRIDGE",
            )

    def test_run_patient_cypher_passes_safe_statements_through(self):
        class _RecordingSession:
            def __init__(self):
                self.calls = []

            def run(self, cypher, **params):
                self.calls.append((cypher, params))
                return "result"

        session = _RecordingSession()
        out = run_patient_cypher(
            session,
            TOOL_CYPHER["T-TIME"],
            {"patient_id": P10A, "limit": 5},
            statement_id="T-TIME",
        )
        assert out == "result"
        assert session.calls[0][1] == {"patient_id": P10A, "limit": 5}

    def test_no_inline_cypher_left_in_agent_tools(self):
        """No tool may keep Cypher inline, where the checker cannot see it."""
        inline = _inline_cypher_statements()
        assert inline == [], f"inline Cypher still present: {[loc for loc, _ in inline]}"

    def test_no_tool_cypher_traverses_a_terminal_label(self):
        for sid, cypher in TOOL_CYPHER.items():
            assert check_cypher_safety(cypher) == [], sid


# ---------------------------------------------------------------------------
# D1 — deleted-document evidence must not survive as a citation quote
# ---------------------------------------------------------------------------


class TestD1DeletedDocumentEvidence:
    def _event(self, snippet):
        class _VT(str):
            value = "EXTRACTED"

        class _ST(str):
            value = "LAB_REPORT"

        class _Event:
            event_id = uuid.uuid4()
            concept_id = None
            verification_status = _VT()
            source_type = _ST()

        ev = _Event()
        ev.source_snippet = snippet
        return ev

    def test_no_evidence_and_no_snippet_yields_no_quote(self):
        """The post-deletion state must not reconstruct a quote.

        Hydration is `(evidence.extracted_text) or event.source_snippet`.
        Reproduces the D1 fix: once the EvidenceLink is gone AND the snippet
        is cleared, there is nothing left to emit.
        """
        from services.retrieval.hydrate import _assemble_event_detail

        detail = _assemble_event_detail(
            self._event(None), None, None, None, None, []
        )
        assert detail["citation"].quote is None
        assert detail["citation"].document_id is None

    def test_snippet_only_still_emits_without_a_document(self):
        """Documents the pre-fix behaviour that made the leak possible.

        If source_snippet is left populated, hydration still emits the text
        as a quote (with no document attached). The fix is to clear it at
        deletion time; this test pins why that is required.
        """
        from services.retrieval.hydrate import _assemble_event_detail

        detail = _assemble_event_detail(
            self._event("deleted document text"), None, None, None, None, []
        )
        assert detail["citation"].quote == "deleted document text"

    def test_delete_cascade_clears_verbatim_source_text(self):
        """Source assertion: the deletion path must null the snippet fields.

        Static check (same style as the other lifecycle guards) because the
        cascade needs a live session; the behavioural proof is the
        disposable-fixture reproduction recorded in the validation report.
        """
        import inspect

        from app.api.v1 import documents as docs_module

        src = inspect.getsource(docs_module.delete_document)
        assert "ClinicalEvent.source_snippet: None" in src
        assert "AnatomicalObservation.source_snippet: None" in src
        # The sourced event ids must be resolved BEFORE the links are deleted.
        assert src.index("sourced_event_ids") < src.index(
            "EvidenceLink.document_id == document_id).delete()"
        )

    def test_delete_cascade_scopes_snippet_clear_to_the_patient(self):
        import inspect

        from app.api.v1 import documents as docs_module

        src = inspect.getsource(docs_module.delete_document)
        block = src[src.index("if sourced_event_ids:"):]
        block = block[: block.index("db.query(AnatomicalObservation)")]
        assert "ClinicalEvent.patient_id == patient_id" in block

    def test_hydration_excludes_deleted_documents(self):
        """Defense in depth: the citation document lookup filters DELETED."""
        import inspect

        from services.retrieval import hydrate

        src = inspect.getsource(hydrate)
        assert src.count('Document.status != "DELETED"') >= 5


# ---------------------------------------------------------------------------
# D3 — no answer text / paths / exception payloads in logs
# ---------------------------------------------------------------------------


class TestD3LoggingLeakage:
    def _src(self, module):
        import inspect

        return inspect.getsource(module)

    def test_orchestrator_does_not_log_model_content(self):
        """The LLM's answer text must never reach a log record."""
        import agents.orchestrator as orch

        src = self._src(orch)
        # The old debug line interpolated the raw answer text.
        assert "LLM DEBUG" not in src
        assert "content=%r" not in src
        # Content may only ever be measured, never formatted into the record.
        assert "content_chars=%s" in src
        assert "len(response.content)" in src
        assert "LLM routing | tool_calls=%s | content_chars=%s" in src

    def test_orchestrator_routing_log_is_debug_only(self):
        import agents.orchestrator as orch

        src = self._src(orch)
        idx = src.index("LLM routing | tool_calls=%s | content_chars=%s")
        assert "logger.debug(" in src[idx - 120:idx]

    def test_chat_does_not_interpolate_exception_text(self):
        import app.api.v1.chat as chat_module

        src = self._src(chat_module)
        assert "{type(e).__name__}: {e}" not in src
        assert "{retry_err}" not in src

    def test_ingestion_logs_no_filesystem_paths_or_exception_text(self):
        import workers.ingestion_tasks as ingest

        src = self._src(ingest)
        assert "to temp file: {temp_doc_path}" not in src
        assert "Cleaned up temp file: {temp_doc_path}" not in src
        assert "Failed to clean up temp file {temp_doc_path}" not in src
        assert "{str(e)}" not in src

    def test_document_upload_does_not_log_broker_exception(self):
        import app.api.v1.documents as docs_module

        src = self._src(docs_module)
        assert "type=%s: %s" not in src

    def test_validate_errors_are_categories_not_values(self):
        """The de-id warning may log validation errors only because they are
        categorical; pin that contract so a future change cannot start
        putting the matched PII itself into the log line."""
        from services.deidentification.validator import LeakageValidator

        result = LeakageValidator().validate(
            "reach me at a@b.com or 555-123-4567", extra_names=["Jane Doe"]
        )
        assert result.passed is False
        joined = " ".join(result.errors)
        assert "a@b.com" not in joined
        assert "555-123-4567" not in joined
        assert "Jane Doe" not in joined


# ---------------------------------------------------------------------------
# D4 — /api/v1/system/logs patient scoping
# ---------------------------------------------------------------------------


class _FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeDocDB:
    def __init__(self, document_ids):
        self._ids = [uuid.UUID(d) for d in document_ids]

    def execute(self, stmt):
        return _FakeResult([(d,) for d in self._ids])


class _FakeLogs:
    def __init__(self, entries):
        self._entries = entries

    def recent(self, n=100, document_id=None):
        if document_id:
            return [e for e in self._entries
                    if e.get(LOG_DOC_KEY) == document_id][:n]
        return self._entries[-n:]


class TestD4SystemLogFilter:
    MINE = "11111111-1111-1111-1111-111111111111"
    THEIRS = "22222222-2222-2222-2222-222222222222"

    def _entries(self):
        return [
            {"time": "10:00:00", "level": "INFO", LOG_DOC_KEY: self.MINE,
             "msg": "mine"},
            {"time": "10:00:01", "level": "INFO", LOG_DOC_KEY: self.THEIRS,
             "msg": "theirs"},
            {"time": "10:00:02", "level": "INFO", LOG_DOC_KEY: LOG_DOC_UNSCOPED,
             "msg": "unscoped"},
        ]

    def test_filter_key_matches_what_to_dict_emits(self):
        """REGRESSION: the filter key must be the key to_dict() writes."""
        from core.log_collector import LogEntry

        entry = LogEntry(timestamp=0.0, level="INFO", document_id=self.MINE,
                         message="m")
        payload = entry.to_dict()
        assert LOG_DOC_KEY in payload
        assert "document_id" not in payload
        assert app_logs._entry_document_id(payload) == self.MINE

    def test_unscoped_entry_maps_to_none(self):
        from core.log_collector import LogEntry

        entry = LogEntry(timestamp=0.0, level="INFO", document_id=None, message="m")
        assert app_logs._entry_document_id(entry.to_dict()) is None

    def test_recent_returns_only_the_patients_own_document_logs(self, monkeypatch):
        monkeypatch.setattr(app_logs, "pipeline_logs", _FakeLogs(self._entries()))
        out = app_logs.get_recent_logs(
            n=100, document_id=None, _patient_id=uuid.UUID(self.MINE),
            db=_FakeDocDB([self.MINE]),
        )
        assert [e["msg"] for e in out["logs"]] == ["mine"]

    def test_other_patients_document_logs_are_never_returned(self, monkeypatch):
        monkeypatch.setattr(app_logs, "pipeline_logs", _FakeLogs(self._entries()))
        out = app_logs.get_recent_logs(
            n=100, document_id=None, _patient_id=uuid.UUID(self.THEIRS),
            db=_FakeDocDB([self.THEIRS]),
        )
        assert [e["msg"] for e in out["logs"]] == ["theirs"]

    def test_explicit_document_must_be_owned(self, monkeypatch):
        from fastapi import HTTPException

        monkeypatch.setattr(app_logs, "pipeline_logs", _FakeLogs(self._entries()))
        with pytest.raises(HTTPException) as exc:
            app_logs.get_recent_logs(
                n=100, document_id=self.THEIRS, _patient_id=uuid.UUID(self.MINE),
                db=_FakeDocDB([self.MINE]),
            )
        assert exc.value.status_code == 404

    def test_stream_filters_through_the_same_helper(self):
        import inspect

        src = inspect.getsource(app_logs.stream_logs)
        assert "_entry_document_id(entry) not in owned" in src


# ---------------------------------------------------------------------------
# D6 — erasure contract is intake-only (NOT IMPLEMENTED by design)
# ---------------------------------------------------------------------------


class TestD6ErasureContractIsExplicit:
    """P15 / D6 pinned intake-only erasure; Phase 5 deliberately supersedes
    it with reviewed fulfillment (services/erasure.py + the two DELETE
    endpoints below). The tripwire stays, inverted: erasure logic must live
    in exactly that one orchestrator module — never scattered ad-hoc across
    app/services/workers.
    """

    def test_erasure_fulfillment_lives_only_in_orchestrator(self):
        import re

        pattern = re.compile(
            r"def\s+(erase|purge|anonymi[sz]e|delete_patient)\w*\s*\(", re.I
        )
        project_root = pathlib.Path(__file__).resolve().parent.parent
        hits = []
        for folder in ("app", "services", "workers"):
            for path in (project_root / folder).rglob("*.py"):
                for lineno, line in enumerate(path.read_text().splitlines(), 1):
                    if pattern.search(line):
                        hits.append(f"{path.relative_to(project_root)}:{lineno}")
        assert hits != [], "erasure fulfillment regressed to intake-only"
        assert all(
            h.startswith("services/erasure.py") for h in hits
        ), f"erasure logic outside the orchestrator: {hits}"

    def test_privacy_router_exposes_intake_only(self):
        from app.api.v1 import privacy

        paths = {
            (r.path, m)
            for r in privacy.router.routes
            for m in sorted(getattr(r, "methods", []) or [])
        }
        assert paths == {
            ("/api/v1/privacy/consent", "GET"),
            ("/api/v1/privacy/consent", "POST"),
            ("/api/v1/privacy/consent/withdraw", "POST"),
            ("/api/v1/privacy/requests", "GET"),
            ("/api/v1/privacy/requests", "POST"),
            ("/api/v1/privacy/export", "GET"),
            ("/api/v1/privacy/data", "DELETE"),
            ("/api/v1/privacy/account", "DELETE"),
        }, "privacy surface changed; update the D6 contract statement"

    def test_module_documents_fulfillment_orchestrator(self):
        import inspect

        from app.api.v1 import privacy

        src = inspect.getsource(privacy)
        assert "erasure orchestrator" in src
        assert "DELETE /privacy/data" in src
        assert "DELETE /privacy/account" in src

    def test_document_deletion_stays_patient_scoped(self):
        """The lifecycle we DO have must remain scoped (D6 verification)."""
        import inspect

        from app.api.v1 import documents as docs_module

        src = inspect.getsource(docs_module.delete_document)
        assert "Document.patient_id == patient_id" in src
        assert "AnatomicalObservation.patient_id == patient_id" in src
        assert "ClinicalEvent.patient_id == patient_id" in src

    def test_correction_retirement_is_patient_scoped(self):
        import inspect

        from services.clinical import corrections

        src = inspect.getsource(corrections.retire_document_event)
        assert "ClinicalEvent.patient_id == patient_id" in src
        assert "enqueue_graph_node_retired" in src


class TestD2LiveGraph:
    """Live proof that the gate blocks the bridge on the real graph."""

    @needs_live
    def test_bridge_is_rejected_at_runtime(self):
        from core.neo4j_client import neo4j_driver

        with neo4j_driver.session() as session:
            with pytest.raises(UnsafeCypherError):
                run_patient_cypher(
                    session, BRIDGE_CYPHER, {"patient_id": P10A},
                    statement_id="BRIDGE",
                )

    @needs_live
    def test_shared_node_still_exists_but_is_unreachable(self):
        """The bridge exists in the graph; no sanctioned statement walks it.

        Executing the raw (unsafe) query proves the risk is real; asserting
        none of the registered statements produce cross-patient rows proves
        the protection holds.
        """
        from core.neo4j_client import neo4j_driver

        with neo4j_driver.session() as session:
            raw = list(
                session.run(BRIDGE_CYPHER, patient_id=P10A)
            )
            assert raw, "expected the live shared-Medication bridge to exist"
            assert all(r["other_patient"] != P10A for r in raw)

            for sid, cypher in ALL_CYPHER.items():
                assert check_cypher_safety(cypher) == [], sid
