"""Trends aggregation endpoint.

Provides aggregated health metrics for the Trends screen.
Read-only — no new data is created.
"""

import math
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.daily_logs.events import (
    SleepPayload,
    SymptomPayload,
    WellbeingPayload,
)
from models.events import ClinicalEvent, EventType, SourceType
from models.ontology import MedicalConcept

router = APIRouter(prefix="/api/v1/trends", tags=["trends"])


# ── Response schemas ───────────────────────────────────────────────────────


class DailyWellbeingPoint(BaseModel):
    date: str
    wellbeing: int | None = None
    energy: int | None = None
    stress: int | None = None


class DailySleepPoint(BaseModel):
    date: str
    duration_minutes: int | None = None
    sleep_quality: int | None = None


class SymptomSummary(BaseModel):
    concept_id: str | None = None
    display_name: str
    count: int
    avg_severity: float | None = None
    latest_date: str


class SymptomTimePoint(BaseModel):
    date: str
    severity: int


class SymptomTimeSeries(BaseModel):
    concept_id: str | None = None
    display_name: str
    points: list[SymptomTimePoint]


class MedicalRecordActivityPoint(BaseModel):
    date: str
    event_count: int


class ScatterPoint(BaseModel):
    x: float
    y: float
    date: str


class CorrelationResult(BaseModel):
    """Result of a Pearson correlation calculation."""
    paired_count: int
    r: float | None = None
    strength: str = "insufficient_data"  # "strong_positive" | "moderate_positive" | "weak" | "moderate_negative" | "strong_negative" | "insufficient_data"
    description: str = ""


class TrendIndicator(BaseModel):
    direction: str  # "improving" | "declining" | "stable" | "insufficient_data"
    label: str


class Insight(BaseModel):
    text: str


class TrendsResponse(BaseModel):
    period_days: int
    logged_days: int

    # Wellbeing
    wellbeing_points: list[DailyWellbeingPoint]
    avg_wellbeing: float | None = None
    avg_energy: float | None = None
    avg_stress: float | None = None
    wellbeing_trend: TrendIndicator

    # Sleep
    sleep_points: list[DailySleepPoint]
    avg_sleep_minutes: float | None = None
    min_sleep_minutes: int | None = None
    max_sleep_minutes: int | None = None
    avg_sleep_quality: float | None = None
    sleep_trend: TrendIndicator

    # Sleep-Energy correlation
    sleep_energy_scatter: list[ScatterPoint]
    sleep_energy_correlation: CorrelationResult

    # Sleep-Stress correlation
    sleep_stress_scatter: list[ScatterPoint]
    sleep_stress_correlation: CorrelationResult

    # Symptoms
    symptom_summaries: list[SymptomSummary]
    symptom_time_series: list[SymptomTimeSeries]
    available_symptoms: list[str]  # concept_ids that have time series

    # Activity
    documents_processed: int = 0
    clinical_events_extracted: int = 0
    medical_record_activity: list[MedicalRecordActivityPoint]

    # Insights
    insights: list[Insight]


# ── Helpers ────────────────────────────────────────────────────────────────


def _trend_indicator(values: list[float], min_points: int = 4) -> TrendIndicator:
    """Compare first-half average to second-half average."""
    if len(values) < min_points:
        return TrendIndicator(direction="insufficient_data", label="Not enough data yet")

    mid = len(values) // 2
    first_half = sum(values[:mid]) / len(values[:mid])
    second_half = sum(values[mid:]) / len(values[mid:])

    diff = second_half - first_half
    threshold = 0.3

    if diff > threshold:
        return TrendIndicator(direction="improving", label="Improving")
    elif diff < -threshold:
        return TrendIndicator(direction="declining", label="Declining")
    else:
        return TrendIndicator(direction="stable", label="Stable")


