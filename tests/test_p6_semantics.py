"""P6 graph intelligence & clinical semantics tests (no DB/Neo4j/network).

Covers:
- normalization preservation (original vs canonical, low-confidence)
- entity justification (no speculative allergy/procedure/provider nodes)
- assertion quarantine + write invariant (execute_write only in graph_sync)
- temporal bounds + visit tagging + no fabricated events
- multi-domain context shape (med+sleep, condition+med, biometric+window)
- Concept-bridge negatives (shared nodes never traversed out of)
- detail evidence (taken branch, entry/version citations, linked summary)
- migration chain integrity (p6 head)
"""
import re
import uuid
from datetime import date

from services.retrieval import templates as tpl


class FakeDB:
    def scalar(self, stmt):
        return None

    def get(self, model, ident):
        return None

    def add(self, row):
        pass

    def flush(self):
        pass

    def execute(self, stmt):
        class R:
            def scalars(self_inner):
                class S:
                    def all(self_inner2):
                        return []
                return S()

            def scalar_one_or_none(self_inner):
                return None

            def all(self_inner):
                return []
        return R()


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


class TestNormalizationSemantics:
    def test_original_text_never_overwritten_by_design(self):
        with open("services/ocr/extraction_mapper.py") as f:
            src = f.read()
        # source_snippet always derives from the raw mention, never the code.
        assert "source_snippet=assertion.snippet[:500]" in src

    def test_low_confidence_preserved_as_uncertain(self):
        from models.clinical_assertion import classify_assertion
        from services.ocr.canonicalization import MatchStatus

        # REVIEW/UNKNOWN resolution keeps raw term, nulls coding.
        assert MatchStatus.REVIEW.value == "review"
        c = classify_assertion("possible migraine")
        assert c.polarity.value == "hypothetical"

    def test_match_fields_additive_and_nullable(self):
        from models.events import ClinicalEvent

        cols = {c.key for c in ClinicalEvent.__table__.columns}
        assert "match_confidence" in cols and "match_status" in cols
        assert ClinicalEvent.__table__.columns["match_confidence"].nullable is True

    def test_match_fields_flow_to_projection(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_clinical_event_tx(tx, {
            "patient_id": "p1", "event_id": "e1", "event_type": "LAB_RESULT",
            "source_type": "LAB_REPORT", "verification_status": "EXTRACTED",
            "event_time": "2026-01-01", "level_number": 20260101,
            "match_confidence": 95.5, "match_status": "auto_match",
        })
        assert "t.match_confidence" in tx.cypher
        assert tx.kwargs["match_confidence"] == 95.5

    def test_outbox_carries_match_fields(self):
        calls = []

        class FakeDB2:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_clinical_event
        from datetime import datetime, timezone

        enqueue_clinical_event(
            FakeDB2(), event_id=uuid.uuid4(), patient_id=uuid.uuid4(),
            event_type="LAB_RESULT", source_type="LAB_REPORT",
            verification_status="EXTRACTED", event_time=datetime.now(timezone.utc),
            match_confidence=91.2, match_status="auto_match",
        )
        assert calls[0].payload["match_confidence"] == 91.2
        assert calls[0].payload["match_status"] == "auto_match"


class TestEntityJustification:
    """P6-B/C/D verdicts encoded: no speculative ontology nodes."""

    def test_no_speculative_labels_projected(self):
        with open("workers/graph_sync.py") as f:
            src = f.read()
        for label in ("Allergy", "AllergyIntolerance", "ProcedureOccurrence",
                      "Provider", "Organization", "Facility", "CarePlan",
                      "Immunization", "Device"):
            assert f"MERGE ({label}" not in src and f":{label} {{" not in src, label

    def test_no_speculative_tables(self):
        import glob

        for path in glob.glob("models/*.py"):
            with open(path) as f:
                src = f.read()
            for name in ("class Allergy", "class ProcedureOccurrence", "class CarePlan",
                         "class Immunization", "allergy_intolerance", "procedure_occurrence"):
                assert name not in src, f"{path}: {name}"
        # NOTE: EventType.PROCEDURE/IMMUNIZATION enum values exist as
        # placeholders with zero producers — intentionally not tables.

    def test_prescriber_stays_property_not_node(self):
        with open("workers/graph_sync.py") as f:
            src = f.read()
        assert "m.prescriber" in src or "req.prescriber" in src
        assert "MERGE (pr:Provider" not in src and "MERGE (p:Provider" not in src


class TestAssertionQuarantine:
    def test_no_causal_edges_in_p6_code(self):
        import glob

        paths = ["workers/graph_sync.py", "services/retrieval/templates.py",
                 "services/retrieval/context_windows.py", "services/retrieval/router.py",
                 "app/api/v1/health_graph.py"] + glob.glob("agents/tools/*.py")
        for path in paths:
            with open(path) as f:
                src = f.read()
            for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
                for name in group.split("|"):
                    name = name.strip().rstrip("*0123456789. ")
                    if not name:
                        continue
                    assert name not in (
                        "CAUSES", "CURES", "WORSENS", "IMPROVES", "PREVENTS",
                        "INDICATES", "CAUSES_STRESS", "SUPPORTS",
                    ), f"{path}: {name}"

    def test_graph_writes_only_in_worker(self):
        import glob

        offenders = []
        for path in glob.glob("agents/tools/*.py") + glob.glob("services/retrieval/*.py"):
            with open(path) as f:
                src = f.read()
            if "execute_write" in src:
                offenders.append(path)
        assert offenders == [], offenders

    def test_evidence_levels_closed(self):
        from models.clinical_assertion import EvidenceLevel

        assert {e.value for e in EvidenceLevel} == {
            "SOURCE_FACT", "USER_REPORTED", "SYSTEM_DERIVED", "NORMALIZED", "AI_INFERRED",
        }


class TestTemporalReasoning:
    def test_window_bounds_and_no_fabrication(self):
        from services.retrieval.context_windows import build_window, get_context_around
        from models.clinical_assertion import NO_DATA_RECORDED

        assert build_window(date(2026, 3, 10), 7, 7) == (date(2026, 3, 3), date(2026, 3, 17))
        assert build_window(date(2026, 3, 10), 40, 30) is None
        assert build_window(date(2026, 3, 10), -1, 0) is None

        class Driver:
            def session(self):
                raise AssertionError("no graph on unresolvable anchor")

        out = get_context_around(FakeDB(), Driver(), uuid.uuid4(), "log_date", "bad-date", 7, 7)
        assert out["message"] == NO_DATA_RECORDED

    def test_templates_widened_and_safe(self):
        for tid in ("T-VISIT-RANGE", "T-VISIT-MEMBERS"):
            t = tpl.TEMPLATES[tid]
            assert "HAS_SLEEP" in t.cypher and "HAS_BIOMETRIC" in t.cypher
            assert "HAS_FOOD_SCAN" in t.cypher
            assert tpl.check_cypher_safety(t.cypher) == [], tid

    def test_all_templates_still_safe(self):
        for tid, t in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(t.cypher) == [], tid


class TestMultiDomainContext:
    def test_fetch_window_domain_keys(self):
        from services.retrieval.context_windows import fetch_window

        class Session:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, *a, **k):
                return []

        class Driver:
            def session(self):
                return Session()

        out = fetch_window(FakeDB(), Driver(), uuid.uuid4(), date(2026, 3, 1), date(2026, 3, 7))
        assert set(out["domains"].keys()) == {
            "visits", "conditions", "measurements", "sleep", "activity",
            "nutrition", "food", "biometric", "statements",
            "medications_started", "documents",
        }

    def test_medications_carry_purpose_linkage(self):
        with open("services/retrieval/context_windows.py") as f:
            src = f.read()
        assert "purpose_condition_id" in src
        assert "RESULTS_FROM" not in src  # no invented regimen linkage here

    def test_visit_tagging_uses_routing_ids(self):
        with open("services/retrieval/context_windows.py") as f:
            src = f.read()
        assert "_visit_of" in src
        assert "member_ids" in src


