"""P0 graph foundation regression tests (no DB, no Neo4j, no network).

Covers:
- assertion classifier (negation / family / hypothetical / historical /
  conditional / positive) + authoritative-positive gate
- evidence badges, quote truncation, no-data payloads
- traversal template safety (every registered template + static scan of
  app/api/v1/health_graph.py and agents/tools Cypher against the allow-list)
- Concept-lite flag default-off + HAS_CODE projection gating (fake tx)
- outbox payload backward compatibility (old rows project unchanged)
- privacy audit helper + chat citation schemas
"""
import re

import pytest

from models.clinical_assertion import (
    AssertionVerification,
    ClinicalStatus,
    EvidenceLevel,
    Experiencer,
    Polarity,
    classify_assertion,
    is_authoritative_positive,
)
from services.retrieval import evidence as ev
from services.retrieval import templates as tpl


class TestAssertionClassifier:
    def test_negated_condition(self):
        c = classify_assertion("No diabetes noted.")
        assert c.polarity == Polarity.NEGATIVE
        assert c.verification == AssertionVerification.REFUTED
        assert c.experiencer == Experiencer.PATIENT
        assert not is_authoritative_positive(c)

    def test_denies_symptom(self):
        c = classify_assertion("Patient denies chest pain.")
        assert c.polarity == Polarity.NEGATIVE
        assert not is_authoritative_positive(c)

    def test_family_history(self):
        c = classify_assertion("Family history of diabetes, mother affected.")
        assert c.experiencer == Experiencer.FAMILY
        assert c.polarity == Polarity.HISTORICAL
        assert not is_authoritative_positive(c)

    def test_rule_out_is_hypothetical_not_negative(self):
        c = classify_assertion("Rule out pneumonia, start workup.")
        assert c.polarity == Polarity.HYPOTHETICAL
        assert c.verification == AssertionVerification.PROVISIONAL
        assert not is_authoritative_positive(c)

    def test_possible_infection(self):
        c = classify_assertion("Possible infection, likely viral.")
        assert c.polarity == Polarity.HYPOTHETICAL
        assert not is_authoritative_positive(c)

    def test_historical_condition(self):
        c = classify_assertion("History of hypertension, currently controlled.")
        assert c.polarity == Polarity.HISTORICAL
        assert not is_authoritative_positive(c)

    def test_discontinued_medication(self):
        c = classify_assertion("Lisinopril discontinued due to cough.")
        assert c.polarity == Polarity.HISTORICAL
        assert not is_authoritative_positive(c)

    def test_conditional_prn(self):
        c = classify_assertion("Take ibuprofen if needed for headache.")
        assert c.polarity == Polarity.CONDITIONAL
        assert not is_authoritative_positive(c)

    def test_positive_default(self):
        c = classify_assertion("Blood pressure 138/88 mmHg.")
        assert c.polarity == Polarity.POSITIVE
        assert c.experiencer == Experiencer.PATIENT
        assert is_authoritative_positive(c)

    def test_empty_text_is_positive_unconfirmed(self):
        c = classify_assertion("")
        assert c.polarity == Polarity.POSITIVE
        assert c.verification == AssertionVerification.UNCONFIRMED

    def test_provisional_not_authoritative(self):
        c = classify_assertion("Suspected migraine.")
        assert not is_authoritative_positive(c)


class TestEvidenceModel:
    def test_human_verified_badge(self):
        assert ev.badge_for("LAB_REPORT", "HUMAN_VERIFIED") == ev.EvidenceBadge.CONFIRMED_SOURCE_STATED

    def test_patient_reported_badge(self):
        assert ev.badge_for("PATIENT_REPORTED", "UNVERIFIED") == ev.EvidenceBadge.USER_REPORTED

    def test_ai_inferred_never_confirmed(self):
        assert ev.badge_for("AI_INFERRED", "UNVERIFIED") != ev.EvidenceBadge.CONFIRMED_SOURCE_STATED

    def test_truncate(self):
        assert ev.truncate_quote("  abc  ") == "abc"
        assert ev.truncate_quote(None) is None
        long = "x" * 500
        assert len(ev.truncate_quote(long)) <= 301

    def test_no_data_payload(self):
        p = ev.no_data_result()
        assert p["citations"] == []
        assert "recorded data" in p["message"]

    def test_evidence_levels_closed(self):
        assert {e.value for e in EvidenceLevel} == {
            "SOURCE_FACT", "USER_REPORTED", "SYSTEM_DERIVED", "NORMALIZED", "AI_INFERRED",
        }


