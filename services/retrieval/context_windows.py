"""P4 cross-domain time-window retrieval (context around an anchor).

Composition layer over existing primitives — no new trend logic, no new
hydrates, no new SQL shapes beyond range predicates that already exist:

    anchor (medication start | calendar day | PPG session | measurement)
      → window [anchor - before, anchor + after] (default 7/7, cap 62d total)
      → Neo4j T-VISIT-RANGE routing (visit-grouped member ids)
      → PostgreSQL truth per domain (existing hydrate_* functions)
      → merged citations (verbatim, per-fact evidence levels preserved)

Layering: services must not import agents, so the small PG range fetchers
here duplicate the thin queries in agents/tools/lifestyle.py instead of
importing its privates. The grouping itself is SYSTEM_DERIVED; every
member fact keeps its own USER_REPORTED / SOURCE_FACT / SYSTEM_DERIVED
badge. Temporal co-occurrence is NEVER causation (no causal edges).
"""
import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from models.clinical_assertion import EvidenceLevel, NO_DATA_RECORDED
from models.conditions import ConditionOccurrence
from models.daily_logs.events import ActivityPayload, NutritionPayload, SleepPayload
from models.events import ClinicalEvent
from models.food import FoodEntry, FoodScan
from models.measurements import Measurement
from models.medications import Medication
from models.ppg import PpgMeasurement
from models.statements import PatientStatement
from models.visits import Visit
from services.retrieval import hydrate as _hydrate
from services.retrieval.templates import CYPHER_VISIT_RANGE

_ANCHOR_TYPES = ("medication", "log_date", "ppg", "measurement")
_DEFAULT_BEFORE_DAYS = 7
_DEFAULT_AFTER_DAYS = 7
_MAX_WINDOW_DAYS = 62
_PER_DOMAIN_CAP = 15


def resolve_anchor(db: Session, patient_id: uuid.UUID, anchor_type: str, anchor_ref: str) -> dict | None:
    """Resolve an anchor to {kind, label, anchor_date, detail} or None."""
    anchor_type = (anchor_type or "").strip().lower()
    ref = (anchor_ref or "").strip()
    if anchor_type not in _ANCHOR_TYPES or not ref:
        return None
    if anchor_type == "log_date":
        try:
            day = date.fromisoformat(ref)
        except ValueError:
            return None
        return {"kind": "log_date", "label": day.isoformat(), "anchor_date": day, "detail": {}}
    if anchor_type == "medication":
        med = db.execute(
            select(Medication)
            .where(Medication.patient_id == patient_id,
                   Medication.name.ilike(f"%{ref}%"))
            .order_by(Medication.start_date.desc().nullslast())
            .limit(1)
        ).scalar_one_or_none()
        if med is None:
            return None
        anchor_day = med.start_date or (med.created_at.date() if getattr(med, "created_at", None) else None)
        if anchor_day is None:
            return None
        return {"kind": "medication", "label": med.name,
                "anchor_date": anchor_day,
                "detail": {"medication_id": str(med.medication_id),
                           "start_date": med.start_date.isoformat() if med.start_date else None}}
    if anchor_type == "ppg":
        try:
            mid = uuid.UUID(ref)
        except ValueError:
            return None
        row = db.scalar(
            select(PpgMeasurement).where(
                PpgMeasurement.measurement_id == mid, PpgMeasurement.patient_id == patient_id)
        )
        if row is None or row.measured_at is None:
            return None
        return {"kind": "ppg", "label": f"PPG session {row.measured_at.date().isoformat()}",
                "anchor_date": row.measured_at.date(),
                "detail": {"measurement_id": str(row.measurement_id)}}
    if anchor_type == "measurement":
        try:
            mid = uuid.UUID(ref)
        except ValueError:
            return None
        m = db.scalar(
            select(Measurement).where(
                Measurement.measurement_id == mid, Measurement.patient_id == patient_id)
        )
        if m is None or m.measured_at is None:
            return None
        return {"kind": "measurement", "label": m.name,
                "anchor_date": m.measured_at.date(),
                "detail": {"measurement_id": str(m.measurement_id)}}
    return None


