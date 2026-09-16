from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.daily_logs.events import ActivityPayload, PainPayload, SleepPayload, VitalSignPayload, WellbeingPayload
from models.events import ClinicalEvent, EventType, SourceType
from models.ontology import MedicalConcept
from schemas.daily_metrics import ActivityMetric, DailyMetricsResponse, LatestVitalMetric, PainMetric, RecentDailyLog, SleepMetric, WellbeingMetric

router = APIRouter(prefix="/api/v1/daily-metrics", tags=["daily_metrics"])


@router.get("", response_model=DailyMetricsResponse)
def get_daily_metrics(
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id),
) -> DailyMetricsResponse:
    """Read daily clinical logs for Home; anatomical state is intentionally excluded."""
    patient_events = db.scalars(
        select(ClinicalEvent)
        .where(ClinicalEvent.patient_id == patient_id, ClinicalEvent.source_type == SourceType.PATIENT_REPORTED)
        .order_by(desc(ClinicalEvent.event_time))
    ).all()

    latest_vitals: list[LatestVitalMetric] = []
    seen_concepts: set[UUID] = set()
    today_wellbeing: WellbeingMetric | None = None
    latest_pain: PainMetric | None = None
    latest_sleep: SleepMetric | None = None
    today_activity: ActivityMetric | None = None
    activity_duration_minutes = 0
    activity_calories_burned = 0.0
    activity_count = 0
    latest_activity_time = None
    daily_groups: dict[tuple[object, UUID | None], set[str]] = defaultdict(set)
    daily_counts: dict[tuple[object, UUID | None], int] = defaultdict(int)
    today = datetime.now(timezone.utc).date()

    # Two-phase read (same semantics, no N+1): the scan below records only
    # event IDs; payloads/concepts are then fetched with bulk IN queries
    # (PK-indexed) instead of one db.get per event.
    vital_hits: list[tuple] = []  # (event_id, concept_id, event_time), scan order
    wellbeing_hit = None  # (event_id, event_time)
    pain_hit = None  # (event_id, event_time)
    sleep_hit = None  # (event_id, event_time)
    activity_event_ids: list = []

    for event in patient_events:
        event_date = event.event_time.date()
        # Daily-checkin events share a group_id. Standalone clinical/anatomical
        # events are intentionally not presented as a daily log summary.
        if event.group_id is not None:
            group_key = (event_date, event.group_id)
            daily_counts[group_key] += 1
            daily_groups[group_key].add(event.event_type.value)

        if event.event_type == EventType.VITAL_SIGN:
            vital_hits.append((event.event_id, event.concept_id, event.event_time))

        if event.event_type == EventType.WELLBEING_LOG and wellbeing_hit is None and event_date == today:
            wellbeing_hit = (event.event_id, event.event_time)

        if event.event_type == EventType.PAIN_LOG and pain_hit is None:
            pain_hit = (event.event_id, event.event_time)

        if event.event_type == EventType.SLEEP_LOG and sleep_hit is None:
            sleep_hit = (event.event_id, event.event_time)

        if event.event_type == EventType.ACTIVITY_LOG and event_date == today:
            activity_event_ids.append(event.event_id)

    vital_ids = [hit[0] for hit in vital_hits]
    vital_payloads = (
        {p.event_id: p for p in db.scalars(
            select(VitalSignPayload).where(VitalSignPayload.event_id.in_(vital_ids))
        ).all()} if vital_ids else {}
    )
    concept_ids = {hit[1] for hit in vital_hits if hit[1] is not None}
    concepts = (
        {c.id: c for c in db.scalars(
            select(MedicalConcept).where(MedicalConcept.id.in_(list(concept_ids)))
        ).all()} if concept_ids else {}
    )
    for event_id, concept_id, event_time in vital_hits:
        # Same rule as the original inline loop: skip concepts already
        # produced; a concept is marked only when its payload exists (a
        # payload-less first occurrence does not block a later one), and
        # null-concept vitals each produce their own row.
        if concept_id in seen_concepts:
            continue
        payload = vital_payloads.get(event_id)
        concept = concepts.get(concept_id) if concept_id else None
        if payload:
            latest_vitals.append(LatestVitalMetric(
                concept_id=concept_id,
                display_name=(concept.short_name or concept.display_name) if concept else "Vital sign",
                value=payload.value,
                unit=payload.unit,
                event_time=event_time,
            ))
            if concept_id:
                seen_concepts.add(concept_id)

    if wellbeing_hit is not None:
        payload = db.get(WellbeingPayload, wellbeing_hit[0])
        if payload:
            today_wellbeing = WellbeingMetric(
                overall_wellbeing=payload.overall_wellbeing,
                energy_level=payload.energy_level,
                stress_level=payload.stress_level,
                event_time=wellbeing_hit[1],
            )

    if pain_hit is not None:
        payload = db.get(PainPayload, pain_hit[0])
        if payload:
            latest_pain = PainMetric(severity=payload.severity, pain_type=payload.pain_type, event_time=pain_hit[1])

    if sleep_hit is not None:
        payload = db.get(SleepPayload, sleep_hit[0])
        if payload:
            latest_sleep = SleepMetric(duration_minutes=payload.duration_minutes, sleep_quality=payload.sleep_quality, awakenings=payload.awakenings, event_time=sleep_hit[1])

    if activity_event_ids:
        activity_payloads = {p.event_id: p for p in db.scalars(
            select(ActivityPayload).where(ActivityPayload.event_id.in_(activity_event_ids))
        ).all()}
        for event in patient_events:
            if event.event_id not in activity_payloads:
                continue
            payload = activity_payloads[event.event_id]
            activity_duration_minutes += payload.duration_minutes or 0
            if payload.calories_burned is not None:
                activity_calories_burned += payload.calories_burned
            activity_count += 1
            latest_activity_time = max(latest_activity_time or event.event_time, event.event_time)

    if activity_count:
        today_activity = ActivityMetric(
            duration_minutes=activity_duration_minutes,
            calories_burned=activity_calories_burned or None,
            activity_count=activity_count,
            event_time=latest_activity_time,
        )

    cutoff = today - timedelta(days=30)
    recent_daily_logs = [
        RecentDailyLog(log_date=event_date, event_count=sum(count for (day, _), count in daily_counts.items() if day == event_date), categories=sorted({category for (day, _), categories in daily_groups.items() if day == event_date for category in categories}))
        for event_date in sorted({day for day, _ in daily_counts if day >= cutoff}, reverse=True)
    ]
    return DailyMetricsResponse(
        latest_vitals=latest_vitals,
        today_wellbeing=today_wellbeing,
        latest_pain=latest_pain,
        latest_sleep=latest_sleep,
        today_activity=today_activity,
        recent_daily_logs=recent_daily_logs,
    )
