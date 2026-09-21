# get_lifestyle_series() + get_daily_log() -> PostgreSQL truth + citations
import uuid
from datetime import date, datetime, time as dtime, timedelta, timezone
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from models.daily_logs.events import ActivityPayload, NutritionPayload, SleepPayload
from models.events import ClinicalEvent, EventType
from models.food import FoodEntry, FoodScan
from models.ppg import PpgMeasurement
from models.clinical_assertion import NO_DATA_RECORDED, EvidenceLevel
from services.retrieval import hydrate as _hydrate

_DOMAINS = ("sleep", "activity", "nutrition", "biometric", "food")


def _window(days: int) -> tuple[datetime, datetime]:
    if days < 1 or days > 365:
        raise ValueError("days must be between 1 and 365.")
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    return start, now


def _series_sleep(db: Session, patient_id: uuid.UUID, start: datetime, end: datetime, limit: int) -> dict:
    rows = (
        db.execute(
            select(ClinicalEvent, SleepPayload)
            .join(SleepPayload, SleepPayload.event_id == ClinicalEvent.event_id)
            .where(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= start,
                ClinicalEvent.event_time <= end,
            )
            .order_by(ClinicalEvent.event_time.asc())
            .limit(limit)
        ).all()
    )
    points = [
        {
            "event_id": str(e.event_id),
            "date": e.event_time.date().isoformat() if e.event_time else None,
            "duration_minutes": p.duration_minutes,
            "sleep_quality": p.sleep_quality,
            "awakenings": p.awakenings,
        }
        for e, p in rows
    ]
    durations = [p["duration_minutes"] for p in points if p["duration_minutes"] is not None]
    return {
        "domain": "sleep",
        "evidence_level": EvidenceLevel.USER_REPORTED.value,
        "reading_count": len(points),
        "avg_duration_minutes": round(sum(durations) / len(durations)) if durations else None,
        "series": points,
        "citations": [{"node_id": f"sleep_episode:{p['event_id']}"} for p in points[-5:]],
    }


def _series_activity(db: Session, patient_id: uuid.UUID, start: datetime, end: datetime, limit: int) -> dict:
    rows = (
        db.execute(
            select(ClinicalEvent, ActivityPayload)
            .join(ActivityPayload, ActivityPayload.event_id == ClinicalEvent.event_id)
            .where(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= start,
                ClinicalEvent.event_time <= end,
            )
            .order_by(ClinicalEvent.event_time.asc())
            .limit(limit)
        ).all()
    )
    points = [
        {
            "event_id": str(e.event_id),
            "date": e.event_time.date().isoformat() if e.event_time else None,
            "activity_type": p.activity_type,
            "duration_minutes": p.duration_minutes,
            "calories_burned": p.calories_burned,
        }
        for e, p in rows
    ]
    total_min = sum(p["duration_minutes"] or 0 for p in points)
    return {
        "domain": "activity",
        "evidence_level": EvidenceLevel.USER_REPORTED.value,
        "reading_count": len(points),
        "total_duration_minutes": total_min,
        "series": points,
        "citations": [{"node_id": f"activity_event:{p['event_id']}"} for p in points[-5:]],
    }


def _series_nutrition(db: Session, patient_id: uuid.UUID, start: datetime, end: datetime, limit: int) -> dict:
    rows = (
        db.execute(
            select(ClinicalEvent, NutritionPayload)
            .join(NutritionPayload, NutritionPayload.event_id == ClinicalEvent.event_id)
            .where(
                ClinicalEvent.patient_id == patient_id,
                ClinicalEvent.event_time >= start,
                ClinicalEvent.event_time <= end,
            )
            .order_by(ClinicalEvent.event_time.asc())
            .limit(limit)
        ).all()
    )
    points = [
        {
            "event_id": str(e.event_id),
            "date": e.event_time.date().isoformat() if e.event_time else None,
            "water_ml": p.water_ml,
            "meals_count": p.meals_count,
            "appetite_level": p.appetite_level,
            "calories_kcal": p.calories_kcal,
            "food_label": p.food_label,
        }
        for e, p in rows
    ]
    kcals = [p["calories_kcal"] for p in points if p["calories_kcal"] is not None]
    return {
        "domain": "nutrition",
        "evidence_level": EvidenceLevel.USER_REPORTED.value,
        "reading_count": len(points),
        "avg_calories_kcal": round(sum(kcals) / len(kcals)) if kcals else None,
        "series": points,
        "citations": [{"node_id": f"nutrition_intake:{p['event_id']}"} for p in points[-5:]],
    }


