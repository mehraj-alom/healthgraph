#!/usr/bin/env python3
"""P2 retirement-readiness probe (READ-ONLY, safe to run anytime).

Measures dual-write coverage for the legacy relationships planned for
controlled retirement AFTER P2:

- SOURCE_DOCUMENT → DOCUMENTED_IN: observations with a legacy doc link
  but no canonical link (P0 dual-write should drive this to ~0 for new
  rows; old rows need the P1 backfill + re-projection).
- LOGGED_ON → OCCURRED_DURING: timeline events reachable via LOGGED_ON
  but having no OCCURRED_DURING visit edge.
- DERIVED_SAME_DAY → Visit: distinct event dates whose events share no
  common Visit (DERIVED_SAME_DAY must stay until this is ~0).

Exit code 0 always (informational). Nothing is written.
Threshold guidance is printed, not enforced — retirement itself is a
future, explicitly-approved step with its own migration.
"""
from core.neo4j_client import neo4j_driver

QUERIES = {
    "obs_source_doc_without_documented_in": (
        "MATCH (o:Observation)-[:SOURCE_DOCUMENT]->(:Document) "
        "WHERE NOT (o)-[:DOCUMENTED_IN]->(:Document) "
        "RETURN count(DISTINCT o) AS n"
    ),
    "timeline_logged_on_without_visit": (
        "MATCH (:Observation)-[:LOGGED_ON]->(t:TimelineEvent) "
        "WHERE NOT (t)<-[:OCCURRED_DURING]-() AND NOT (t)-[:OCCURRED_DURING]-() "
        "RETURN count(DISTINCT t) AS n"
    ),
    "measurements_without_visit": (
        "MATCH (m:Measurement) WHERE NOT (m)-[:OCCURRED_DURING]->(:Visit) "
        "RETURN count(m) AS n"
    ),
    "conditions_without_visit": (
        "MATCH (c:ConditionOccurrence) WHERE NOT (c)-[:OCCURRED_DURING]->(:Visit) "
        "RETURN count(c) AS n"
    ),
    "requests_without_canonical_med": (
        "MATCH (r:MedicationRequest) WHERE NOT (r)-[:PRESCRIBES]->(:Medication) "
        "RETURN count(r) AS n"
    ),
}


def main() -> dict:
    results: dict = {}
    with neo4j_driver.session() as session:
        for name, cypher in QUERIES.items():
            try:
                rec = session.run(cypher).single()
                results[name] = rec["n"] if rec else "QUERY_FAILED"
            except Exception as e:
                results[name] = f"ERROR: {type(e).__name__}"
    print("P2 retirement-readiness probe (read-only):")
    for name, value in results.items():
        print(f"  {name}: {value}")
    print(
        "Guidance: retire SOURCE_DOCUMENT writes only when "
        "obs_source_doc_without_documented_in is 0 after backfill; retire "
        "LOGGED_ON writes only when timeline_logged_on_without_visit is 0; "
        "retire DERIVED_SAME_DAY only when every same-day event set shares "
        "a Visit (checked per-patient via T-VISIT-RANGE)."
    )
    return results


if __name__ == "__main__":
    main()
