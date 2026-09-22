"""Tests for the patient erasure orchestrator (Phase 5).

No live PostgreSQL / Neo4j / Qdrant / Firebase here (none is reachable from
this environment, and CI runs PG-free too). Coverage strategy:

  - inventory completeness against the REAL SQLAlchemy metadata: every table
    carrying a patient_id column must be classified, and shared tables must
    be excluded (catches future tables missing from erasure);
  - FK-safe execution order pinned for every edge a plain FK requires;
  - Neo4j builders: owned labels covered exactly once, shared labels never
    touched, patient guard on every statement, Patient node droppable;
  - Qdrant filter shape; checkpoint table allowlist;
  - route registration on the real FastAPI app (import pattern shared with
    test_main_security.py — no lifespan, no DB touched).
"""

import uuid

import pytest

import models.anatomy  # noqa: F401 — register metadata
import models.chat  # noqa: F401
import models.conditions  # noqa: F401
import models.daily_logs.events  # noqa: F401
import models.deidentification  # noqa: F401
import models.events  # noqa: F401
import models.food  # noqa: F401
import models.idempotency  # noqa: F401
import models.identity  # noqa: F401
import models.measurements  # noqa: F401
import models.medication_versions  # noqa: F401
import models.medications  # noqa: F401
import models.ontology  # noqa: F401
import models.outbox  # noqa: F401
import models.ppg  # noqa: F401
import models.privacy  # noqa: F401
import models.statements  # noqa: F401
import models.summaries  # noqa: F401
import models.visits  # noqa: F401
from models.base import Base

from services.erasure import (
    CHECKPOINT_TABLES,
    ERASURE_EVENT_TABLES,
    ERASURE_PATIENT_TABLES,
    ERASURE_STEP_ORDER,
    NEO4J_OWNED_LABELS,
    NEO4J_SHARED_LABELS,
    RETAINED_SHARED_TABLES,
    build_patient_graph_deletes,
    build_patient_graph_verify,
    build_qdrant_patient_filter,
    patient_owned_tables,
    unclassified_patient_tables,
)


def test_every_patient_table_is_classified():
    missing = unclassified_patient_tables()
    assert missing == set(), f"patient tables missing from erasure inventory: {missing}"


def test_shared_tables_are_never_classified():
    classified = set(ERASURE_PATIENT_TABLES) | set(ERASURE_EVENT_TABLES)
    for table in RETAINED_SHARED_TABLES:
        assert table not in classified
    # And they genuinely carry no patient_id column (belt and braces).
    owned = patient_owned_tables()
    for table in RETAINED_SHARED_TABLES:
        assert table not in owned
    # Ontology / providers / facilities must exist in metadata (else this
    # test would pass vacuously on an empty registry).
    assert "medical_concepts" in Base.metadata.tables
    assert "patients" in owned


def test_step_order_respects_plain_fk_edges():
    order = list(ERASURE_STEP_ORDER)

    def before(a: str, b: str) -> None:
        assert order.index(a) < order.index(b), f"{a} must precede {b}"

    # Payload/lab/event children (FK → clinical_events, no CASCADE).
    before("payload_vital_signs", "clinical_events")
    before("lab_results", "clinical_events")
    before("medication_events", "clinical_events")
    before("daily_health_entries", "clinical_events")
    # Evidence quotes events + documents (no CASCADE).
    before("evidence_links", "clinical_events")
    before("evidence_links", "documents")
    # Derivatives before documents.
    before("raw_extraction", "documents")
    # Taken + versions before regimens.
    before("medication_taken_events", "medications")
    before("medication_versions", "medications")
    # Entries before scans.
    before("food_entries", "food_scans")
    # Patient row is always last.
    assert order[-1] == "patients"


def test_step_order_covers_the_inventory():
    assert set(ERASURE_STEP_ORDER) >= set(ERASURE_PATIENT_TABLES) | set(ERASURE_EVENT_TABLES) | {
        "clinical_events", "documents", "checkpoints", "graph_sync_outbox",
        "raw_extraction", "document_blobs", "patients",
    }


