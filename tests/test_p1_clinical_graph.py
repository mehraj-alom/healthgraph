"""P1 clinical graph expansion tests (no DB, no Neo4j, no network).

Covers:
- visit determinism (one row per patient/date/type)
- condition find-or-create + assertion classification
- medication purpose split (prescribed vs patient-stated vs absent)
- projection dual-write + new edges (fake tx) + old-payload compat
- idempotent MERGE behavior (reprojection is a no-op structurally)
- traversal safety for all P1 paths + negative patient-isolation checks
- no causal/inferred edges anywhere in new code
"""
import re
import uuid
from datetime import date, datetime, timezone

from services.retrieval import templates as tpl


class FakeDB:
    """Minimal session double: scalar/get/add/flush/execute."""

    def __init__(self):
        self.rows = []
        self.by_id = {}

    def scalar(self, stmt):
        return None

    def get(self, model, ident):
        return self.by_id.get(str(ident))

    def add(self, row):
        self.rows.append(row)
        for attr in ("condition_id", "visit_id", "statement_id"):
            if hasattr(row, attr) and getattr(row, attr) is not None:
                self.by_id[str(getattr(row, attr))] = row

    def flush(self):
        pass

    def refresh(self, row):
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
        return R()


def _medication(**over):
    from models.medications import Medication, MedicationFrequency, MedicationStatus

    med = Medication(
        medication_id=uuid.uuid4(),
        patient_id=uuid.uuid4(),
        name=over.get("name", "Lisinopril"),
        frequency=MedicationFrequency.ONCE_DAILY,
        status=MedicationStatus.ACTIVE,
    )
    med.purpose = over.get("purpose")
    med.source_document_id = over.get("source_document_id")
    med.start_date = over.get("start_date")
    return med


class TestVisitDeterminism:
    def test_same_day_same_type_returns_same_visit(self):
        from services.clinical.occurrences import get_or_create_visit

        db = FakeDB()
        pid = uuid.uuid4()
        day = date(2026, 3, 1)
        v1 = get_or_create_visit(db, pid, day, "document", source="d1", enqueue=False)
        # Simulate persistence: second call sees the stored row.
        db.by_id.clear()

        class DB2(FakeDB):
            def scalar(self_inner, stmt):
                return v1

        v2 = get_or_create_visit(DB2(), pid, day, "document", source="d1", enqueue=False)
        assert v2.visit_id == v1.visit_id
        assert v2.visit_date == day

    def test_visit_enqueue_row_uses_merge_key(self):
        from services.clinical.occurrences import get_or_create_visit
        from models.outbox import OutboxEventType

        db = FakeDB()
        v = get_or_create_visit(db, uuid.uuid4(), date(2026, 3, 1), "daily-checkin", enqueue=True)
        outbox_rows = [r for r in db.rows if hasattr(r, "event_type")]
        assert len(outbox_rows) == 1
        assert outbox_rows[0].event_type == OutboxEventType.VISIT_RECORDED
        assert outbox_rows[0].payload["visit_id"] == str(v.visit_id)


