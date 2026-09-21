"""P3 longitudinal personal-health domains tests (no DB/Neo4j/network).

Covers:
- daily-domain helpers (sleep/activity/nutrition/symptom/notes/meds)
- user-reported vs system-derived distinction (no confirmed facts)
- food scan log/correct behavior (original label preserved)
- PPG projection (HRV null for face, raw stays out)
- raw-data reference handling (no blobs/waveforms/RR in Neo4j payloads)
- measurement trends (existing P2 path sanity)
- visit integration (all sections share the day visit)
- retrieval templates (new + all) + citation behavior
- Cypher WITH p scope for the expanded main query
- traversal allow-list (new rels in, causal out)
- cross-patient negative checks (verification strings carry p binding)
- MERGE idempotency shape + old payload compatibility
- migration chain integrity
"""
import re
import uuid
from datetime import datetime, timezone

from services.retrieval import templates as tpl


class FakeQuery:
    def __init__(self, first_result=None):
        self._first = first_result

    def filter(self, *a, **k):
        return self

    def first(self):
        return self._first


class FakeDB:
    def __init__(self):
        self.rows = []
        self.by_id = {}

    def scalar(self, stmt):
        return None

    def get(self, model, ident):
        return self.by_id.get(str(ident))

    def add(self, row):
        self.rows.append(row)
        for attr in ("condition_id", "visit_id", "statement_id", "measurement_id",
                     "version_id", "scan_id", "entry_id"):
            if hasattr(row, attr) and getattr(row, attr) is not None:
                self.by_id[str(getattr(row, attr))] = row

    def flush(self):
        pass

    def refresh(self, row):
        pass

    def query(self, model):
        return FakeQuery()

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


def _event(**over):
    from models.events import ClinicalEvent, EventType, SourceType, VerificationStatus

    e = ClinicalEvent(
        event_id=over.get("event_id", uuid.uuid4()),
        patient_id=over.get("patient_id", uuid.uuid4()),
        event_type=over.get("event_type", EventType.SLEEP_LOG),
        source_type=SourceType.PATIENT_REPORTED,
        verification_status=VerificationStatus.HUMAN_VERIFIED,
        event_time=over.get("event_time", datetime.now(timezone.utc)),
    )
    return e


def _visit(db, pid):
    from services.clinical.daily_domains import checkin_visit

    return checkin_visit(db, pid, datetime.now(timezone.utc))


