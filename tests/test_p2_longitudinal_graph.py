"""P2 measurement split + regimen version history tests (no DB/Neo4j/network).

Covers:
- numeric/range parsing + interpretation derivation
- measurement creation helpers (lab + vital) + outbox payloads
- regimen snapshotting + version chains + supersedes linkage
- measurement/version projections (fake tx) + old-payload compat
- idempotent MERGE shape + required-key validation
- traversal safety for P2 templates + patient isolation
- static WITH-scope validation of the main graph query (every carried
  variable must be bound — regression guard for the P1 canon_meds bug)
- legacy relationship compatibility (nothing retired in P2)
- migration chain integrity
"""
import re
import uuid
from datetime import datetime, timezone

from services.retrieval import templates as tpl


class FakeQuery:
    def __init__(self, first_result=None):
        self._first = first_result

    def filter(self, *args, **kwargs):
        return self

    def first(self):
        return self._first


class FakeDB:
    def __init__(self, query_first=None):
        self.rows = []
        self.by_id = {}
        self._query_first = query_first

    def scalar(self, stmt):
        return None

    def get(self, model, ident):
        return self.by_id.get(str(ident))

    def add(self, row):
        self.rows.append(row)
        for attr in ("condition_id", "visit_id", "statement_id", "measurement_id", "version_id"):
            if hasattr(row, attr) and getattr(row, attr) is not None:
                self.by_id[str(getattr(row, attr))] = row

    def flush(self):
        pass

    def query(self, model):
        return FakeQuery(self._query_first)

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


class TestMeasurementParsing:
    def test_parse_number(self):
        from services.clinical.measurements import parse_number

        assert parse_number("138/88") == 138.0
        assert parse_number("5.6 mmol/L") == 5.6
        assert parse_number("1,200") == 1200.0
        assert parse_number("negative") is None
        assert parse_number(None) is None
        assert parse_number("") is None

    def test_parse_range(self):
        from services.clinical.measurements import parse_range

        assert parse_range("70 - 100") == (70.0, 100.0)
        assert parse_range("3.5–5.5") == (3.5, 5.5)
        assert parse_range("negative") == (None, None)
        assert parse_range(None) == (None, None)

    def test_interpretation_flag_first(self):
        from services.clinical.measurements import derive_interpretation

        assert derive_interpretation(50.0, "H", 70.0, 100.0) == "above_range"
        assert derive_interpretation(200.0, "L", 70.0, 100.0) == "below_range"
        assert derive_interpretation(80.0, "CRITICAL", 70.0, 100.0) == "critical"

    def test_interpretation_range_comparison(self):
        from services.clinical.measurements import derive_interpretation

        assert derive_interpretation(120.0, None, 70.0, 100.0) == "above_range"
        assert derive_interpretation(60.0, None, 70.0, 100.0) == "below_range"
        assert derive_interpretation(80.0, None, 70.0, 100.0) == "within_range"
        assert derive_interpretation(None, None, 70.0, 100.0) == "unknown"
        assert derive_interpretation(80.0, None, None, None) == "unknown"

    def test_series_key(self):
        from services.clinical.measurements import series_key_for

        assert series_key_for("LOINC", "1234-5", "Whatever") == "LOINC|1234-5"
        assert series_key_for(None, None, "Blood Pressure") == "blood pressure"