def _series_biometric(db: Session, patient_id: uuid.UUID, start: datetime, end: datetime, limit: int) -> dict:
    rows = (
        db.execute(
            select(PpgMeasurement)
            .where(
                PpgMeasurement.patient_id == patient_id,
                PpgMeasurement.measured_at >= start,
                PpgMeasurement.measured_at <= end,
            )
            .order_by(PpgMeasurement.measured_at.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    points = [
        {
            "measurement_id": str(r.measurement_id),
            "measured_at": r.measured_at.isoformat() if r.measured_at else None,
            "method": r.measurement_type,
            "heart_rate_bpm": r.heart_rate_bpm,
            "rmssd_ms": r.rmssd_ms,
            "sdnn_ms": r.sdnn_ms,
            "signal_quality": r.signal_quality,
            "reliable": r.reliable,
        }
        for r in rows
    ]
    hrs = [p["heart_rate_bpm"] for p in points if p["heart_rate_bpm"] is not None]
    return {
        "domain": "biometric",
        "evidence_level": EvidenceLevel.SYSTEM_DERIVED.value,
        "reading_count": len(points),
        "latest_heart_rate_bpm": hrs[-1] if hrs else None,
        "series": points,
        "hrv_note": "HRV fields are present only for fingertip sessions; face sessions report null by design.",
        "citations": [{"node_id": f"ppg_measurement:{p['measurement_id']}"} for p in points[-5:]],
    }


def _series_food(db: Session, patient_id: uuid.UUID, start: datetime, end: datetime, limit: int) -> dict:
    scans = (
        db.execute(
            select(FoodScan)
            .where(
                FoodScan.patient_id == patient_id,
                FoodScan.recorded_at >= start,
                FoodScan.recorded_at <= end,
            )
            .order_by(FoodScan.recorded_at.asc())
            .limit(limit)
        )
        .scalars()
        .all()
    )
    out = []
    # P7: cap scans (callers pass ≤100) and entries per scan — the series
    # response must stay bounded for the LLM context window.
    for s in scans[:30]:
        entries = (
            db.execute(select(FoodEntry).where(FoodEntry.scan_id == s.scan_id).limit(50)).scalars().all()
        )
        out.append(
            {
                "scan_id": str(s.scan_id),
                "recorded_at": s.recorded_at.isoformat() if s.recorded_at else None,
                "status": s.status,
                "total_kcal": s.total_kcal,
                "entries": [
                    {
                        "label": e.corrected_label if e.corrected and e.corrected_label else e.label,
                        "original_label": e.label,
                        "kcal": e.kcal,
                        "corrected": e.corrected,
                    }
                    for e in entries
                ],
            }
        )
    return {
        "domain": "food",
        "evidence_level": f"{EvidenceLevel.AI_INFERRED.value} until user-confirmed/corrected",
        "reading_count": len(out),
        "series": out,
        "citations": [{"node_id": f"food_scan:{s['scan_id']}"} for s in out[-5:]],
    }


def _get_lifestyle_series(patient_id: uuid.UUID, domain: str, days: int,
                           db: Session) -> List[Dict]:
    domain = (domain or "").strip().lower()
    if domain not in _DOMAINS:
        return [{"error": f"INVALID_DOMAIN: domain must be one of {', '.join(_DOMAINS)}."}]
    try:
        start, end = _window(days)
    except ValueError as e:
        return [{"error": f"INVALID_RANGE: {e}"}]
    fn = {
        "sleep": _series_sleep, "activity": _series_activity, "nutrition": _series_nutrition,
        "biometric": _series_biometric, "food": _series_food,
    }[domain]
    result = fn(db, patient_id, start, end, 100)
    # P14: explicit period metadata so the synthesizer never renames a
    # lookback window into a calendar month ("last 30 days" is not
    # "August"). Labels/dates here are the only period names the
    # answer may use.
    result["period"] = {
        "label": f"last {days} days",
        "start_date": start.date().isoformat(),
        "end_date": end.date().isoformat(),
        "retrieval_type": "lookback",
    }
    if not result["reading_count"]:
        return [{"message": NO_DATA_RECORDED, "citations": [],
                 "period": result["period"]}]
    return [result]


def _get_daily_log(patient_id: uuid.UUID, log_date: str, db: Session) -> List[Dict]:
    try:
        day = date.fromisoformat((log_date or "").strip())
    except ValueError:
        return [{"error": "INVALID_DATE: log_date must be YYYY-MM-DD."}]
    detail = _hydrate.hydrate_daily_log_day(db, patient_id, day)
    if not detail["event_count"]:
        return [{"message": NO_DATA_RECORDED, "citations": []}]
    return [detail]


@tool
def get_lifestyle_series(domain: str, days: int = 30, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves a longitudinal lifestyle series for one domain over N days:
    sleep (duration/quality), activity (type/duration), nutrition
    (water/meals/kcal), biometric (PPG/rPPG heart rate), or food (scans).
    All values are stored patient data; trends are statistical summaries.
    The result carries an explicit `period` (label "last N days",
    start/end dates, retrieval_type "lookback"): refer to it ONLY by
    that label — it is never a calendar month.

    Args:
        domain: one of sleep, activity, nutrition, biometric, food.
        days: lookback window, 1-365 (default 30).
    """
    from langchain_core.runnables import RunnableConfig  # noqa: F401 (type only)

    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_lifestyle_series(patient_id, domain, days, db)
    finally:
        db.close()


@tool
def get_daily_log(log_date: str, config: RunnableConfig = None) -> List[Dict]:
    """
    Retrieves everything the patient logged on one calendar day: sections
    present, per-type event ids, and the day's visit. Use for "what did I
    log on the day I started X" questions.

    Args:
        log_date: calendar day as YYYY-MM-DD.
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")

    patient_id = uuid.UUID(str(patient_id_str))

    db: Session = SessionLocal()
    try:
        return _get_daily_log(patient_id, log_date, db)
    finally:
        db.close()
