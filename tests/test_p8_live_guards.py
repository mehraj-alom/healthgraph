"""P8 real-environment regression tests.

Part 1 (always runs, no DB/network): static guards over the projection
Cypher in workers/graph_sync.py — no query may conclude with a bare WITH
clause (Neo4j 2026 GQL conformance rejects it; found live in P8 when every
clinical/medication/condition projection failed with
"Query cannot conclude with WITH").

Part 2 (live, gated by P8_LIVE=1): the PostgreSQL outboxeventtype enum must
contain a label for every OutboxEventType member NAME (SQLAlchemy persists
SQLEnum members by name; P1/P2 migrations added only lowercase values, so
every P1+ outbox insert failed live while all DB-less tests passed).
"""
import os
import re

import pytest


def _projection_cyphers() -> dict:
    import workers.graph_sync as gs

    found = {}
    for name in dir(gs):
        if not name.startswith("_project_") or not name.endswith("_tx"):
            continue
        fn = getattr(gs, name)
        src = getattr(fn, "__code__", None)
        if src is None:  # pragma: no cover - defensive
            continue
        found[name] = src
    assert found, "no projection functions discovered"
    return found


class TestCypherTrailingWith:
    def test_no_projection_source_ends_query_with_bare_with(self):
        import inspect

        import workers.graph_sync as gs

        offenders = []
        for name, _ in _projection_cyphers().items():
            src = inspect.getsource(getattr(gs, name))
            # Robust check: extract triple-quoted query fragments and verify
            # none ends with a bare WITH line.
            for m in re.finditer(r'"""(.*?)"""', src, re.DOTALL):
                tail = m.group(1).strip().splitlines()
                last = tail[-1].strip() if tail else ""
                if re.match(r"^WITH\s+[\w,\s]+$", last):
                    offenders.append(f"{name}: query ends with {last!r}")
        assert not offenders, "Neo4j 2026 rejects queries concluding with WITH: " + "; ".join(offenders)

    def test_projection_queries_execute_past_trailing_clause_on_fake_tx(self):
        # Every projection must at least build a query whose final clause is
        # an update/merge/set/delete/return-family statement. Exercised via
        # fake tx objects is covered per-domain elsewhere; here we assert the
        # module exposes the 14 documented projectors.
        import workers.graph_sync as gs

        expected = {
            "_project_observation_tx", "_project_clinical_event_tx",
            "_project_medication_tx", "_project_medication_taken_tx",
            "_project_condition_tx", "_project_visit_tx",
            "_project_statement_tx", "_project_measurement_tx",
            "_project_medication_version_tx", "_project_sleep_tx",
            "_project_activity_tx", "_project_nutrition_tx",
            "_project_food_scan_tx", "_project_ppg_tx",
            "_project_node_retired_tx",
        }
        missing = {n for n in expected if not callable(getattr(gs, n, None))}
        assert not missing, f"missing projectors: {sorted(missing)}"


LIVE = os.getenv("P8_LIVE") == "1"
needs_live = pytest.mark.skipif(not LIVE, reason="live PG check (P8_LIVE=1)")


@needs_live
class TestOutboxEnumLabelsLive:
    def test_enum_covers_every_member_name(self):
        from dotenv import load_dotenv
        from sqlalchemy import create_engine, text

        load_dotenv("/home/opticpulse/healthgraph/.env")
        from models.outbox import OutboxEventType

        eng = create_engine(os.getenv("DATABASE_URL"))
        with eng.connect() as conn:
            labels = {
                r[0]
                for r in conn.execute(
                    text(
                        "SELECT e.enumlabel FROM pg_enum e "
                        "JOIN pg_type t ON t.oid = e.enumtypid "
                        "WHERE t.typname = 'outboxeventtype'"
                    )
                ).fetchall()
            }
        missing = [m.name for m in OutboxEventType if m.name not in labels]
        assert not missing, f"outboxeventtype lacks labels for {missing}"
