"""Day-backed temporal answer tool (P11, additive).

`get_day_timeline` answers longitudinal "what happened when" questions
from the P9 temporal graph (Patient → Day → events) with PostgreSQL
hydration per event. It is the first agent tool wired to the Day
graph; all other tools are untouched.

Grounding contract (same as the rest of the answer layer):
- Neo4j proposes structure (day groups, event ids, exact times).
- PostgreSQL disposes truth (per-event hydrate; hydrate returning
  None = deleted/missing → record skipped, never invented).
- Citations are copied verbatim from hydrated records only.
- FoodScan/PPGMeasurement have no PG hydrator: returned as
  graph-routing records explicitly marked `detail: None` (never
  upgraded into PG detail).
- Co-occurrence is reported as co-occurrence (see `note`); the
  synthesizer's no-causation rule (7d) governs prose, not this tool.
"""
import uuid
from typing import Dict, List

from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy.orm import Session

from core.db import SessionLocal
from core.neo4j_client import neo4j_driver
from models.clinical_assertion import NO_DATA_RECORDED
from services.retrieval import hydrate as _hydrate
from services.retrieval.day_range import query_day_range, resolve_window, classify_window

# Graph node kinds with a PG hydrator keyed by the graph id. Values are
# hydrator ATTRIBUTE names resolved against _hydrate at call time (so
# tests can substitute the module and production always uses PG truth).
_EVENT_HYDRATORS = {
    "TimelineEvent": "hydrate_event_detail",
    "SleepEpisode": "hydrate_event_detail",
    "ActivityEvent": "hydrate_event_detail",
    "NutritionIntake": "hydrate_event_detail",
    "MedicationTakenEvent": "hydrate_event_detail",
    "Observation": "hydrate_observation_detail",
    "Visit": "hydrate_visit_detail",
}
# Kinds returned as graph-routing records (no hydrator exists).
_GRAPH_ONLY_KINDS = {"FoodScan", "PPGMeasurement"}


def _parse_kinds(kinds: str | None) -> list[str] | None:
    if not kinds or not kinds.strip():
        return None
    return sorted({k.strip() for k in kinds.split(",") if k.strip()})


def _get_day_timeline(
    patient_id: uuid.UUID,
    start_date: str,
    end_date: str,
    kinds: list[str] | None,
    limit: int,
    db: Session,
    driver,
    window_preset: str = "",
) -> List[Dict]:
    """Day-graph retrieval + PG hydration (direct-callable core)."""
    try:
        groups = query_day_range(
            driver, patient_id, start_date, end_date,
            limit=limit, kinds=kinds,
        )
    except ValueError as e:
        return [{"error": f"INVALID_RANGE: {e}"}]
    # P14: explicit period metadata (same contract as the lifestyle
    # series): preset-driven ranges are lookbacks; explicit dates are
    # classified (a custom span is never a calendar month).
    if (window_preset or "").strip():
        period = {"label": window_preset.strip(),
                  "start_date": start_date, "end_date": end_date,
                  "retrieval_type": "lookback"}
    else:
        try:
            classified = classify_window(start_date, end_date)
        except ValueError as e:
            return [{"error": f"INVALID_RANGE: {e}"}]
        period = {"label": classified["label"],
                  "start_date": start_date, "end_date": end_date,
                  "retrieval_type": classified["retrieval_type"]}
    # P12: batched PG hydration. Collect ids per hydrator kind first
    # (2–3 round-trips total instead of ~5 per event), then assemble
    # the identical per-event records. Order, scoping, omission, and
    # citation behavior are unchanged (verified by before/after live
    # comparison + unit tests).
    event_ids: list[uuid.UUID] = []
    obs_ids: list[uuid.UUID] = []
    visit_ids: list[uuid.UUID] = []
    for group in groups:
        for ev in group["events"]:
            try:
                eid = uuid.UUID(ev["event_id"])
            except (ValueError, TypeError, KeyError):
                continue
            if ev["kind"] in _GRAPH_ONLY_KINDS or _EVENT_HYDRATORS.get(ev["kind"]) is None:
                continue
            if ev["kind"] == "Observation":
                obs_ids.append(eid)
            elif ev["kind"] == "Visit":
                visit_ids.append(eid)
            else:
                event_ids.append(eid)
    try:
        events = _hydrate.hydrate_events_batch(db, patient_id, event_ids)
        observations = _hydrate.hydrate_observations_batch(db, patient_id, obs_ids)
        visits = _hydrate.hydrate_visits_batch(db, patient_id, visit_ids)
    except Exception:
        events, observations, visits = {}, {}, {}
    details = {"event": events, "observation": observations, "visit": visits}
    days_out: List[Dict] = []
    citations: List[Dict] = []
    for group in groups:
        records: List[Dict] = []
        for ev in group["events"]:
            kind = ev["kind"]
            if kind in _GRAPH_ONLY_KINDS:
                records.append({
                    "kind": kind,
                    "event_id": ev["event_id"],
                    "exact_time": ev["exact_time"],
                    "detail": None,
                    "detail_note": "graph-routing record; no PG hydrator exists for this kind",
                })
                continue
            if _EVENT_HYDRATORS.get(kind) is None:
                continue
            try:
                eid = uuid.UUID(ev["event_id"])
            except (ValueError, TypeError, KeyError):
                continue
            bucket = "observation" if kind == "Observation" else ("visit" if kind == "Visit" else "event")
            detail = details[bucket].get(eid)
            if detail is None:
                continue  # deleted/missing lifecycle filtering by omission
            record = {
                "kind": kind,
                "event_id": ev["event_id"],
                "exact_time": ev["exact_time"],
                "detail": _summarize_detail(kind, detail),
            }
            records.append(record)
            citation = detail.get("citation")
            if citation is not None:
                citations.append(citation)
        if records:
            days_out.append({"day": group["day"], "records": records})
    if not days_out:
        return [{"message": NO_DATA_RECORDED, "citations": [],
                 "period": period}]
    return [{
        "window": {"start_date": start_date, "end_date": end_date},
        "period": period,
        "days": days_out,
        "citations": citations,
        "note": "Records co-occurred in time; co-occurrence is not causation.",
    }]