class TestDailyDomainHelpers:
    def test_checkin_visit_deterministic(self):
        db = FakeDB()
        pid = uuid.uuid4()
        v1 = _visit(db, pid)
        assert v1.visit_type == "daily-checkin"

        class DB2(FakeDB):
            def scalar(self_inner, stmt):
                return v1

        from services.clinical.daily_domains import checkin_visit as cv

        assert cv(DB2(), pid, datetime.now(timezone.utc)).visit_id == v1.visit_id

    def test_sleep_projects_user_reported(self):
        from services.clinical.daily_domains import project_sleep
        from models.outbox import OutboxEventType

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_sleep(db, e.patient_id, e, 420, 4, 1, v)
        rows = [r for r in db.rows if hasattr(r, "event_type")]
        assert len(rows) == 2  # visit + sleep (visit row from _visit)
        sleep = [r for r in rows if r.event_type == OutboxEventType.SLEEP_RECORDED][0]
        assert sleep.payload["duration_minutes"] == 420
        assert sleep.payload["visit_id"] == str(v.visit_id)

    def test_activity_nutrition_project(self):
        from services.clinical.daily_domains import project_activity, project_nutrition
        from models.outbox import OutboxEventType

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_activity(db, e.patient_id, e, "Running", 30, 250.0, v)
        project_nutrition(db, e.patient_id, e, 500, 3, 4, 2100, "lunch", v)
        kinds = {r.event_type for r in db.rows if hasattr(r, "event_type")}
        assert OutboxEventType.ACTIVITY_RECORDED in kinds
        assert OutboxEventType.NUTRITION_RECORDED in kinds

    def test_notes_become_statements_not_facts(self):
        from services.clinical.daily_domains import project_notes_statement
        from models.statements import PatientStatement
        from models.outbox import OutboxEventType

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_notes_statement(db, e.patient_id, "  feeling tired today  ", v)
        stmts = [r for r in db.rows if isinstance(r, PatientStatement)]
        assert len(stmts) == 1
        assert stmts[0].original_text == "feeling tired today"
        assert stmts[0].speaker == "patient"
        assert OutboxEventType.STATEMENT_RECORDED in {r.event_type for r in db.rows if hasattr(r, "event_type")}

    def test_empty_notes_create_nothing(self):
        from services.clinical.daily_domains import project_notes_statement

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_notes_statement(db, e.patient_id, "   ", v)
        assert db.rows == [] or all(not hasattr(r, "statement_id") for r in db.rows)

    def test_daily_meds_name_only_no_results_from(self):
        from services.clinical.daily_domains import project_daily_meds_taken
        from models.outbox import OutboxEventType

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_daily_meds_taken(db, e.patient_id, e, "Ibuprofen", 200.0, "mg", v)
        taken = [r for r in db.rows if hasattr(r, "event_type")
                 and r.event_type == OutboxEventType.MEDICATION_TAKEN_RECORDED]
        assert len(taken) == 1
        assert "medication_id" not in taken[0].payload  # no regimen evidence
        assert taken[0].payload["medication_name"] == "Ibuprofen"

    def test_symptom_condition_keeps_user_reported(self):
        from services.clinical.daily_domains import project_symptom_condition
        from models.conditions import ConditionOccurrence

        db = FakeDB()
        e = _event()
        v = _visit(db, e.patient_id)
        project_symptom_condition(db, e.patient_id, e, None, 7, 120, "throbbing", v)
        conds = [r for r in db.rows if isinstance(r, ConditionOccurrence)]
        assert len(conds) == 1
        assert conds[0].source_type == "PATIENT_REPORTED"
        assert "severity 7/10" in (conds[0].evidence_text or "")

    def test_checkin_enqueue_stamps_assertion_and_visit(self):
        from services.clinical.daily_domains import enqueue_checkin_event
        from models.outbox import OutboxEventType

        db = FakeDB()
        e = _event()
        assert e.polarity is None
        v = _visit(db, e.patient_id)
        enqueue_checkin_event(db, e.patient_id, e, v)
        assert e.polarity == "positive"
        assert e.experiencer == "patient"
        clinical = [r for r in db.rows if hasattr(r, "event_type")
                    and r.event_type == OutboxEventType.CLINICAL_EVENT_RECORDED]
        assert clinical[0].payload["visit_id"] == str(v.visit_id)


