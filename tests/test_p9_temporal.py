"""P9 temporal graph tests (no DB / Neo4j / network).

Covers the 17 P9 test categories: Day identity, Patient→Day/Event→Day
projection, same-day/cross-day/two-patient behavior, isolation,
idempotent replay, correction moves, retirement/empty-day lifecycle,
midnight anchoring, day-range queries, Visit compatibility, and P8.2
backward compatibility. Projection assertions run the REAL projector
functions against a FakeTx that captures cypher + params.
"""
import re
import uuid
from datetime import date, datetime, timezone

import pytest

import workers.graph_sync as gs
from services.retrieval import templates as tpl


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


def _sleep_payload(pid, eid, when):
    return {
        "patient_id": str(pid), "event_id": str(eid),
        "duration_minutes": 420, "sleep_quality": 4, "awakenings": 1,
        "event_time": when,
    }


def _run_sleep(pid, eid, when):
    tx = _FakeTx()
    gs._project_sleep_tx(tx, _sleep_payload(pid, eid, when))
    return tx


class TestDayIdentity:
    def test_iso_datetime_yields_scoped_id(self):
        assert gs._day_identity("pid-1", "2026-09-20T08:00:00+00:00") == (
            "pid-1:2026-09-20", "2026-09-20")

    def test_bare_date_and_objects(self):
        assert gs._day_identity("p", "2026-09-19")[1] == "2026-09-19"
        assert gs._day_identity("p", date(2026, 9, 19)) == ("p:2026-09-19", "2026-09-19")
        assert gs._day_identity("p", datetime(2026, 9, 19, 23, 59, tzinfo=timezone.utc))[1] == "2026-09-19"

    def test_unusable_inputs_yield_none(self):
        assert gs._day_identity("p", None) is None
        assert gs._day_identity("p", "sometime") is None
        assert gs._day_identity("p", "2026-13-40") is None
        assert gs._day_identity("p", "") is None

    def test_colon_patient_id_rejected(self):
        # A ':' in the id would make identity ambiguous — never build it.
        assert gs._day_identity("a:b", "2026-09-20") is None
        assert gs._day_identity("", "2026-09-20") is None

    def test_same_date_two_patients_distinct(self):
        a = gs._day_identity("patient-A", "2026-09-20")
        b = gs._day_identity("patient-B", "2026-09-20")
        assert a[0] != b[0] and a[1] == b[1] == "2026-09-20"
        # No shared/global Day id exists by construction.
        assert ":" in a[0] and a[0].startswith("patient-A:")