class TestPurposeSplit:
    def test_prescribed_purpose_creates_condition_not_statement(self):
        from services.clinical.occurrences import sync_medication_graph_context
        from models.conditions import ConditionOccurrence
        from models.statements import PatientStatement

        db = FakeDB()
        med = _medication(purpose="hypertension", source_document_id=uuid.uuid4())
        ctx = sync_medication_graph_context(db, med)
        assert ctx["condition_id"] is not None
        assert ctx["statement_id"] is None
        assert med.purpose_condition_id == ctx["condition_id"]
        assert med.reason_statement_id is None
        conds = [r for r in db.rows if isinstance(r, ConditionOccurrence)]
        assert len(conds) == 1
        assert conds[0].source_type == "DOCTOR_ENTERED"
        assert not [r for r in db.rows if isinstance(r, PatientStatement)]

    def test_patient_stated_reason_creates_condition_and_verbatim_statement(self):
        from services.clinical.occurrences import sync_medication_graph_context
        from models.conditions import ConditionOccurrence
        from models.statements import PatientStatement

        db = FakeDB()
        med = _medication(purpose="headaches")
        ctx = sync_medication_graph_context(db, med)
        assert ctx["condition_id"] is not None
        assert ctx["statement_id"] is not None
        stmts = [r for r in db.rows if isinstance(r, PatientStatement)]
        assert len(stmts) == 1
        # Verbatim purpose text — never rephrased into first person.
        assert stmts[0].original_text == "headaches"
        assert stmts[0].about_condition_id == ctx["condition_id"]
        assert stmts[0].speaker == "patient"
        conds = [r for r in db.rows if isinstance(r, ConditionOccurrence)]
        assert conds[0].source_type == "PATIENT_REPORTED"

    def test_absent_purpose_creates_nothing(self):
        from services.clinical.occurrences import sync_medication_graph_context

        db = FakeDB()
        med = _medication(purpose=None)
        assert sync_medication_graph_context(db, med) == {"condition_id": None, "statement_id": None}
        assert db.rows == []

    def test_negated_purpose_never_authoritative(self):
        from services.clinical.occurrences import sync_medication_graph_context
        from models.conditions import ConditionOccurrence
        from models.clinical_assertion import is_authoritative_positive, classify_assertion

        db = FakeDB()
        med = _medication(purpose="no longer have hypertension")
        ctx = sync_medication_graph_context(db, med)
        conds = [r for r in db.rows if isinstance(r, ConditionOccurrence)]
        assert len(conds) == 1
        assert conds[0].polarity == "historical"
        assert not is_authoritative_positive(classify_assertion(conds[0].evidence_text))

    def test_purpose_change_relinks_without_rewriting_history(self):
        from services.clinical.occurrences import sync_medication_graph_context
        from models.conditions import ConditionOccurrence

        db = FakeDB()
        med = _medication(purpose="headaches")
        first = sync_medication_graph_context(db, med)
        med.purpose = "migraine"
        second = sync_medication_graph_context(db, med)
        assert second["condition_id"] != first["condition_id"]
        # Old condition row is kept (history never rewritten).
        assert len([r for r in db.rows if isinstance(r, ConditionOccurrence)]) == 2


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


def _med_payload(**over):
    base = {
        "patient_id": "p1", "medication_id": "m1", "name": "Lisinopril",
        "generic_name": "lisinopril", "brand_name": None, "strength": "10",
        "strength_unit": "mg", "dose_amount": 10.0, "dose_unit": "mg",
        "route": "ORAL", "frequency": "ONCE_DAILY", "scheduled_times": ["08:00"],
        "start_date": "2026-03-01", "end_date": None, "status": "ACTIVE",
        "purpose": "hypertension", "instructions": None, "prescriber": "Dr. A",
        "prn": False, "reminder_enabled": False, "notes": None,
    }
    base.update(over)
    return base