def build_window(anchor_day: date, before_days: int, after_days: int) -> tuple[date, date] | None:
    """Pure date math (SYSTEM_DERIVED grouping); None when out of bounds."""
    try:
        before = int(before_days)
        after = int(after_days)
    except (TypeError, ValueError):
        return None
    if before < 0 or after < 0 or before + after > _MAX_WINDOW_DAYS:
        return None
    return anchor_day - timedelta(days=before), anchor_day + timedelta(days=after)


def _day_bounds(start: date, end: date) -> tuple[datetime, datetime]:
    return (datetime.combine(start, dtime.min).replace(tzinfo=timezone.utc),
            datetime.combine(end, dtime.max).replace(tzinfo=timezone.utc))


def fetch_window(db: Session, driver, patient_id: uuid.UUID, start: date, end: date) -> dict:
    """Cross-domain window fetch: Neo4j routing + PG truth + citations."""
    start_dt, end_dt = _day_bounds(start, end)
    domains: dict = {}
    citations: list = []

    def _cite(c):
        if c is not None:
            citations.append(c.model_dump() if hasattr(c, "model_dump") else c)

    # Neo4j routing: visit-grouped member ids in the window.
    visit_groups: list = []
    try:
        with driver.session() as session:
            result = session.run(
                CYPHER_VISIT_RANGE,
                patient_id=str(patient_id),
                start_date=start.isoformat(),
                end_date=end.isoformat(),
                limit=31,
            )
            for record in result:
                visit_groups.append({
                    "visit_date": record["visit_date"],
                    "member_count": len(record["member_ids"] or []),
                    "member_ids": (record["member_ids"] or [])[:20],
                })
    except Exception:
        visit_groups = []
    domains["visits"] = visit_groups
    # P6: tag PG rows with their visit date from routing (no new queries;
    # T-VISIT-RANGE member ids are the join key). Pure grouping metadata.
    _visit_of: dict[str, str] = {}
    for _g in visit_groups:
        for _mid in _g["member_ids"]:
            _visit_of.setdefault(str(_mid), str(_g["visit_date"]))

    # Documents created in the window (PG truth; DELETED rows excluded
    # from normal retrieval — history stays available via export).
    from models.events import Document as _Document

    _docs = (
        db.execute(
            select(_Document)
            .where(_Document.patient_id == patient_id,
                   _Document.status != "DELETED")
            .order_by(_Document.created_at.desc())
            .limit(200)
        ).scalars().all()
    )
    domains["documents"] = [
        {"document_id": str(d.document_id), "status": d.status,
         "created_at": d.created_at.isoformat() if d.created_at else None}
        for d in _docs
        if d.created_at is not None and start <= d.created_at.date() <= end
    ][:_PER_DOMAIN_CAP]

    # Conditions with onset/recorded in the window.
    conds = (
        db.execute(
            select(ConditionOccurrence)
            .where(ConditionOccurrence.patient_id == patient_id,
                   ConditionOccurrence.recorded_at >= start_dt,
                   ConditionOccurrence.recorded_at <= end_dt)
            .order_by(ConditionOccurrence.recorded_at.asc())
            .limit(_PER_DOMAIN_CAP)
        ).scalars().all()
    )
    domains["conditions"] = [
        {"condition_id": str(c.condition_id), "name": c.name,
         "polarity": c.polarity, "verification": c.assertion_verification,
         "onset_date": c.onset_date.isoformat() if c.onset_date else None,
         "visit_date": _visit_of.get(str(c.condition_id))}
        for c in conds
    ]
    # P7: one batched document join instead of per-condition hydrates
    # (N+1 → 2 queries). Citations carry the same fields the detail
    # hydrator would emit for these rows.
    if conds:
        from models.events import Document as _Doc2

        _cond_docs = {
            c.condition_id: d for c, d in db.execute(
                select(ConditionOccurrence, _Doc2)
                .outerjoin(_Doc2, _Doc2.document_id == ConditionOccurrence.source_document_id)
                .where(ConditionOccurrence.condition_id.in_([c.condition_id for c in conds]))
            ).all()
        }
        for c in conds:
            d = _cond_docs.get(c.condition_id)
            if d is not None and d.patient_id != patient_id:
                d = None  # never cite another patient's document
            _cite(_hydrate._evidence_citation(
                node_id=f"condition_occurrence:{c.condition_id}",
                event_id=c.source_event_id,
                document=d,
                quote=c.evidence_text,
                verification_status=c.verification_status,
                source_type=c.source_type,
            ))

    # Measurements in the window, grouped by series.
    measures = (
        db.execute(
            select(Measurement)
            .where(Measurement.patient_id == patient_id,
                   Measurement.measured_at >= start_dt,
                   Measurement.measured_at <= end_dt)
            .order_by(Measurement.measured_at.asc())
            .limit(60)
        ).scalars().all()
    )
    by_series: dict = {}
    for m in measures:
        by_series.setdefault(m.series_key, {"name": m.name, "unit": m.unit, "readings": []})
        if len(by_series[m.series_key]["readings"]) < 20:
            by_series[m.series_key]["readings"].append({
                "measurement_id": str(m.measurement_id),
                "measured_at": m.measured_at.isoformat() if m.measured_at else None,
                "value_text": m.value_text, "value_number": m.value_number,
                "interpretation": m.interpretation,
                "visit_date": _visit_of.get(str(m.measurement_id)),
            })
    domains["measurements"] = by_series

    # Lifestyle payloads in the window (sleep/activity/nutrition).
    domains["sleep"] = _payload_series(db, patient_id, start_dt, end_dt, SleepPayload,
                                       lambda p: {"duration_minutes": p.duration_minutes,
                                                  "sleep_quality": p.sleep_quality,
                                                  "awakenings": p.awakenings}, _visit_of)
    domains["activity"] = _payload_series(db, patient_id, start_dt, end_dt, ActivityPayload,
                                          lambda p: {"activity_type": p.activity_type,
                                                     "duration_minutes": p.duration_minutes,
                                                     "calories_burned": p.calories_burned}, _visit_of)
    domains["nutrition"] = _payload_series(db, patient_id, start_dt, end_dt, NutritionPayload,
                                           lambda p: {"water_ml": p.water_ml,
                                                      "meals_count": p.meals_count,
                                                      "calories_kcal": p.calories_kcal,
                                                      "food_label": p.food_label}, _visit_of)

    # Food scans + PPG sessions in the window.
    scans = (
        db.execute(
            select(FoodScan)
            .where(FoodScan.patient_id == patient_id,
                   FoodScan.recorded_at >= start_dt,
                   FoodScan.recorded_at <= end_dt)
            .order_by(FoodScan.recorded_at.asc())
            .limit(_PER_DOMAIN_CAP)
        ).scalars().all()
    )
    domains["food"] = [{"scan_id": str(s.scan_id), "status": s.status,
                        "total_kcal": s.total_kcal,
                        "recorded_at": s.recorded_at.isoformat() if s.recorded_at else None}
                       for s in scans]

    ppgs = (
        db.execute(
            select(PpgMeasurement)
            .where(PpgMeasurement.patient_id == patient_id,
                   PpgMeasurement.measured_at >= start_dt,
                   PpgMeasurement.measured_at <= end_dt)
            .order_by(PpgMeasurement.measured_at.asc())
            .limit(_PER_DOMAIN_CAP)
        ).scalars().all()
    )
    domains["biometric"] = [{"measurement_id": str(r.measurement_id),
                             "method": r.measurement_type,
                             "heart_rate_bpm": r.heart_rate_bpm,
                             "measured_at": r.measured_at.isoformat() if r.measured_at else None}
                            for r in ppgs]

    # Patient statements in the window.
    stmts = (
        db.execute(
            select(PatientStatement)
            .where(PatientStatement.patient_id == patient_id,
                   PatientStatement.recorded_at >= start_dt,
                   PatientStatement.recorded_at <= end_dt)
            .order_by(PatientStatement.recorded_at.asc())
            .limit(_PER_DOMAIN_CAP)
        ).scalars().all()
    )
    domains["statements"] = [{"statement_id": str(s.statement_id),
                              "text": (s.original_text or "")[:200],
                              "visit_date": _visit_of.get(str(s.statement_id))}
                             for s in stmts]

    # Medications starting in the window.
    meds = (
        db.execute(
            select(Medication)
            .where(Medication.patient_id == patient_id,
                   Medication.start_date >= start,
                   Medication.start_date <= end)
            .order_by(Medication.start_date.asc())
            .limit(_PER_DOMAIN_CAP)
        ).scalars().all()
    )
    domains["medications_started"] = [
        {"medication_id": str(m.medication_id),
         "name": m.name,
         "start_date": m.start_date.isoformat() if m.start_date else None,
         # P6: purpose linkage answers "condition + medication" without a
         # second query (explicit PG links only — never inferred). Requests
         # carry no OCCURRED_DURING edge (a regimen order is not an
         # encounter), so no visit_date is attached — see audit §7.
         "purpose_condition_id": str(m.purpose_condition_id) if m.purpose_condition_id else None,
         "purpose": m.purpose}
        for m in meds]

    return {"domains": domains, "citations": citations}