def _summarize_detail(kind: str, detail: dict) -> dict:
    """Minimal PG-truth summary (no invented fields)."""
    if kind == "Observation":
        obs = detail.get("observation")
        return {
            "finding": getattr(obs, "finding_display_name", None),
            "polarity": getattr(obs, "polarity", None),
            "recorded_at": str(getattr(obs, "recorded_at", None)),
            "badge": detail.get("badge"),
        }
    if kind == "Visit":
        visit = detail.get("visit")
        return {
            "visit_type": getattr(visit, "visit_type", None),
            "visit_date": str(getattr(visit, "visit_date", None)),
        }
    event = detail.get("event")
    return {
        "event_type": getattr(getattr(event, "event_type", None), "value", None),
        "polarity": getattr(event, "polarity", None),
        "event_time": str(getattr(event, "event_time", None)),
        "verification": getattr(event, "verification_status", None) and event.verification_status.value,
        "badge": detail.get("badge"),
    }


@tool
def get_day_timeline(
    start_date: str = "",
    end_date: str = "",
    window: str = "",
    kinds: str = "",
    limit: int = 100,
    config: RunnableConfig = None,
) -> List[Dict]:
    """
    Retrieves the patient's health events grouped by calendar day from
    the temporal graph, with PostgreSQL details per event. Use for
    "what happened on day X / this week / last month", longitudinal
    sleep/activity/food/PPG/medication questions, and cross-domain
    same-period questions.

    Each result carries an explicit `period` (label, start_date,
    end_date, retrieval_type). Refer to periods ONLY by these labels:
    a lookback window is never a calendar month.

    Args:
        start_date: window start as YYYY-MM-DD (used when window is empty).
        end_date: window end as YYYY-MM-DD (used when window is empty).
        window: preset (today, yesterday, last_7_days, last_30_days,
            last_2_months, last_6_months) or custom "YYYY-MM-DD:YYYY-MM-DD".
            Takes precedence over start_date/end_date when set.
        kinds: optional comma-separated graph labels to include
            (e.g. "SleepEpisode", "SleepEpisode,PPGMeasurement").
            Empty means all kinds.
        limit: max event rows (1-2000, default 100).
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))
    window_preset = (window or "").strip()
    try:
        if window_preset:
            start_date, end_date = resolve_window(window_preset)
    except ValueError as e:
        return [{"error": f"INVALID_RANGE: {e}"}]

    db: Session = SessionLocal()
    try:
        return _get_day_timeline(
            patient_id, start_date, end_date,
            _parse_kinds(kinds), limit, db, neo4j_driver,
            window_preset,
        )
    finally:
        db.close()
