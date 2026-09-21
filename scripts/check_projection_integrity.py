#!/usr/bin/env python3
"""P5 projection-integrity checker (READ-ONLY, safe to run anytime).

Compares PostgreSQL truth against the Neo4j projection for one patient:

- PG entity exists → expected Neo4j node exists (missing_in_graph)
- Neo4j node id not in PG → orphaned_in_graph (stale correction residue)
- Per-entity coverage for TimelineEvent/Condition/Measurement/Statement/
  Sleep/Activity/Nutrition/TakenEvent/Visit/MedicationRequest/FoodScan/PPG

Usage:
    python scripts/check_projection_integrity.py <patient_id>

Exit code 0 with a report (informational, never destructive). The pure
diff_projection() function is unit-tested in tests/test_p5_lifecycle.py.
"""
import sys
import uuid

from sqlalchemy import select

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.conditions import ConditionOccurrence
from models.daily_logs.events import (
    ActivityPayload,
    MedicationTakenPayload,
    NutritionPayload,
    SleepPayload,
)
from models.events import ClinicalEvent
from models.food import FoodScan
from models.measurements import Measurement
from models.medications import Medication, MedicationTakenEvent
from models.ppg import PpgMeasurement
from models.statements import PatientStatement
from models.visits import Visit


def diff_projection(pg_ids: set, graph_ids: set) -> dict:
    """Pure set diff: missing_in_graph (PG without node) vs
    orphaned_in_graph (node without PG row)."""
    pg_ids = {str(x) for x in pg_ids}
    graph_ids = {str(x) for x in graph_ids}
    return {
        "pg_count": len(pg_ids),
        "graph_count": len(graph_ids),
        "missing_in_graph": sorted(pg_ids - graph_ids),
        "orphaned_in_graph": sorted(graph_ids - pg_ids),
    }


# (PG fetch, Neo4j label, Neo4j id property, PG id attribute)
CHECKS: list = [
    ("TimelineEvent", ClinicalEvent, "event_id"),
    ("ConditionOccurrence", ConditionOccurrence, "condition_id"),
    ("Measurement", Measurement, "measurement_id"),
    ("PatientStatement", PatientStatement, "statement_id"),
    ("SleepEpisode", SleepPayload, "event_id"),
    ("ActivityEvent", ActivityPayload, "event_id"),
    ("NutritionIntake", NutritionPayload, "event_id"),
    ("MedicationTakenEvent", MedicationTakenEvent, "event_id"),
    ("Visit", Visit, "visit_id"),
    ("Medication", Medication, "medication_id"),
    ("MedicationRequest", Medication, "medication_id"),
    ("FoodScan", FoodScan, "scan_id"),
    ("PPGMeasurement", PpgMeasurement, "measurement_id"),
]


def _pg_ids(db, patient_id: uuid.UUID) -> dict[str, set]:
    out: dict[str, set] = {}
    out["TimelineEvent"] = set(db.scalars(
        select(ClinicalEvent.event_id).where(ClinicalEvent.patient_id == patient_id)).all())
    out["ConditionOccurrence"] = set(db.scalars(
        select(ConditionOccurrence.condition_id).where(ConditionOccurrence.patient_id == patient_id)).all())
    out["Measurement"] = set(db.scalars(
        select(Measurement.measurement_id).where(Measurement.patient_id == patient_id)).all())
    out["PatientStatement"] = set(db.scalars(
        select(PatientStatement.statement_id).where(PatientStatement.patient_id == patient_id)).all())
    for label, payload_model in (("SleepEpisode", SleepPayload), ("ActivityEvent", ActivityPayload),
                                 ("NutritionIntake", NutritionPayload)):
        out[label] = set(db.scalars(select(payload_model.event_id)
            .join(ClinicalEvent, ClinicalEvent.event_id == payload_model.event_id)
            .where(ClinicalEvent.patient_id == patient_id)).all())
    # Taken events exist on two PG paths: first-class rows (meds API) and
    # daily free-text payloads. The graph node id is the event id in both.
    out["MedicationTakenEvent"] = set(db.scalars(
        select(MedicationTakenEvent.event_id).where(MedicationTakenEvent.patient_id == patient_id)).all()
    ) | set(db.scalars(select(MedicationTakenPayload.event_id)
        .join(ClinicalEvent, ClinicalEvent.event_id == MedicationTakenPayload.event_id)
        .where(ClinicalEvent.patient_id == patient_id)).all())
    out["Visit"] = set(db.scalars(
        select(Visit.visit_id).where(Visit.patient_id == patient_id)).all())
    med_ids = set(db.scalars(
        select(Medication.medication_id).where(Medication.patient_id == patient_id)).all())
    out["Medication"] = set(med_ids)
    out["MedicationRequest"] = set(med_ids)
    out["FoodScan"] = set(db.scalars(
        select(FoodScan.scan_id).where(FoodScan.patient_id == patient_id)).all())
    out["PPGMeasurement"] = set(db.scalars(
        select(PpgMeasurement.measurement_id).where(PpgMeasurement.patient_id == patient_id)).all())
    return out


def check_patient(patient_id: uuid.UUID) -> dict:
    """Run all checks for one patient. Read-only on both stores."""
    db = SessionLocal()
    try:
        pg = _pg_ids(db, patient_id)
    finally:
        db.close()
    report: dict = {}
    with neo4j_driver.session() as session:
        for label, _model, _attr in CHECKS:
            # Ownership-anchored: only nodes reachable from THIS patient.
            # Shared labels (Concept etc.) are intentionally not checked here.
            recs = session.run(
                f"MATCH (p:Patient {{id: $patient_id}})-[]->(n:{label}) "
                "RETURN DISTINCT n.id AS nid",
                patient_id=str(patient_id),
            )
            graph_ids = {r["nid"] for r in recs if r["nid"]}
            diff = diff_projection(pg.get(label, set()), graph_ids)
            diff["label"] = label
            report[label] = diff
    return report


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python scripts/check_projection_integrity.py <patient_id>")
        return 2
    try:
        patient_id = uuid.UUID(sys.argv[1])
    except ValueError:
        print("Invalid patient_id UUID.")
        return 2
    report = check_patient(patient_id)
    print(f"Projection integrity for patient {patient_id} (read-only):")
    dirty = False
    for label, diff in report.items():
        missing = len(diff["missing_in_graph"])
        orphaned = len(diff["orphaned_in_graph"])
        flag = "" if (missing == 0 and orphaned == 0) else "  <-- ATTENTION"
        if flag:
            dirty = True
        print(f"  {label}: pg={diff['pg_count']} graph={diff['graph_count']} "
              f"missing={missing} orphaned={orphaned}{flag}")
    print("missing_in_graph → run the matching backfill; orphaned_in_graph → "
          "expected after pre-P5 corrections, clears only for newly retired rows.")
    return 0 if not dirty else 1


if __name__ == "__main__":
    raise SystemExit(main())