def _payload_series(db: Session, patient_id: uuid.UUID, start_dt: datetime, end_dt: datetime,
                    payload_model, pick, visit_of: dict | None = None) -> list:
    rows = (
        db.execute(
            select(ClinicalEvent, payload_model)
            .join(payload_model, payload_model.event_id == ClinicalEvent.event_id)
            .where(ClinicalEvent.patient_id == patient_id,
                   ClinicalEvent.event_time >= start_dt,
                   ClinicalEvent.event_time <= end_dt)
            .order_by(ClinicalEvent.event_time.asc())
            .limit(60)
        ).all()
    )
    return [{"event_id": str(e.event_id),
             "date": e.event_time.date().isoformat() if e.event_time else None,
             "visit_date": (visit_of or {}).get(str(e.event_id)),
             **pick(p)} for e, p in rows]


def get_context_around(db: Session, driver, patient_id: uuid.UUID, anchor_type: str,
                       anchor_ref: str, before_days: int = _DEFAULT_BEFORE_DAYS,
                       after_days: int = _DEFAULT_AFTER_DAYS) -> dict:
    """Anchor → window → cross-domain fetch. No-data when anchor unresolvable."""
    anchor = resolve_anchor(db, patient_id, anchor_type, anchor_ref)
    if anchor is None:
        return {"message": NO_DATA_RECORDED, "citations": []}
    window = build_window(anchor["anchor_date"], before_days, after_days)
    if window is None:
        return {"error": f"INVALID_WINDOW: before+after must total 0-{_MAX_WINDOW_DAYS} days, both >= 0."}
    start, end = window
    fetched = fetch_window(db, driver, patient_id, start, end)
    return {
        "anchor": {"type": anchor["kind"], "label": anchor["label"],
                   "date": anchor["anchor_date"].isoformat(), **anchor["detail"]},
        "window": {"start": start.isoformat(), "end": end.isoformat(),
                   "evidence_level": EvidenceLevel.SYSTEM_DERIVED.value,
                   "note": "Temporal co-occurrence only — not causation."},
        **fetched,
    }
