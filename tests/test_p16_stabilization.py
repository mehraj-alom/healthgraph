"""Stabilization regression tests: graph GQL legality, anatomy seed, savepoints.

DB-less and Neo4j-less (structural + fakes), CI-safe:

  - overview/detail Cypher never mixes an expression alias into a later
    aggregation (Aura GQL 42I18 class of failure);
  - patient-reachability scoping on the generic fetch is preserved;
  - the canonical anatomy seed validates and contains FULL_BODY;
  - per-observation SAVEPOINTs isolate one bad structure reference.
"""

import re


# --- Cypher structural pins (repo precedent: text-level guards) ---

def test_no_expression_alias_inside_aggregation():
    import pathlib
    src = pathlib.Path("app/api/v1/health_graph.py").read_text()
    for match in re.finditer(r"\+ collect\(DISTINCT", src):
        raise AssertionError(
            "expression alias mixed into aggregation near: "
            + src[max(0, match.start() - 80):match.start()]
        )

def _health_graph_source():
    import pathlib
    return pathlib.Path("app/api/v1/health_graph.py").read_text()


def test_no_expression_alias_inside_aggregation():
    src = _health_graph_source()
    # An alias (list concatenation) fed into a later collect() is what
    # Aura rejects with 42I18 "non-grouping sub-expression".
    for match in re.finditer(r"\+ collect\(DISTINCT", src):
        raise AssertionError(
            "expression alias mixed into aggregation near: "
            + src[max(0, match.start() - 80):match.start()]
        )


def test_generic_fetch_scoped_to_patient_reachability():
    src = _health_graph_source()
    assert "MATCH (p:Patient {id: $patient_id})-[*1..4]-(target {id: $raw_id})" in src


def test_doc_merge_combines_in_pure_with():
    src = _health_graph_source()
    assert "documents + documents2 + cdds + reqdds + mdds AS all_docs2" in src


# --- Anatomy seed ---

def test_seed_hierarchy_validates_and_has_full_body():
    from scripts.seed_anatomical_structures import SEED_DATA, _validate_hierarchy

    assert _validate_hierarchy(list(SEED_DATA)) == []
    by_id = {row[0]: row for row in SEED_DATA}
    assert "FULL_BODY" in by_id
    assert len(by_id) == len(SEED_DATA), "duplicate structure ids"


# --- Per-observation savepoints ---

class _Nested:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        self.db.nested_entries += 1
        return self

    def __exit__(self, exc_type, exc, tb):
        self.db.nested_exits += 1
        return False


class _FakeDb:
    def __init__(self):
        self.nested_entries = 0
        self.nested_exits = 0


def test_one_bad_observation_cannot_fail_the_document(monkeypatch):
    import workers.ingestion_tasks as tasks

    calls = []

    def fake_record(db, obs, auto_commit=False):
        calls.append(obs.observation_id)
        if obs.observation_id == "bad":
            raise ValueError("FK violation")

    class Obs:
        def __init__(self, oid):
            self.observation_id = oid

    monkeypatch.setattr(tasks, "record_anatomical_observation", fake_record)
    monkeypatch.setattr(tasks, "_log", lambda *a, **k: None)

    db = _FakeDb()
    db.begin_nested = lambda: _Nested(db)  # type: ignore[attr-defined]
    recorded, failed = tasks._record_anatomical_observations(
        db, [Obs("a"), Obs("bad"), Obs("c")], "doc-1"
    )
    assert (recorded, failed) == (2, 1)
    assert calls == ["a", "bad", "c"]
    assert db.nested_entries == 3
    assert db.nested_exits == 3