class TestProjections:
    def test_medication_dual_write_and_request_split(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_tx(tx, _med_payload())
        assert "ACTIVE_MEDICATION" in tx.cypher  # legacy preserved
        assert "HAS_MEDICATION_REQUEST" in tx.cypher
        assert "PRESCRIBES" in tx.cypher
        assert "norm_key" in tx.cypher
        assert tx.kwargs["norm_key"] == "lisinopril"

    def test_medication_purpose_edges_only_with_evidence(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_tx(
            tx, _med_payload(purpose_condition_id="c1", purpose_condition_name="hypertension",
                             reason_statement_id="s1", source_document_id="d1")
        )
        assert "PRESCRIBED_FOR" in tx.cypher
        assert "REASON_STATED_BY_PATIENT" in tx.cypher
        assert "DOCUMENTED_IN" in tx.cypher

    def test_medication_legacy_payload_compat(self):
        from workers import graph_sync

        payload = _med_payload()
        for key in ("purpose_condition_id", "reason_statement_id", "source_document_id"):
            payload.pop(key, None)
        payload.pop("purpose_condition_name", None)
        tx = _FakeTx()
        graph_sync._project_medication_tx(tx, payload)  # must not raise
        assert "PRESCRIBED_FOR" not in tx.cypher
        assert "REASON_STATED_BY_PATIENT" not in tx.cypher
        assert "HAS_MEDICATION_REQUEST" in tx.cypher  # split still applies

    def test_taken_results_from_and_visit(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_taken_tx(tx, {
            "patient_id": "p1", "event_id": "e1", "medication_id": "m1",
            "taken_at": "2026-03-02", "scheduled_for": None, "dose_taken": 1.0,
            "dose_unit": "tablet", "status": "TAKEN", "notes": None, "visit_id": "v1",
        })
        assert "TAKEN_FROM" in tx.cypher  # legacy preserved
        assert "RESULTS_FROM" in tx.cypher
        assert "OCCURRED_DURING" in tx.cypher

    def test_condition_projection(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_condition_tx(tx, {
            "patient_id": "p1", "condition_id": "c1", "name": "Hypertension",
            "normalized_name": "hypertension", "polarity": "positive",
            "document_id": "d1", "visit_id": "v1", "evidence_text": "HTN",
        })
        assert "HAS_CONDITION" in tx.cypher
        assert "DOCUMENTED_IN" in tx.cypher
        assert "OCCURRED_DURING" in tx.cypher
        assert "c.polarity" in tx.cypher

    def test_condition_requires_identity_keys(self):
        from workers import graph_sync

        tx = _FakeTx()
        with __import__("pytest").raises(Exception):
            graph_sync._project_condition_tx(tx, {"patient_id": "p1"})

    def test_visit_projection(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_visit_tx(tx, {
            "patient_id": "p1", "visit_id": "v1", "visit_date": "2026-03-01", "visit_type": "document",
        })
        assert "HAS_VISIT" in tx.cypher

    def test_statement_projection_with_about(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_statement_tx(tx, {
            "patient_id": "p1", "statement_id": "s1", "original_text": "headaches",
            "about_condition_id": "c1",
        })
        assert "HAS_STATEMENT" in tx.cypher
        assert "ABOUT" in tx.cypher
        assert "PRESCRIBED_FOR" not in tx.cypher  # statements never diagnose

    def test_observation_and_clinical_visit_edges_backward_compatible(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_observation_tx(tx, {
            "patient_id": "p1", "observation_id": "o1", "structure_id": "HEART",
            "finding_code": "X", "visual_severity_score": 0.0, "recorded_at": "2026-01-01",
            "source_type": "LAB_REPORT", "level_number": 20260101,
        })
        assert "OCCURRED_DURING" not in tx.cypher  # pre-P1 row: no visit
        tx2 = _FakeTx()
        graph_sync._project_clinical_event_tx(tx2, {
            "patient_id": "p1", "event_id": "e1", "event_type": "LAB_RESULT",
            "source_type": "LAB_REPORT", "verification_status": "EXTRACTED",
            "event_time": "2026-01-01", "level_number": 20260101, "visit_id": "v9",
        })
        assert "OCCURRED_DURING" in tx2.cypher


class TestTraversalSafetyP1:
    def test_new_templates_safe(self):
        for tid in ("T-COND-CTX", "T-VISIT-MEMBERS", "T-MED-REQUEST"):
            t = tpl.TEMPLATES[tid]
            assert tpl.check_cypher_safety(t.cypher) == [], (tid, tpl.check_cypher_safety(t.cypher))

    def test_all_templates_still_safe(self):
        for tid, t in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(t.cypher) == [], tid

    def test_p1_rels_allow_listed(self):
        for rel in ("HAS_CONDITION", "HAS_VISIT", "HAS_STATEMENT", "HAS_MEDICATION_REQUEST",
                    "PRESCRIBES", "PRESCRIBED_FOR", "REASON_STATED_BY_PATIENT",
                    "ABOUT", "RESULTS_FROM", "OCCURRED_DURING"):
            assert rel in tpl.ALLOWED_TRAVERSAL_RELS, rel

    def test_no_causal_edges_in_new_code(self):
        import glob

        checked = 0
        for path in ["workers/graph_sync.py", "services/retrieval/templates.py",
                     "services/clinical/occurrences.py"] + glob.glob("agents/tools/*.py"):
            with open(path) as f:
                src = f.read()
            for group in re.findall(r"\[\s*:([A-Z_|* ]+)\]", src):
                for name in group.split("|"):
                    name = name.strip().rstrip("*0123456789. ")
                    if not name:
                        continue
                    assert name not in (
                        "CAUSES", "TREATS", "CURES", "PREVENTS", "IMPROVES", "WORSENS",
                        "EXACERBATES", "ASSOCIATED_WITH", "MAY_CONTRIBUTE_TO",
                        "CORRELATED_WITH", "SUPPORTS", "MANIFESTATION_OF",
                    ), f"{path}: {name}"
                    checked += 1
        assert checked > 0

    def test_p1_health_graph_blocks_carry_patient_binding(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        # Every P1 OPTIONAL MATCH that creates edges is guarded by a
        # patient-owned pattern on the same match.
        for guard in ("(p)-[:HAS_MEDICATION_REQUEST]->(req3)",
                      "(p)-[:HAS_CONDITION]->(cond3)",
                      "(p)-[:HAS_STATEMENT]->(st3)",
                      "(p)-[:HAS_VISIT]->(vv3)"):
            assert guard in src, guard

    def test_new_node_types_mapped(self):
        from app.api.v1.health_graph import NODE_TYPE_MAP

        assert NODE_TYPE_MAP["MedicationRequest"] == "medication_request"
        assert NODE_TYPE_MAP["ConditionOccurrence"] == "condition_occurrence"
        assert NODE_TYPE_MAP["Visit"] == "visit"
        assert NODE_TYPE_MAP["PatientStatement"] == "patient_statement"

    def test_canonical_medication_node_id(self):
        from app.api.v1.health_graph import _node_from_raw

        class Raw(dict):
            labels = {"Medication"}

        node = _node_from_raw(Raw({"norm_key": "lisinopril", "display_name": "Lisinopril"}))
        assert node.id == "medication_canonical:lisinopril"

    def test_statement_label_truncation(self):
        from app.api.v1.health_graph import _node_from_raw

        class Raw(dict):
            labels = {"PatientStatement"}

        node = _node_from_raw(Raw({"id": "s1", "original_text": "x" * 100}))
        assert len(node.label) <= 61


class TestOutboxCompat:
    def test_new_event_types_present(self):
        from models.outbox import OutboxEventType

        assert OutboxEventType.CONDITION_RECORDED.value == "condition_recorded"
        assert OutboxEventType.VISIT_RECORDED.value == "visit_recorded"
        assert OutboxEventType.STATEMENT_RECORDED.value == "statement_recorded"

    def test_medication_enqueue_p1_keys_optional(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_medication
        import uuid as _uuid

        enqueue_medication(
            FakeDB(), medication_id=_uuid.uuid4(), patient_id=_uuid.uuid4(), name="X",
        )
        assert "purpose_condition_id" not in calls[0].payload
        enqueue_medication(
            FakeDB(), medication_id=_uuid.uuid4(), patient_id=_uuid.uuid4(), name="X",
            purpose_condition_id=_uuid.uuid4(), reason_statement_id=_uuid.uuid4(),
        )
        assert "purpose_condition_id" in calls[1].payload