class TestTraversalSafety:
    def test_all_registered_templates_safe(self):
        for tid, t in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(t.cypher) == [], f"{tid}: {tpl.check_cypher_safety(t.cypher)}"

    def test_allow_list_covers_legacy_rels(self):
        for rel in ("HAS_OBSERVATION", "HAS_TIMELINE_EVENT", "ACTIVE_MEDICATION",
                    "HAS_MEDICATION_TAKEN", "AFFECTS", "SOURCE_DOCUMENT",
                    "LOGGED_ON", "TAKEN_FROM", "CONTAINS"):
            assert rel in tpl.ALLOWED_TRAVERSAL_RELS

    def test_p0_rels_allow_listed(self):
        assert "DOCUMENTED_IN" in tpl.ALLOWED_TRAVERSAL_RELS
        assert "HAS_CODE" in tpl.ALLOWED_TRAVERSAL_RELS

    def test_causal_rels_not_allow_listed(self):
        for rel in ("CAUSES", "TREATS", "ASSOCIATED_WITH", "MAY_CONTRIBUTE_TO",
                    "CORRELATED_WITH", "IMPROVES", "WORSENS"):
            assert rel not in tpl.ALLOWED_TRAVERSAL_RELS

    def test_shared_labels_terminal(self):
        assert "AnatomicalStructure" in tpl.TERMINAL_LABELS
        assert "Concept" in tpl.TERMINAL_LABELS
        assert "Patient" not in tpl.TERMINAL_LABELS

    def test_health_graph_source_uses_only_allow_listed_rels(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        found: set[str] = set()
        for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
            for name in group.split("|"):
                name = name.strip().rstrip("*0123456789. ")
                if name:
                    found.add(name)
        assert found, "expected Cypher rel types in health_graph.py"
        assert found <= tpl.ALLOWED_TRAVERSAL_RELS, f"non-allow-listed: {found - tpl.ALLOWED_TRAVERSAL_RELS}"

    def test_agent_tool_queries_use_only_allow_listed_rels(self):
        import glob

        checked = 0
        for path in glob.glob("agents/tools/*.py"):
            with open(path) as f:
                src = f.read()
            for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
                for name in group.split("|"):
                    name = name.strip().rstrip("*0123456789. ")
                    if name:
                        assert name in tpl.ALLOWED_TRAVERSAL_RELS, f"{path}: {name}"
                        checked += 1
        assert checked > 0, "expected Cypher in agents/tools"

    def test_timeline_hop_carries_patient_binding(self):
        # P15 / D2: the statement moved into the template registry (tools now
        # execute it through run_patient_cypher). The P0 invariant is
        # unchanged: the LOGGED_ON hop must be bound to the patient's OWN
        # observations, and the tool must not keep an unbound copy.
        assert "(p)-[:HAS_OBSERVATION]->(o:Observation)-[:LOGGED_ON]->(t)" in tpl.CYPHER_TIMELINE
        import ast

        with open("agents/tools/timeline.py") as f:
            src = f.read()
        # The tool must not carry any Cypher of its own (the historical
        # unbound pattern may survive only as the explanatory P0 comment, so
        # this checks string literals, not raw text).
        literals = [
            n.value
            for n in ast.walk(ast.parse(src))
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
        ]
        assert not any("LOGGED_ON" in s for s in literals)
        assert "CYPHER_TIMELINE" in src


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


def _obs_payload(**over):
    base = {
        "patient_id": "p1", "observation_id": "o1", "structure_id": "HEART",
        "finding_code": "X", "visual_severity_score": 0.0,
        "recorded_at": "2026-01-01", "source_type": "LAB_REPORT", "level_number": 20260101,
    }
    base.update(over)
    return base


def _clinical_payload(**over):
    base = {
        "patient_id": "p1", "event_id": "e1", "event_type": "LAB_RESULT",
        "source_type": "LAB_REPORT", "verification_status": "EXTRACTED",
        "event_time": "2026-01-01", "level_number": 20260101,
    }
    base.update(over)
    return base


class TestGraphProjection:
    def test_concept_edges_default_off(self, monkeypatch):
        monkeypatch.delenv("GRAPH_CONCEPT_EDGES_ENABLED", raising=False)
        from workers import graph_sync

        # settings default is False; env unset -> off
        assert graph_sync._concept_edges_enabled() is False

    def test_observation_projection_dual_write_and_assertion(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_observation_tx(tx, _obs_payload(document_id="d1"))
        assert "SOURCE_DOCUMENT" in tx.cypher  # legacy read-compat
        assert "DOCUMENTED_IN" in tx.cypher  # P0 canonical
        assert "o.polarity" in tx.cypher
        assert tx.kwargs["polarity"] == "positive"  # default for pre-P0 rows
        assert tx.kwargs["experiencer"] == "patient"

    def test_observation_without_document_has_no_doc_branch(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_observation_tx(tx, _obs_payload())
        assert "Document" not in tx.cypher

    def test_clinical_projection_backward_compatible(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_clinical_event_tx(tx, _clinical_payload())
        assert "t.polarity" in tx.cypher
        assert "HAS_CODE" not in tx.cypher  # flag off, no concept keys
        assert tx.kwargs["polarity"] == "positive"

    def test_clinical_projection_concept_gated_on(self, monkeypatch):
        from workers import graph_sync

        monkeypatch.setenv("GRAPH_CONCEPT_EDGES_ENABLED", "true")
        tx = _FakeTx()
        graph_sync._project_clinical_event_tx(
            tx, _clinical_payload(concept_system="LOINC", concept_code="1234-5", concept_display="X")
        )
        assert "HAS_CODE" in tx.cypher
        assert ":Concept" in tx.cypher

    def test_clinical_projection_concept_needs_code(self, monkeypatch):
        from workers import graph_sync

        monkeypatch.setenv("GRAPH_CONCEPT_EDGES_ENABLED", "true")
        tx = _FakeTx()
        graph_sync._project_clinical_event_tx(tx, _clinical_payload(concept_system="LOINC"))
        assert "HAS_CODE" not in tx.cypher


class TestOutboxPayload:
    def test_optional_keys_present_when_supplied(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_clinical_event
        import uuid as _uuid
        from datetime import datetime, timezone

        db = FakeDB()
        enqueue_clinical_event(
            db, event_id=_uuid.uuid4(), patient_id=_uuid.uuid4(),
            event_type="LAB_RESULT", source_type="LAB_REPORT",
            verification_status="EXTRACTED", event_time=datetime.now(timezone.utc),
            polarity="negative", experiencer="patient", document_id="d1",
            evidence_text="No diabetes", concept_system="SNOMED", concept_code="123",
        )
        payload = calls[0].payload
        assert payload["polarity"] == "negative"
        assert payload["document_id"] == "d1"
        assert payload["evidence_text"] == "No diabetes"
        assert payload["concept_code"] == "123"

    def test_optional_keys_absent_for_legacy_callers(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_clinical_event
        import uuid as _uuid
        from datetime import datetime, timezone

        db = FakeDB()
        enqueue_clinical_event(
            db, event_id=_uuid.uuid4(), patient_id=_uuid.uuid4(),
            event_type="LAB_RESULT", source_type="LAB_REPORT",
            verification_status="EXTRACTED", event_time=datetime.now(timezone.utc),
        )
        payload = calls[0].payload
        assert "polarity" not in payload
        assert "concept_code" not in payload
        assert payload["event_type"] == "LAB_RESULT"


class TestPrivacyAndChatSchemas:
    def test_audit_helper_inserts_without_db(self):
        rows = []

        class FakeDB:
            def add(self, row):
                rows.append(row)

        from models.privacy import log_audit
        import uuid as _uuid

        db = FakeDB()
        log_audit(db, action="consent_captured", patient_id=_uuid.uuid4(), entity_type="consent")
        assert len(rows) == 1
        assert rows[0].action == "consent_captured"
        assert rows[0].meta == {}

    def test_privacy_tables_registered(self):
        from models.privacy import AuditEvent, ConsentReceipt, DataSubjectRequest

        assert ConsentReceipt.__tablename__ == "consent_receipts"
        assert DataSubjectRequest.__tablename__ == "data_subject_requests"
        assert AuditEvent.__tablename__ == "audit_events"

    def test_chat_citation_schemas(self):
        from schemas.chat import AgentStructuredOutput, ChatResponse
        import uuid as _uuid

        out = AgentStructuredOutput(response_text="hi", citations=[{"document_id": "d1", "quote": "x"}])
        assert out.citations[0].document_id == "d1"
        resp = ChatResponse(conversation_id=_uuid.uuid4(), response_text="hi", ui_actions=[], citations=[])
        assert resp.citations == []

    def test_node_detail_payload_schema(self):
        from app.api.v1.health_graph import GraphNodeDetailResponse, NodeDetailPayload

        r = GraphNodeDetailResponse(
            node={"id": "observation:1", "type": "observation", "label": "X"},
            connected_nodes=[],
            connected_edges=[],
            detail=NodeDetailPayload(summary="s", citations=[{"quote": "q"}]),
        )
        assert r.detail.summary == "s"
        assert r.detail.citations[0].quote == "q"