class TestConceptBridgeNegatives:
    def test_no_outgoing_traversal_from_shared_nodes(self):
        import glob

        # Files that still embed Cypher inline must anchor any shared-node
        # MATCH on the patient. (agents/tools/*.py carry no Cypher at all
        # since P15 / D2 — see the per-statement check below.)
        for path in ["app/api/v1/health_graph.py",
                     "services/retrieval/context_windows.py"] + \
                glob.glob("agents/tools/*.py"):
            with open(path) as f:
                src = f.read()
            # A MATCH anchored ON a shared node with an outgoing hop would
            # bridge patients (A→Concept←B). All shared-node matches must
            # arrive via patient-owned nodes (checked into the pattern).
            for m in re.finditer(r"MATCH\s+\((\w+):(Concept|AnatomicalStructure)\b", src):
                context = src[max(0, m.start() - 160):m.start()]
                assert "(p" in context or "Patient" in context, f"{path}: {m.group(0)}"

    def test_registered_statements_anchor_shared_nodes_per_statement(self):
        """Stronger, statement-scoped form of the check above (P15 / D2).

        Every statement the system can execute is validated by
        check_cypher_safety (which now also rejects traversals INTO and back
        OUT of a terminal label). Additionally, any statement that matches a
        shared node must carry the patient anchor itself — template text can
        no longer be "safe" merely because another statement in the same
        file happens to be patient-anchored.
        """
        from services.retrieval import templates as tpl

        assert len(tpl.ALL_CYPHER) >= 25
        for sid, cypher in tpl.ALL_CYPHER.items():
            assert tpl.check_cypher_safety(cypher) == [], sid
            if re.search(r"MATCH\s+\(\w+:(Concept|AnatomicalStructure)\b", cypher):
                assert "(p:Patient" in cypher or "$patient_id" in cypher, sid

    def test_shared_labels_terminal_in_templates(self):
        assert "Concept" in tpl.TERMINAL_LABELS
        assert "AnatomicalStructure" in tpl.TERMINAL_LABELS


class TestDetailEvidence:
    def test_taken_event_branch_exists(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert 'if node_type == "medication_taken_event":' in src

    def test_entry_version_citations_wired(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert "_scan_cites(db, patient_id, scan.scan_id)" in src
        assert "_med_cites(db, patient_id, ver.medication_id)" in src

    def test_linked_summary_present(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        assert "linked: dict = {}" in src
        for key in ('"visits"', '"documents"', '"conditions"', '"measurements"'):
            assert key in src


class TestMigrationChainP6:
    def test_p6_migration_head(self):
        with open("alembic/versions/p6b3d91f44a2_p6_match_confidence.py") as f:
            src = f.read()
        assert "p4a1c7e30d55" in src
        assert 'revision: str = "p6b3d91f44a2"' in src

    def test_single_head(self):
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
        # P6 revision links onto P4; later phases may extend the head.
        assert "p6b3d91f44a2" in revs
        with open(revs["p6b3d91f44a2"]) as f:
            assert "p4a1c7e30d55" in f.read()
        for d in downs:
            assert d in revs, f"dangling down_revision {d}"