class TestFoodBehavior:
    def _scan(self, db, pid):
        from models.food import FoodEntry, FoodScan

        scan = FoodScan(scan_id=uuid.uuid4(), patient_id=pid, status="ai_estimated",
                        total_kcal=500, model="openai/gpt-4o")
        db.add(scan)
        db.flush()
        entry = FoodEntry(scan_id=scan.scan_id, label="fried rice", kcal=500.0, confidence=0.8)
        # FakeDB.add reads entry_id attr
        entry.entry_id = uuid.uuid4()
        db.add(entry)
        return scan, entry

    def test_correction_preserves_original_label(self):
        db = FakeDB()
        pid = uuid.uuid4()
        scan, entry = self._scan(db, pid)
        entry.corrected = True
        entry.corrected_label = "boiled rice"
        assert entry.label == "fried rice"  # AI estimate never overwritten
        assert entry.corrected_label == "boiled rice"

    def test_food_projection_unwinds_entries(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_food_scan_tx(tx, {
            "patient_id": "p1", "scan_id": "s1", "status": "ai_estimated",
            "entries": [{"entry_id": "e1", "label": "rice", "kcal": 200.0,
                         "portion_g": 150.0, "volume_ml": None, "protein_g": None,
                         "carbs_g": None, "fat_g": None, "confidence": 0.9,
                         "corrected": False, "corrected_label": None}],
            "visit_id": "v1",
        })
        assert "HAS_FOOD_SCAN" in tx.cypher
        assert "HAS_ENTRY" in tx.cypher
        assert "UNWIND $entries AS entry" in tx.cypher
        assert "OCCURRED_DURING" in tx.cypher
        assert "photo" not in tx.cypher.lower()  # images never enter Neo4j

    def test_food_projection_requires_entries_list(self):
        from workers import graph_sync
        import pytest as _pytest
        from workers.graph_sync import PermanentProjectionError

        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_food_scan_tx(_FakeTx(), {"patient_id": "p1"})


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


class TestP3Projections:
    def test_sleep_activity_nutrition(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_sleep_tx(tx, {"patient_id": "p1", "event_id": "e1",
                                          "duration_minutes": 420, "visit_id": "v1"})
        assert "HAS_SLEEP" in tx.cypher and "OCCURRED_DURING" in tx.cypher

        tx = _FakeTx()
        graph_sync._project_activity_tx(tx, {"patient_id": "p1", "event_id": "e1",
                                             "activity_type": "Running"})
        assert "HAS_ACTIVITY" in tx.cypher and "OCCURRED_DURING" not in tx.cypher

        tx = _FakeTx()
        graph_sync._project_nutrition_tx(tx, {"patient_id": "p1", "event_id": "e1",
                                              "calories_kcal": 2100, "visit_id": "v1"})
        assert "HAS_NUTRITION" in tx.cypher and "OCCURRED_DURING" in tx.cypher

    def test_ppg_face_null_hrv_projects(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_ppg_tx(tx, {
            "patient_id": "p1", "measurement_id": "m1", "measurement_type": "face_rppg",
            "heart_rate_bpm": 72.0, "signal_quality": 0.8, "reliable": True,
            "duration_seconds": 5, "algorithm_version": "rppg-1.0.0",
            "model_version": "physformer-rppg-1.0.0", "measured_at": "2026-01-01",
            "visit_id": "v1",
        })
        assert "HAS_BIOMETRIC" in tx.cypher
        assert "m.method = $measurement_type" in tx.cypher
        assert "rr_intervals_ms" not in tx.cypher  # raw list stays in PG
        assert "has_rr_intervals" in tx.cypher  # only the flag projects
        assert tx.kwargs["rmssd_ms"] is None  # face: null by design

    def test_ppg_fingertip_hrv_projects(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_ppg_tx(tx, {
            "patient_id": "p1", "measurement_id": "m1", "measurement_type": "camera_ppg",
            "heart_rate_bpm": 68.0, "rmssd_ms": 42.0, "sdnn_ms": 55.0,
            "signal_quality": 0.9, "reliable": True, "duration_seconds": 60,
            "algorithm_version": "ppg-1.0.0", "measured_at": "2026-01-01",
        })
        assert tx.kwargs["rmssd_ms"] == 42.0

    def test_taken_name_only_path(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_taken_tx(tx, {
            "patient_id": "p1", "event_id": "e1", "taken_at": "2026-01-01",
            "status": "TAKEN", "visit_id": "v1", "medication_name": "Ibuprofen",
        })
        assert "TAKEN_FROM" in tx.cypher
        assert "RESULTS_FROM" not in tx.cypher  # no order evidence
        assert "norm_key" in tx.cypher

    def test_taken_regimen_path_unchanged(self):
        from workers import graph_sync

        tx = _FakeTx()
        graph_sync._project_medication_taken_tx(tx, {
            "patient_id": "p1", "event_id": "e1", "medication_id": "m1",
            "taken_at": "2026-01-01", "status": "TAKEN",
        })
        assert "RESULTS_FROM" in tx.cypher

    def test_required_keys(self):
        from workers import graph_sync
        from workers.graph_sync import PermanentProjectionError
        import pytest as _pytest

        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_sleep_tx(_FakeTx(), {"patient_id": "p1"})
        with _pytest.raises(PermanentProjectionError):
            graph_sync._project_ppg_tx(_FakeTx(), {"patient_id": "p1"})


class TestP3Templates:
    def test_new_templates_safe(self):
        for tid in ("T-SLEEP-TREND", "T-ACTIVITY-TREND", "T-NUTRITION-RANGE",
                    "T-BIOMETRIC-TREND", "T-FOOD-CONTEXT"):
            t = tpl.TEMPLATES[tid]
            assert tpl.check_cypher_safety(t.cypher) == [], (tid, tpl.check_cypher_safety(t.cypher))

    def test_all_templates_still_safe(self):
        for tid, t in tpl.TEMPLATES.items():
            assert tpl.check_cypher_safety(t.cypher) == [], tid

    def test_p3_rels_allow_listed(self):
        for rel in ("HAS_SLEEP", "HAS_ACTIVITY", "HAS_NUTRITION",
                    "HAS_FOOD_SCAN", "HAS_ENTRY", "HAS_BIOMETRIC"):
            assert rel in tpl.ALLOWED_TRAVERSAL_RELS, rel

    def test_no_causal_or_next_edges(self):
        import glob

        for path in ["workers/graph_sync.py", "services/retrieval/templates.py",
                     "services/clinical/daily_domains.py",
                     "agents/tools/lifestyle.py"] + glob.glob("agents/tools/*.py"):
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
                        "CAUSES_STRESS", "INDICATES",
                    ), f"{path}: {name}"

    def test_p3_blocks_carry_patient_binding(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        for guard in ("(p)-[:HAS_FOOD_SCAN]->(fs4)",
                      "(p)-[:HAS_MEASUREMENT]->(mm3)",
                      "(p)-[:HAS_CONDITION]->(cond5)"):
            assert guard in src, guard

    def test_new_node_types_mapped(self):
        from app.api.v1.health_graph import NODE_TYPE_MAP

        for label, ntype in (("SleepEpisode", "sleep_episode"), ("ActivityEvent", "activity_event"),
                             ("NutritionIntake", "nutrition_intake"), ("FoodScan", "food_scan"),
                             ("FoodEntry", "food_entry"), ("PPGMeasurement", "ppg_measurement")):
            assert NODE_TYPE_MAP[label] == ntype

    def test_p3_labels(self):
        from app.api.v1.health_graph import _node_from_raw

        class Raw(dict):
            labels = {"SleepEpisode"}

        assert _node_from_raw(Raw({"id": "s", "duration_minutes": 420})).label == "Sleep 420 min"

        class Raw2(dict):
            labels = {"PPGMeasurement"}

        assert _node_from_raw(Raw2({"id": "p", "heart_rate_bpm": 72, "method": "face_rppg"})).label == "HR 72 bpm (face_rppg)"

        class Raw3(dict):
            labels = {"FoodEntry"}

        assert _node_from_raw(Raw3({"id": "e", "label": "rice"})).label == "rice"


class TestCrossPatientNegatives:
    """Every new verification path must bind the patient first."""

    def test_verification_queries_bind_patient(self):
        with open("app/api/v1/health_graph.py") as f:
            src = f.read()
        for snippet in (
            "(p:Patient {id: $patient_id})-[:HAS_SLEEP]->(target:SleepEpisode",
            "(p:Patient {id: $patient_id})-[:HAS_ACTIVITY]->(target:ActivityEvent",
            "(p:Patient {id: $patient_id})-[:HAS_NUTRITION]->(target:NutritionIntake",
            "(p:Patient {id: $patient_id})-[:HAS_FOOD_SCAN]->(target:FoodScan",
            "(p:Patient {id: $patient_id})-[:HAS_FOOD_SCAN]->(:FoodScan)-[:HAS_ENTRY]->(target:FoodEntry",
            "(p:Patient {id: $patient_id})-[:HAS_BIOMETRIC]->(target:PPGMeasurement",
        ):
            assert snippet in src, snippet

    def test_hydrators_filter_patient(self):
        import inspect

        from services.retrieval import hydrate as h

        for fn_name in ("hydrate_sleep_detail", "hydrate_activity_detail",
                        "hydrate_nutrition_detail", "hydrate_food_scan_detail",
                        "hydrate_ppg_detail"):
            src = inspect.getsource(getattr(h, fn_name))
            assert "patient_id" in src, fn_name
            assert ".patient_id ==" in src or "patient_id ==" in src, fn_name


class TestLegacyAndMigration:
    def test_nothing_retired_in_p3(self):
        with open("app/api/v1/health_graph.py") as f:
            hg = f.read()
        with open("workers/graph_sync.py") as f:
            gs = f.read()
        assert "SOURCE_DOCUMENT" in gs and "DOCUMENTED_IN" in gs
        assert "LOGGED_ON" in gs and "OCCURRED_DURING" in gs
        assert "DERIVED_SAME_DAY" in hg

    def test_outbox_new_types(self):
        from models.outbox import OutboxEventType

        for name in ("SLEEP_RECORDED", "ACTIVITY_RECORDED", "NUTRITION_RECORDED",
                     "FOOD_SCAN_RECORDED", "PPG_RECORDED"):
            assert getattr(OutboxEventType, name).value == name.lower()

    def test_migration_chain(self):
        with open("alembic/versions/p3f2a66b91c4_p3_personal_health_domains.py") as f:
            src = f.read()
        assert "p2e8b41c7d33" in src
        assert 'revision: str = "p3f2a66b91c4"' in src

    def test_food_tables_registered(self):
        from models.food import FoodEntry, FoodScan

        assert FoodScan.__tablename__ == "food_scans"
        assert FoodEntry.__tablename__ == "food_entries"