def test_graph_deletes_cover_owned_labels_exactly_once():
    pid = uuid.uuid4()
    stmts = build_patient_graph_deletes(pid)
    label_stmts = [s for s in stmts if s["description"].startswith("owned label ")]
    labels = [s["description"].removeprefix("owned label ") for s in label_stmts]
    assert sorted(labels) == sorted(NEO4J_OWNED_LABELS)
    # Every statement carries the patient guard (no cross-patient delete).
    for stmt in stmts:
        assert stmt["params"].get("pid") == str(pid) or "prefix" in stmt["params"]
        assert "Concept" not in stmt["cypher"] or "NOT n:Concept" in stmt["cypher"]
    # Patient node is present and last (droppable for delete-data mode).
    assert stmts[-1]["description"] == "Patient node"
    assert "MATCH (p:Patient {id: $pid})" in stmts[-1]["cypher"]


def test_graph_deletes_never_touch_shared_labels():
    pid = uuid.uuid4()
    stmts = build_patient_graph_deletes(pid)
    for shared in NEO4J_SHARED_LABELS:
        for stmt in stmts:
            assert f"(:{shared})" not in stmt["cypher"].replace("NOT n:", "NOT "), (
                f"shared label {shared} must only appear behind NOT in {stmt['description']}"
            )
    verify = build_patient_graph_verify()
    assert "NOT n:Concept" in verify["cypher"]
    assert "NOT n:AnatomicalStructure" in verify["cypher"]


def test_qdrant_filter_is_patient_scoped():
    pid = uuid.uuid4()
    filt = build_qdrant_patient_filter(pid)
    assert filt == {"must": [{"key": "patient_id", "match": {"value": str(pid)}}]}


def test_checkpoint_tables_exclude_migrations():
    assert "checkpoint_migrations" not in CHECKPOINT_TABLES
    assert set(CHECKPOINT_TABLES) == {"checkpoints", "checkpoint_writes", "checkpoint_blobs"}


def test_erasure_routes_registered():
    from app.main import app
    def flattened(routes):
        for r in routes:
            original = getattr(r, "original_router", None)
            if original is not None and hasattr(original, "routes") and original is not r:
                # FastAPI >=0.14x include marker: real routes live underneath.
                yield from flattened(original.routes)
            elif hasattr(r, "methods") and hasattr(r, "path"):
                yield tuple(sorted(r.methods or [])), r.path

    routes = set(flattened(app.routes))
    assert (("DELETE",), "/api/v1/privacy/data") in routes
    assert (("DELETE",), "/api/v1/privacy/account") in routes


def test_orchestrator_is_importable_without_infra():
    import services.erasure as erasure

    assert callable(erasure.orchestrate_erasure)
    assert callable(erasure.erase_patient_postgres)
    assert erasure.ERASURE_MAX_REPASSES >= 1


def test_cypher_never_interpolates_patient_input():
    # Injection safety: the patient id travels via parameters only — no
    # statement text may contain the literal id.
    pid = uuid.uuid4()
    for stmt in build_patient_graph_deletes(pid):
        assert str(pid) not in stmt["cypher"]
        assert "$pid" in stmt["cypher"] or "$prefix" in stmt["cypher"]


def test_erasure_endpoints_require_auth_not_404():
    """Unauthenticated DELETE must 401/403 (route mounted + auth enforced),
    never 404. A 404 here would mean the routes are missing from the
    deployed build — the exact failure mode of the incident where the client
    reported 'check your connection' against a backend predating erasure.
    No database is touched: auth rejects before any query runs.
    """
    from fastapi.testclient import TestClient

    from app.main import app

    # No lifespan runs under TestClient here, so the readiness gate would
    # 503 everything. Simulate a ready server (restored afterwards).
    was_ready = bool(getattr(app.state, "ready", False))
    app.state.ready = True
    try:
        client = TestClient(app, raise_server_exceptions=False)
        for path in ("/api/v1/privacy/data", "/api/v1/privacy/account"):
            resp = client.delete(path)
            assert resp.status_code in (401, 403), f"{path} -> {resp.status_code}"
    finally:
        app.state.ready = was_ready