class TestMeasurementCreation:
    def test_lab_measurement_row_and_outbox(self):
        from services.clinical.measurements import create_lab_measurement
        from models.measurements import Measurement
        from models.outbox import OutboxEventType

        db = FakeDB()
        m = create_lab_measurement(
            db, patient_id=uuid.uuid4(), name="Glucose", value="110", unit="mg/dL",
            ref_range="70 - 100", abnormal_flag="H", terminology="LOINC", code="2345-7",
            display_name="Glucose", measured_at=datetime.now(timezone.utc),
            source_event_id=uuid.uuid4(), source_document_id=uuid.uuid4(),
            evidence_text="Glucose 110 H", visit_id=uuid.uuid4(),
        )
        assert isinstance(m, Measurement)
        assert m.value_number == 110.0
        assert (m.range_low, m.range_high) == (70.0, 100.0)
        assert m.interpretation == "above_range"
        assert m.series_key == "LOINC|2345-7"
        outbox = [r for r in db.rows if hasattr(r, "event_type")]
        assert len(outbox) == 1
        assert outbox[0].event_type == OutboxEventType.MEASUREMENT_RECORDED
        assert outbox[0].payload["visit_id"] is not None
        assert outbox[0].payload["abnormal_flag"] == "H"

    def test_vital_measurement_user_reported(self):
        from services.clinical.measurements import create_vital_measurement
        from models.measurements import Measurement

        db = FakeDB()
        m = create_vital_measurement(
            db, patient_id=uuid.uuid4(), name="Weight", concept_display="Body Weight",
            value_number=72.5, value_text="72.5", unit="kg",
            source_event_id=uuid.uuid4(), visit_id=uuid.uuid4(),
        )
        assert m.source_type == "PATIENT_REPORTED"
        assert m.verification_status == "HUMAN_VERIFIED"
        assert m.interpretation == "unknown"  # never guessed without range/flag
        assert m.polarity == "positive" and m.experiencer == "patient"


class TestVersioning:
    def _medication(self):
        from models.medications import Medication, MedicationFrequency, MedicationStatus

        return Medication(
            medication_id=uuid.uuid4(), patient_id=uuid.uuid4(), name="Lisinopril",
            dose_amount=10.0, dose_unit="mg", frequency=MedicationFrequency.ONCE_DAILY,
            status=MedicationStatus.ACTIVE,
        )

    def test_snapshot_before_mutation(self):
        from services.clinical.versions import snapshot_before_mutation
        from models.medication_versions import MedicationVersion
        from models.outbox import OutboxEventType

        db = FakeDB()
        med = self._medication()
        ver = snapshot_before_mutation(db, med, change_reason="update")
        assert isinstance(ver, MedicationVersion)
        assert ver.version_number == 1
        assert ver.snapshot["dose_amount"] == 10.0
        assert ver.snapshot["name"] == "Lisinopril"
        assert med.version_number == 2
        outbox = [r for r in db.rows if hasattr(r, "event_type")]
        assert len(outbox) == 1
        assert outbox[0].event_type == OutboxEventType.MEDICATION_VERSION_RECORDED
        assert outbox[0].payload["version_number"] == 1
        assert "supersedes_version_id" not in outbox[0].payload

    def test_second_mutation_links_supersedes(self):
        from services.clinical.versions import snapshot_before_mutation

        db = FakeDB()
        med = self._medication()
        v1 = snapshot_before_mutation(db, med)
        med.dose_amount = 20.0
        db._query_first = v1  # previous version row exists
        v2 = snapshot_before_mutation(db, med, change_reason="dose increase")
        assert v2.version_number == 2
        assert v2.snapshot["dose_amount"] == 20.0
        outbox = [r for r in db.rows if hasattr(r, "event_type")]
        assert outbox[-1].payload["supersedes_version_id"] == str(v1.version_id)

    def test_history_never_rewritten(self):
        from services.clinical.versions import snapshot_before_mutation
        from models.medication_versions import MedicationVersion

        db = FakeDB()
        med = self._medication()
        snapshot_before_mutation(db, med)
        med.dose_amount = 20.0
        snapshot_before_mutation(db, med)
        versions = [r for r in db.rows if isinstance(r, MedicationVersion)]
        assert [v.snapshot["dose_amount"] for v in versions] == [10.0, 20.0]


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


def _measure_payload(**over):
    base = {
        "patient_id": "p1", "measurement_id": "m1", "name": "Glucose",
        "series_key": "LOINC|2345-7", "value_number": 110.0, "value_text": "110",
        "unit": "mg/dL", "interpretation": "above_range", "measured_at": "2026-03-10",
    }
    base.update(over)
    return base


