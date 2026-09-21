# get_measurement_trend() -> Neo4j series routing + PostgreSQL truth + citations
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.measurements import Measurement
from models.clinical_assertion import NO_DATA_RECORDED, EvidenceLevel
from services.retrieval import hydrate as _hydrate
from services.retrieval.templates import CYPHER_MEASURE_TREND


def _direction(values: list[float]) -> str | None:
    """First-half vs second-half mean direction (SYSTEM_DERIVED, >=4 points)."""
    if len(values) < 4:
        return None
    mid = len(values) // 2
    first = sum(values[:mid]) / len(values[:mid])
    second = sum(values[mid:]) / len(values[mid:])
    if second > first * 1.05:
        return "rising"
    if second < first * 0.95:
        return "falling"
    return "stable"


def _get_measurement_trend(
    patient_id: uuid.UUID, query: str, series_key: str, limit: int, db: Session, driver
) -> List[Dict]:
    """Internal logic: resolve series -> Neo4j ordered routing -> PG truth."""
    if limit < 1 or limit > 100:
        return [{"error": "INVALID_LIMIT: limit must be between 1 and 100."}]

    key = (series_key or "").strip()
    if not key:
        if not query or not query.strip():
            return [{"error": "INVALID_QUERY: query or series_key is required."}]
        # Resolve by name match (patient-scoped PG truth).
        needle = query.strip()
        row = db.execute(
            select(Measurement.series_key)
            .where(
                Measurement.patient_id == patient_id,
                Measurement.name.ilike(f"%{needle}%"),
            )
            .order_by(Measurement.measured_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if not row:
            return [{"message": NO_DATA_RECORDED, "citations": []}]
        key = row

    points: list[dict] = []
    try:
        with driver.session() as session:
            result = session.run(
                CYPHER_MEASURE_TREND, patient_id=str(patient_id), series_key=key, limit=limit
            )
            for record in result:
                points.append(
                    {
                        "measurement_id": record["measurement_id"],
                        "measured_at": record["measured_at"],
                        "value_number": record["value_number"],
                        "value_text": record["value_text"],
                        "unit": record["unit"],
                        "interpretation": record["interpretation"],
                    }
                )
    except Exception:
        # Graph routing is best-effort; fall back to PG ordering below.
        points = []

    if not points:
        rows = (
            db.execute(
                select(Measurement)
                .where(Measurement.patient_id == patient_id, Measurement.series_key == key)
                .order_by(Measurement.measured_at.asc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        for m in rows:
            points.append(
                {
                    "measurement_id": str(m.measurement_id),
                    "measured_at": m.measured_at.isoformat() if m.measured_at else None,
                    "value_number": m.value_number,
                    "value_text": m.value_text,
                    "unit": m.unit,
                    "interpretation": m.interpretation,
                }
            )
    if not points:
        return [{"message": NO_DATA_RECORDED, "citations": []}]

    numbers = [p["value_number"] for p in points if p["value_number"] is not None]
    interp_counts: dict[str, int] = {}
    for p in points:
        interp_counts[p["interpretation"]] = interp_counts.get(p["interpretation"], 0) + 1
    first = points[0]
    last = points[-1]
    detail = None
    try:
        detail = _hydrate.hydrate_measurement_detail(db, patient_id, uuid.UUID(str(last["measurement_id"])))
    except Exception:
        detail = None
    return [
        {
            "series_key": key,
            "name": (detail["measurement"].name if detail else None),
            "unit": last["unit"],
            "reading_count": len(points),
            "first": first,
            "latest": last,
            "direction": _direction(numbers),
            "direction_note": "SYSTEM_DERIVED trend over >=4 numeric readings; not a clinical judgment.",
            "interpretation_counts": interp_counts,
            "series": points,
            "evidence_badge": detail["badge"] if detail else None,
            "citations": [detail["citation"].model_dump()] if detail else [],
            "evidence_level": EvidenceLevel.SYSTEM_DERIVED.value,
        }
    ]


@tool
def get_measurement_trend(query: str = "", series_key: str = "", limit: int = 20,
                           config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves the longitudinal series for a measurement (e.g. blood pressure,
    weight, glucose): ordered readings, latest value, interpretation counts,
    and a derived direction. Use for "how has X changed" questions.

    Args:
        query: Measurement name to search (e.g. "blood pressure").
        series_key: Exact series key when known (skips name resolution).
        limit: Max readings (1-100).
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_measurement_trend(patient_id, query, series_key, limit, db, neo4j_driver)
    finally:
        db.close()