def _pearson_correlation(xs: list[float], ys: list[float]) -> tuple[float | None, str, str]:
    """Calculate Pearson r. Returns (r, strength_label, description).

    Minimum 5 paired observations required.
    """
    n = len(xs)
    if n < 5:
        return None, "insufficient_data", "Not enough paired data to assess this relationship."

    mean_x = sum(xs) / n
    mean_y = sum(ys) / n

    numerator = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    denom_x = math.sqrt(sum((x - mean_x) ** 2 for x in xs))
    denom_y = math.sqrt(sum((y - mean_y) ** 2 for y in ys))

    if denom_x == 0 or denom_y == 0:
        return None, "insufficient_data", "Not enough variation in the data to assess this relationship."

    r = numerator / (denom_x * denom_y)

    abs_r = abs(r)
    if abs_r >= 0.6:
        strength = "strong"
    elif abs_r >= 0.3:
        strength = "moderate"
    else:
        strength = "weak"

    direction = "positive" if r > 0 else "negative"

    if abs_r < 0.15:
        return round(r, 2), "weak", "No clear relationship was found in your recent data."
    elif abs_r < 0.3:
        return round(r, 2), "weak", f"A weak {direction} association was observed (r = {r:.2f})."
    elif abs_r < 0.6:
        return round(r, 2), f"moderate_{direction}", f"A moderate {direction} association was observed (r = {r:.2f})."
    else:
        return round(r, 2), f"strong_{direction}", f"A strong {direction} association was observed (r = {r:.2f})."


def _format_minutes(m: int) -> str:
    h = m // 60
    mins = m % 60
    if mins == 0:
        return f"{h}h"
    return f"{h}h {mins}m"


# ── Endpoint ───────────────────────────────────────────────────────────────