class TestDayProjection:
    def test_sleep_projects_day_and_links(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        tx = _run_sleep(pid, eid, "2026-09-20T22:30:00+00:00")
        assert tx.kwargs["day_id"] == f"{pid}:2026-09-20"
        assert tx.kwargs["day_date"] == "2026-09-20"
        assert "MERGE (day:Day {id: $day_id})" in tx.cypher
        assert "MERGE (p)-[:HAS_DAY]->(day)" in tx.cypher
        assert "MERGE (day)-[:HAS_EVENT]->(s)" in tx.cypher
        # Existing semantics intact.
        assert "MERGE (p)-[:HAS_SLEEP]->(s)" in tx.cypher

    def test_dateless_payload_projects_without_day(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        tx = _run_sleep(pid, eid, None)
        assert "day_id" not in tx.kwargs
        assert ":Day" not in tx.cypher
        assert "MERGE (p)-[:HAS_SLEEP]->(s)" in tx.cypher

    def test_visit_joins_its_day(self):
        pid = uuid.uuid4()
        tx = _FakeTx()
        gs._project_visit_tx(tx, {
            "patient_id": str(pid), "visit_id": str(uuid.uuid4()),
            "visit_date": "2026-09-20", "visit_type": "daily-checkin",
        })
        assert tx.kwargs["day_id"] == f"{pid}:2026-09-20"
        assert "MERGE (p)-[:HAS_VISIT]->(v)" in tx.cypher
        assert "MERGE (day)-[:HAS_EVENT]->(v)" in tx.cypher

    def test_all_eight_projectors_link_day(self):
        pid = uuid.uuid4()
        cases = [
            (gs._project_clinical_event_tx, {
                "patient_id": str(pid), "event_id": str(uuid.uuid4()),
                "event_type": "SYMPTOM", "source_type": "PATIENT_REPORTED",
                "verification_status": "UNVERIFIED",
                "event_time": "2026-09-20T10:00:00+00:00", "level_number": 1}, "t"),
            (gs._project_sleep_tx, _sleep_payload(pid, uuid.uuid4(), "2026-09-20T23:00:00+00:00"), "s"),
            (gs._project_activity_tx, {
                "patient_id": str(pid), "event_id": str(uuid.uuid4()),
                "activity_type": "walk", "event_time": "2026-09-20T08:00:00+00:00"}, "a"),
            (gs._project_nutrition_tx, {
                "patient_id": str(pid), "event_id": str(uuid.uuid4()),
                "event_time": "2026-09-20T12:00:00+00:00"}, "n"),
            (gs._project_food_scan_tx, {
                "patient_id": str(pid), "scan_id": str(uuid.uuid4()),
                "entries": [], "recorded_at": "2026-09-20T13:00:00+00:00"}, "f"),
            (gs._project_ppg_tx, {
                "patient_id": str(pid), "measurement_id": str(uuid.uuid4()),
                "measurement_type": "camera_ppg",
                "measured_at": "2026-09-20T09:00:00+00:00"}, "m"),
            (gs._project_medication_taken_tx, {
                "patient_id": str(pid), "event_id": str(uuid.uuid4()),
                "taken_at": "2026-09-20T09:00:00+00:00"}, "e"),
            (gs._project_visit_tx, {
                "patient_id": str(pid), "visit_id": str(uuid.uuid4()),
                "visit_date": "2026-09-20", "visit_type": "daily-checkin"}, "v"),
        ]
        for fn, payload, subj in cases:
            tx = _FakeTx()
            fn(tx, payload)
            assert tx.kwargs.get("day_id") == f"{pid}:2026-09-20", fn.__name__
            assert f"MERGE (day)-[:HAS_EVENT]->({subj})" in tx.cypher, fn.__name__

    def test_foodscan_day_link_survives_empty_entries(self):
        # Zero-row hazard (VERIFIED LIVE in P9): clauses after
        # UNWIND run zero times when entries is empty, so the Day
        # fragment must sit BEFORE the UNWIND.
        pid = uuid.uuid4()
        tx = _FakeTx()
        gs._project_food_scan_tx(tx, {
            "patient_id": str(pid), "scan_id": str(uuid.uuid4()),
            "entries": [], "recorded_at": "2026-09-20T13:00:00+00:00"})
        assert tx.kwargs["day_id"] == f"{pid}:2026-09-20"
        day_pos = tx.cypher.index("MERGE (day)-[:HAS_EVENT]->(f)")
        assert day_pos < tx.cypher.index("UNWIND $entries")

    def test_observation_gets_no_day_edge(self):        # Phase-2 exclusion: observations stay temporally covered via
        # LOGGED_ON event + OCCURRED_DURING visit.
        tx = _FakeTx()
        gs._project_observation_tx(tx, {
            "patient_id": str(uuid.uuid4()), "observation_id": str(uuid.uuid4()),
            "structure_id": "HEAD", "finding_code": "x",
            "visual_severity_score": 0.0, "recorded_at": "2026-09-20T10:00:00+00:00",
            "source_type": "IMAGING_REPORT", "level_number": 1})
        assert ":Day" not in tx.cypher and "day_id" not in tx.kwargs


class TestDayGrouping:
    def test_same_day_same_id(self):
        pid = uuid.uuid4()
        t1 = _run_sleep(pid, uuid.uuid4(), "2026-09-20T01:00:00+00:00")
        t2 = _run_sleep(pid, uuid.uuid4(), "2026-09-20T23:00:00+00:00")
        assert t1.kwargs["day_id"] == t2.kwargs["day_id"]

    def test_cross_day_distinct_ids(self):
        pid = uuid.uuid4()
        t1 = _run_sleep(pid, uuid.uuid4(), "2026-09-19T23:00:00+00:00")
        t2 = _run_sleep(pid, uuid.uuid4(), "2026-09-20T00:30:00+00:00")
        assert t1.kwargs["day_id"] != t2.kwargs["day_id"]

    def test_midnight_anchor_is_event_date(self):
        # No start/end exists in the model: the event_time calendar date
        # is the anchor, documented (cross-midnight sessions cannot be
        # split from stored data).
        assert gs._day_identity("p", "2026-09-20T00:30:00+00:00")[1] == "2026-09-20"


class TestDayIsolation:
    def test_fragment_binds_patient_only(self):
        frag = gs._day_link_cypher("s")
        assert "(p:Patient" not in frag  # bound by the host query
        assert "MERGE (p)-[:HAS_DAY]->(day)" in frag
        # Only the host-bound $patient_id param (Day prop + host MERGEs);
        # no second patient variable, no patient literal, no other anchor.
        assert frag.count("$patient_id") == 1  # SET day.patient_id
        assert "Patient {" not in frag
        assert re.search(r"\bid\b.*=.*['\"]", frag) is None

    def test_day_id_embeds_patient(self):
        assert gs._day_identity("A", "2026-09-20")[0].startswith("A:")
        assert gs._day_identity("B", "2026-09-20")[0].startswith("B:")


class TestDayIdempotency:
    def test_replay_identical(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        payload = _sleep_payload(pid, eid, "2026-09-20T22:00:00+00:00")
        t1, t2 = _FakeTx(), _FakeTx()
        gs._project_sleep_tx(t1, dict(payload))
        gs._project_sleep_tx(t2, dict(payload))
        assert t1.cypher == t2.cypher and t1.kwargs == t2.kwargs
        # MERGE-only day writes: replay cannot duplicate nodes or edges.
        assert t1.cypher.count("MERGE (day:Day") == 1
        assert t1.cypher.count("MERGE (p)-[:HAS_DAY]->(day)") == 1
        assert t1.cypher.count("MERGE (day)-[:HAS_EVENT]->(s)") == 1


class TestDayCorrectionMove:
    def test_stale_day_cleanup_present(self):
        pid, eid = uuid.uuid4(), uuid.uuid4()
        tx = _run_sleep(pid, eid, "2026-09-21T08:00:00+00:00")
        assert "OPTIONAL MATCH (old_day:Day)-[old_rel:HAS_EVENT]->(s)" in tx.cypher
        assert "WHERE old_day.id <> $day_id" in tx.cypher
        assert "DELETE old_rel" in tx.cypher


class TestDayLifecycle:
    def test_day_not_retireable(self):
        from models.outbox import RETIREABLE_NODE_LABELS
        assert "Day" not in RETIREABLE_NODE_LABELS
        assert "Visit" not in RETIREABLE_NODE_LABELS

    def test_retire_path_deletes_no_day(self):
        import inspect
        src = inspect.getsource(gs._project_node_retired_tx)
        assert ":Day" not in src and "HAS_DAY" not in src and "HAS_EVENT" not in src

    def test_empty_day_remains_by_design(self):
        # Decision B (documented): containers persist like Visits; no
        # DELETE of Day nodes exists anywhere in the projection layer.
        import inspect
        whole = inspect.getsource(gs)
        assert "DETACH DELETE day" not in whole
        assert "DELETE day" not in whole


class TestDayQueries:
    def test_template_registered_and_safe(self):
        assert "T-DAY-RANGE" in tpl.TEMPLATES
        assert tpl.check_cypher_safety(tpl.CYPHER_DAY_RANGE) == []

    def test_query_groups_by_day(self):
        from services.retrieval import day_range as dr

        captured = {}

        class _Rows:
            def data(self):
                return [
                    {"day": "2026-09-20", "kind": "SleepEpisode",
                     "event_id": "e1", "exact_time": "2026-09-20T23:00:00+00:00"},
                    {"day": "2026-09-19", "kind": "ActivityEvent",
                     "event_id": "e2", "exact_time": "2026-09-19T08:00:00+00:00"},
                    {"day": "2026-09-20", "kind": "TimelineEvent",
                     "event_id": "e3", "exact_time": None},
                ]

        class _Session:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cypher, **params):
                captured.update(params)
                return _Rows()

        class _Driver:
            def session(self):
                return _Session()

        out = dr.query_day_range(_Driver(), uuid.uuid4(), "2026-09-19", "2026-09-20")
        assert [g["day"] for g in out] == ["2026-09-19", "2026-09-20"]
        assert len(out[1]["events"]) == 2
        assert captured["start_date"] == "2026-09-19"
        assert captured["limit"] == 500

    def test_query_rejects_bad_input(self):
        from services.retrieval import day_range as dr

        with pytest.raises(ValueError):
            dr.query_day_range(None, uuid.uuid4(), "yesterday", "2026-09-20")
        with pytest.raises(ValueError):
            dr.query_day_range(None, uuid.uuid4(), "2026-09-20", "2026-09-19")
        with pytest.raises(ValueError):
            dr.query_day_range(None, "not-a-uuid", "2026-09-19", "2026-09-20")

    def test_query_limit_bounded(self):
        from services.retrieval import day_range as dr

        seen = {}

        class _Rows:
            def data(self):
                return []

        class _Session:
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def run(self, cypher, **params):
                seen.update(params)
                return _Rows()

        class _Driver:
            def session(self):
                return _Session()

        dr.query_day_range(_Driver(), uuid.uuid4(), "2026-09-19", "2026-09-20", limit=10**9)
        assert seen["limit"] == 2000


class TestP82Compatibility:
    def test_existing_clauses_preserved(self):
        tx = _FakeTx()
        gs._project_clinical_event_tx(tx, {
            "patient_id": str(uuid.uuid4()), "event_id": str(uuid.uuid4()),
            "event_type": "SYMPTOM", "source_type": "PATIENT_REPORTED",
            "verification_status": "UNVERIFIED",
            "event_time": "2026-09-20T10:00:00+00:00", "level_number": 1,
            "document_id": str(uuid.uuid4()), "visit_id": str(uuid.uuid4())})
        # P0/P1 semantics untouched; Day is appended, not interleaved.
        assert "MERGE (t)-[:DOCUMENTED_IN]->(d)" in tx.cypher
        assert "OCCURRED_DURING" in tx.cypher
        assert "WHERE t.pg_updated_at IS NULL" in tx.cypher

    def test_no_trailing_with_in_modified_sources(self):
        import inspect
        for fn in (gs._project_clinical_event_tx, gs._project_sleep_tx,
                   gs._project_activity_tx, gs._project_nutrition_tx,
                   gs._project_food_scan_tx, gs._project_ppg_tx,
                   gs._project_medication_taken_tx, gs._project_visit_tx):
            for m in re.finditer(r'"""(.*?)"""', inspect.getsource(fn), re.DOTALL):
                tail = m.group(1).strip().splitlines()
                last = tail[-1].strip() if tail else ""
                assert not re.match(r"^WITH\s+[\w,\s]+$", last), fn.__name__

    def test_allow_list_grew_only_additively(self):
        for rel in ("HAS_DAY", "HAS_EVENT"):
            assert rel in tpl.ALLOWED_TRAVERSAL_RELS
        for rel in ("CAUSES", "TREATS"):
            assert rel not in tpl.ALLOWED_TRAVERSAL_RELS