class TestP2Projections:
    def test_measurement_full_projection(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_measurement_tx(tx, _measure_payload(
            document_id="d1", visit_id="v1", terminology="LOINC", code="2345-7"))
        assert "HAS_MEASUREMENT" in tx.cypher
        assert "DOCUMENTED_IN" in tx.cypher
        assert "OCCURRED_DURING" in tx.cypher
        assert "m.interpretation" in tx.cypher
        assert "m.abnormal_flag" in tx.cypher

    def test_measurement_minimal_payload_compat(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_measurement_tx(tx, _measure_payload())  # must not raise
        assert "HAS_CODE" not in tx.cypher  # flag-gated, no code
        assert "OCCURRED_DURING" not in tx.cypher  # no visit

    def test_measurement_requires_identity_keys(self):
        from workers import graph_sync
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_measurement_tx(_FakeTx(), {"patient_id": "p1"})

    def test_version_projection_with_chain(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_version_tx(tx, {
            "patient_id": "p1", "version_id": "v2", "medication_id": "m1",
            "version_number": 2,
            "snapshot": {"dose_amount": 20.0, "dose_unit": "mg", "frequency": "ONCE_DAILY",
                         "status": "ACTIVE", "name": "Lisinopril"},
            "supersedes_version_id": "v1",
        })
        assert "HAS_VERSION" in tx.cypher
        assert "SUPERSEDES" in tx.cypher
        assert tx.kwargs["dose_amount"] == 20.0

    def test_version_projection_first_version_no_chain(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_version_tx(tx, {
            "patient_id": "p1", "version_id": "v1", "medication_id": "m1",
            "version_number": 1, "snapshot": {},
        })
        assert "HAS_VERSION" in tx.cypher
        assert "SUPERSEDES" not in tx.cypher

    def test_version_requires_keys(self):
        from workers import graph_sync
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_medication_version_tx(_FakeTx(), {"patient_id": "p1"})


# --- Static Cypher scope validation ----------------------------------------

_CLAUSE_STARTS = ("MATCH ", "OPTIONAL MATCH ", "WITH ", "WHERE ", "RETURN ",
                  "ORDER BY ", "LIMIT ", "CALL ", "UNWIND ", "FOREACH ")
_KEYWORDS = {
    "with", "where", "and", "or", "not", "in", "is", "null", "distinct",
    "collect", "coalesce", "optional", "match", "return", "order", "by",
    "desc", "asc", "limit", "as", "unwind", "call", "case", "when", "then",
    "else", "end", "true", "false", "count", "sum", "avg", "min", "max",
    "exists", "labels", "type", "startnode", "endnode", "id", "keys",
    "properties", "size", "length", "toupper", "tolower", "trim", "split",
    "substring", "replace", "date", "datetime", "duration", "foreach",
    "all", "any", "none", "single", "reduce", "filter", "extract",
    "node", "rel",
}


def _blank_node_rel_patterns(text: str) -> tuple[str, set[str]]:
    """Blank out node/rel patterns, returning cleaned text + bound vars."""
    bound: set[str] = set()
    text = re.sub(r"\(:[^)]*\)", "(NODE)", text)  # anonymous labeled nodes bind nothing
    _node_pat = r"\((\w+)(?:\s*:[^)]*)?(?:\s*\{[^}]*\})?\)"
    for m in re.finditer(_node_pat, text):
        bound.add(m.group(1))
    text = re.sub(_node_pat, "(NODE)", text)

    def _rel(m):
        var = m.group(1)
        if var:
            bound.add(var)
        return "[REL]"

    text = re.sub(r"\[(\w*):?[^\]]*\]", _rel, text)
    return text, bound


def check_with_scope(cypher: str) -> list[str]:
    """Every variable carried/used in WITH/WHERE must be bound or a param.

    Regression guard: catches dropped bindings (e.g. the P1 canon_meds
    merge-WITH bug) without a live database.
    """
    violations: list[str] = []
    params = set(re.findall(r"\$(\w+)", cypher))
    bound: set[str] = set()
    current_clause = ""
    current_text = ""

    def _flush():
        nonlocal current_clause, current_text
        kind = current_clause
        text = current_text
        current_clause, current_text = "", ""
        if kind in ("WITH", "WHERE") and text.strip():
            cleaned, newly = _blank_node_rel_patterns(text)
            bound.update(newly)
            cleaned = re.sub(r"'[^']*'", "", cleaned)
            cleaned = re.sub(r'"[^"]*"', "", cleaned)
            cleaned = re.sub(r"\[[^\]]*\]", " ", cleaned)  # comprehensions bind locally
            # Inline label predicates (e.g. CASE WHEN target:Medication):
            # keep the variable for scope checking, drop the label test.
            cleaned = re.sub(r"\b(\w+):[A-Z]\w*", r"\1", cleaned)
            aliases = set(re.findall(r"\bAS\s+(\w+)", cleaned, re.IGNORECASE))
            cleaned = re.sub(r"\bAS\s+\w+", " ", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"\.\w+", " ", cleaned)  # property access
            cleaned = re.sub(r"(\w+)\s*:", " ", cleaned)  # map keys
            for ident in re.findall(r"\b([A-Za-z_]\w*)\b", cleaned):
                if ident.lower() in _KEYWORDS:
                    continue
                if ident in bound or ident in params:
                    continue
                violations.append(f"{kind} uses unbound '{ident}' in: {text.strip()[:90]}")
            bound.update(aliases)
        elif kind in ("MATCH", "OPTIONAL MATCH") and text.strip():
            _, newly = _blank_node_rel_patterns(text)
            bound.update(newly)

    for line in cypher.splitlines():
        stripped = line.strip()
        upper = stripped.upper()
        is_comment = stripped.startswith("//")
        starts = next((k for k in _CLAUSE_STARTS if upper.startswith(k)), None)
        if is_comment:
            continue
        if starts:
            _flush()
            current_clause = starts.strip()
            current_text = stripped[len(starts):]
        else:
            current_text += " " + stripped
    _flush()
    return violations


def _extract_cypher_blocks(path: str) -> list[str]:
    with open(path) as f:
        src = f.read()
    blocks = re.findall(r'"""(.*?)"""', src, re.DOTALL)
    return [b for b in blocks if "MATCH" in b.upper() and "RETURN" in b.upper()]


class TestCypherScope:
    def test_main_graph_query_with_scope(self):
        blocks = _extract_cypher_blocks("app/api/v1/health_graph.py")
        assert blocks, "expected cypher blocks"
        # The main graph query is the largest block.
        main = max(blocks, key=len)
        violations = check_with_scope(main)
        assert violations == [], violations

    def test_all_health_graph_blocks_scoped(self):
        for i, block in enumerate(_extract_cypher_blocks("app/api/v1/health_graph.py")):
            assert check_with_scope(block) == [], f"block {i}"

    def test_scope_checker_catches_dropped_binding(self):
        bad = """
        MATCH (p:Patient {id: $patient_id})
        WITH p, ghost, collect(DISTINCT x) AS xs
        RETURN p
        """
        violations = check_with_scope(bad)
        assert any("ghost" in v for v in violations)


class TestP2TraversalSafety:
    def test_new_templates_safe(self):
        for tid in ("T-MEASURE-TREND", "T-VISIT-RANGE", "T-EVID-CHAIN-MEASURE"):
            t = tpl.TEMPLATES[tid]
            assert tpl.check_cypher_safety(t.cypher) == [], (tid, tpl.check_cypher_safety(t.cypher))

    def test_all_templates_still_safe(self):
        for tid, t in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(t.cypher) == [], tid

    def test_p2_rels_allow_listed(self):
        for rel in ("HAS_MEASUREMENT", "HAS_VERSION", "SUPERSEDES"):
            assert rel in tpl.ALLOWED_TRAVERSAL_RELS, rel

    def test_no_materialized_next_chains(self):
        import glob

        for path in ["workers/graph_sync.py", "services/retrieval/templates.py"] + glob.glob("agents/tools/*.py"):
            with open(path) as f:
                src = f.read()
            assert "[:NEXT]" not in src, f"{path}: materialized NEXT chain forbidden in P2"

    def test_no_causal_edges_in_p2_code(self):
        import glob

        for path in ["workers/graph_sync.py", "services/retrieval/templates.py",
                     "services/clinical/measurements.py", "services/clinical/versions.py",
                     "agents/tools/measurement_trend.py"] + glob.glob("agents/tools/*.py"):
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
                        "CORRELATED_WITH", "SUPPORTS", "MANIFESTATION_OF", "NEXT",
                    ), f"{path}: {name}"

    def test_p2_health_graph_blocks_carry_patient_binding(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        for guard in ("(p)-[:HAS_MEASUREMENT]->(mm3)",
                      "(p)-[:HAS_MEASUREMENT]->(mm4)",
                      "(p)-[:HAS_MEDICATION_REQUEST]->(req8)",
                      "(p)-[:HAS_VISIT]->(vv3)"):
            assert guard in src, guard

    def test_new_node_types_mapped(self):
        from app.api.v1.health_graph import NODE_TYPE_MAP

        assert NODE_TYPE_MAP["Measurement"] == "measurement"
        assert NODE_TYPE_MAP["MedicationVersion"] == "medication_version"

    def test_measurement_label_value_qualified(self):
        from app.api.v1.health_graph import _node_from_raw

        class Raw(dict):
            labels = {"Measurement"}

        node = _node_from_raw(Raw({"id": "m1", "name": "Glucose", "value_text": "110", "unit": "mg/dL"}))
        assert node.label == "Glucose 110 mg/dL"
        assert node.type == "measurement"

    def test_version_label(self):
        from app.api.v1.health_graph import _node_from_raw

        class Raw(dict):
            labels = {"MedicationVersion"}

        node = _node_from_raw(Raw({"id": "v1", "version_number": 2}))
        assert node.label == "Regimen v2"


class TestLegacyCompatibility:
    def test_nothing_retired_in_p2(self):
        with open("app/api/v1/health_graph.py") as f:
            hg = f.read()
        with open("workers/graph_sync.py") as f:
            gs = f.read()
        # Dual-write and legacy reads all preserved.
        assert "SOURCE_DOCUMENT" in gs and "DOCUMENTED_IN" in gs
        assert "LOGGED_ON" in gs and "OCCURRED_DURING" in gs
        assert "DERIVED_SAME_DAY" in hg
        assert "ACTIVE_MEDICATION" in gs and "TAKEN_FROM" in gs

    def test_outbox_new_types_present(self):
        from models.outbox import OutboxEventType

        assert OutboxEventType.MEASUREMENT_RECORDED.value == "measurement_recorded"
        assert OutboxEventType.MEDICATION_VERSION_RECORDED.value == "medication_version_recorded"

    def test_measurement_enqueue_defaults(self):
        calls = []

        class FakeDB:
            def add(self, row):
                calls.append(row)

        from models.outbox import enqueue_measurement
        import uuid as _uuid

        enqueue_measurement(
            FakeDB(), measurement_id=_uuid.uuid4(), patient_id=_uuid.uuid4(),
            name="X", series_key="x", value_text="1",
        )
        payload = calls[0].payload
        assert payload["interpretation"] == "unknown"
        assert payload["polarity"] == "positive"

    def test_migration_chain(self):
        with open("alembic/versions/p2e8b41c7d33_p2_measurement_versions.py") as f:
            src = f.read()
        assert 'down_revision' in src and "p1c4d19a2b77" in src
        assert 'revision: str = "p2e8b41c7d33"' in src