@router.get("", response_model=TrendsResponse)
def get_trends(
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id),
):
    """Aggregate daily check-in data for the Trends screen."""
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    # ── Fetch all patient-reported grouped events in the period ──────────
    events = db.scalars(
        select(ClinicalEvent)
        .where(
            ClinicalEvent.patient_id == patient_id,
            ClinicalEvent.source_type == SourceType.PATIENT_REPORTED,
            ClinicalEvent.group_id.isnot(None),
            ClinicalEvent.event_time >= cutoff,
        )
        .order_by(ClinicalEvent.event_time)
    ).all()

    # ── Organize by date ─────────────────────────────────────────────────
    daily_data: dict[date, dict] = {}

    for event in events:
        d = event.event_time.date()
        if d not in daily_data:
            daily_data[d] = {
                "wellbeing": None,
                "energy": None,
                "stress": None,
                "sleep_duration": None,
                "sleep_quality": None,
                "symptoms": [],
            }

        if event.event_type == EventType.WELLBEING_LOG:
            wb = db.get(WellbeingPayload, event.event_id)
            if wb:
                daily_data[d]["wellbeing"] = wb.overall_wellbeing
                daily_data[d]["energy"] = wb.energy_level
                daily_data[d]["stress"] = wb.stress_level

        elif event.event_type == EventType.SLEEP_LOG:
            sl = db.get(SleepPayload, event.event_id)
            if sl:
                daily_data[d]["sleep_duration"] = sl.duration_minutes
                daily_data[d]["sleep_quality"] = sl.sleep_quality

        elif event.event_type == EventType.SYMPTOM:
            sy = db.get(SymptomPayload, event.event_id)
            if sy:
                daily_data[d]["symptoms"].append({
                    "concept_id": str(event.concept_id) if event.concept_id else None,
                    "severity": sy.severity,
                    "date": d.isoformat(),
                })

    sorted_dates = sorted(daily_data.keys())

    # ── Build wellbeing points ───────────────────────────────────────────
    wellbeing_points = []
    wellbeing_values = []
    energy_values = []
    stress_values = []

    for d in sorted_dates:
        dd = daily_data[d]
        wellbeing_points.append(DailyWellbeingPoint(
            date=d.isoformat(),
            wellbeing=dd["wellbeing"],
            energy=dd["energy"],
            stress=dd["stress"],
        ))
        if dd["wellbeing"] is not None:
            wellbeing_values.append(float(dd["wellbeing"]))
        if dd["energy"] is not None:
            energy_values.append(float(dd["energy"]))
        if dd["stress"] is not None:
            stress_values.append(float(dd["stress"]))

    avg_wellbeing = round(sum(wellbeing_values) / len(wellbeing_values), 1) if wellbeing_values else None
    avg_energy = round(sum(energy_values) / len(energy_values), 1) if energy_values else None
    avg_stress = round(sum(stress_values) / len(stress_values), 1) if stress_values else None
    wellbeing_trend = _trend_indicator(wellbeing_values)

    # ── Build sleep points ───────────────────────────────────────────────
    sleep_points = []
    sleep_duration_values = []
    sleep_quality_values = []

    for d in sorted_dates:
        dd = daily_data[d]
        sleep_points.append(DailySleepPoint(
            date=d.isoformat(),
            duration_minutes=dd["sleep_duration"],
            sleep_quality=dd["sleep_quality"],
        ))
        if dd["sleep_duration"] is not None:
            sleep_duration_values.append(float(dd["sleep_duration"]))
        if dd["sleep_quality"] is not None:
            sleep_quality_values.append(float(dd["sleep_quality"]))

    avg_sleep_minutes = round(sum(sleep_duration_values) / len(sleep_duration_values)) if sleep_duration_values else None
    min_sleep_minutes = int(min(sleep_duration_values)) if sleep_duration_values else None
    max_sleep_minutes = int(max(sleep_duration_values)) if sleep_duration_values else None
    avg_sleep_quality = round(sum(sleep_quality_values) / len(sleep_quality_values), 1) if sleep_quality_values else None
    sleep_trend = _trend_indicator(sleep_duration_values)

    # ── Build scatter plots (paired observations) ────────────────────────
    sleep_energy_scatter = []
    sleep_stress_scatter = []
    se_xs, se_ys = [], []
    ss_xs, ss_ys = [], []

    for d in sorted_dates:
        dd = daily_data[d]
        if dd["sleep_duration"] is not None and dd["energy"] is not None:
            pt = ScatterPoint(x=dd["sleep_duration"], y=dd["energy"], date=d.isoformat())
            sleep_energy_scatter.append(pt)
            se_xs.append(float(dd["sleep_duration"]))
            se_ys.append(float(dd["energy"]))
        if dd["sleep_duration"] is not None and dd["stress"] is not None:
            pt = ScatterPoint(x=dd["sleep_duration"], y=dd["stress"], date=d.isoformat())
            sleep_stress_scatter.append(pt)
            ss_xs.append(float(dd["sleep_duration"]))
            ss_ys.append(float(dd["stress"]))

    se_r, se_strength, se_desc = _pearson_correlation(se_xs, se_ys)
    ss_r, ss_strength, ss_desc = _pearson_correlation(ss_xs, ss_ys)

    sleep_energy_correlation = CorrelationResult(
        paired_count=len(se_xs), r=se_r, strength=se_strength, description=se_desc
    )
    sleep_stress_correlation = CorrelationResult(
        paired_count=len(ss_xs), r=ss_r, strength=ss_strength, description=ss_desc
    )

    # ── Build symptom summaries and time series ──────────────────────────
    symptom_map: dict[str, dict] = {}
    symptom_timeseries_map: dict[str, list[SymptomTimePoint]] = {}

    for d in sorted_dates:
        for sym in daily_data[d]["symptoms"]:
            cid = sym["concept_id"] or "unknown"
            if cid not in symptom_map:
                display_name = "Unknown symptom"
                if sym["concept_id"]:
                    concept = db.get(MedicalConcept, UUID(sym["concept_id"]))
                    if concept:
                        display_name = concept.short_name or concept.display_name
                symptom_map[cid] = {
                    "concept_id": sym["concept_id"],
                    "display_name": display_name,
                    "count": 0,
                    "severities": [],
                    "latest_date": sym["date"],
                }
                symptom_timeseries_map[cid] = []
            symptom_map[cid]["count"] += 1
            if sym["severity"] is not None:
                symptom_map[cid]["severities"].append(sym["severity"])
                symptom_timeseries_map[cid].append(
                    SymptomTimePoint(date=sym["date"], severity=sym["severity"])
                )
            if sym["date"] > symptom_map[cid]["latest_date"]:
                symptom_map[cid]["latest_date"] = sym["date"]

    symptom_summaries = sorted(
        [
            SymptomSummary(
                concept_id=v["concept_id"],
                display_name=v["display_name"],
                count=v["count"],
                avg_severity=round(sum(v["severities"]) / len(v["severities"]), 1) if v["severities"] else None,
                latest_date=v["latest_date"],
            )
            for v in symptom_map.values()
        ],
        key=lambda s: s.count,
        reverse=True,
    )

    symptom_time_series = [
        SymptomTimeSeries(
            concept_id=symptom_map[cid]["concept_id"],
            display_name=symptom_map[cid]["display_name"],
            points=symptom_timeseries_map[cid],
        )
        for cid in symptom_timeseries_map
        if symptom_timeseries_map[cid]  # only include symptoms with severity data
    ]

    available_symptoms = [ts.concept_id for ts in symptom_time_series if ts.concept_id]

    # ── Medical record activity ──────────────────────────────────────────
    activity_events = db.scalars(
        select(ClinicalEvent)
        .where(
            ClinicalEvent.patient_id == patient_id,
            ClinicalEvent.source_type != SourceType.PATIENT_REPORTED,
            ClinicalEvent.event_time >= cutoff,
        )
    ).all()

    activity_by_date: dict[date, int] = {}
    for event in activity_events:
        event_date = event.event_time.date()
        activity_by_date[event_date] = activity_by_date.get(event_date, 0) + 1

    doc_event_ids = set(ev.event_id for ev in activity_events if ev.event_id)
    from models.events import EvidenceLink
    doc_refs = db.scalars(
        select(EvidenceLink.document_id)
        .where(EvidenceLink.event_id.in_(doc_event_ids))
        .distinct()
    ).all()

    # ── Generate insights ────────────────────────────────────────────────
    insights: list[Insight] = []

    if wellbeing_values:
        insights.append(Insight(
            text=f"Your average wellbeing was {avg_wellbeing}/5 over the last {days} days."
        ))

    if stress_values:
        insights.append(Insight(
            text=f"Stress was logged on {len(stress_values)} of {days} days."
        ))

    if sleep_duration_values and min_sleep_minutes is not None and max_sleep_minutes is not None:
        insights.append(Insight(
            text=f"Sleep duration varied between {_format_minutes(min_sleep_minutes)} and {_format_minutes(max_sleep_minutes)}."
        ))

    if se_r is not None and se_strength != "weak":
        insights.append(Insight(text=se_desc))

    if ss_r is not None and ss_strength != "weak":
        insights.append(Insight(text=ss_desc))

    if symptom_summaries:
        top = symptom_summaries[0]
        insights.append(Insight(
            text=f"Your most frequently logged symptom is {top.display_name} ({top.count} times)."
        ))

    return TrendsResponse(
        period_days=days,
        logged_days=len(daily_data),
        wellbeing_points=wellbeing_points,
        avg_wellbeing=avg_wellbeing,
        avg_energy=avg_energy,
        avg_stress=avg_stress,
        wellbeing_trend=wellbeing_trend,
        sleep_points=sleep_points,
        avg_sleep_minutes=avg_sleep_minutes,
        min_sleep_minutes=min_sleep_minutes,
        max_sleep_minutes=max_sleep_minutes,
        avg_sleep_quality=avg_sleep_quality,
        sleep_trend=sleep_trend,
        sleep_energy_scatter=sleep_energy_scatter,
        sleep_energy_correlation=sleep_energy_correlation,
        sleep_stress_scatter=sleep_stress_scatter,
        sleep_stress_correlation=sleep_stress_correlation,
        symptom_summaries=symptom_summaries,
        symptom_time_series=symptom_time_series,
        available_symptoms=available_symptoms,
        documents_processed=len(doc_refs),
        clinical_events_extracted=len(activity_events),
        medical_record_activity=[
            MedicalRecordActivityPoint(date=d.isoformat(), event_count=count)
            for d, count in sorted(activity_by_date.items())
        ],
        insights=insights,
    )
