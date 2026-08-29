from collections import defaultdict
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.daily_logs.events import PainPayload, SleepPayload, VitalSignPayload, WellbeingPayload
from models.events import ClinicalEvent, EventType, SourceType
from models.ontology import MedicalConcept
from schemas.daily_metrics import DailyMetricsResponse, LatestVitalMetric, PainMetric, RecentDailyLog, SleepMetric, WellbeingMetric

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
    daily_groups: dict[tuple[object, UUID | None], set[str]] = defaultdict(set)
    daily_counts: dict[tuple[object, UUID | None], int] = defaultdict(int)
    today = datetime.now(timezone.utc).date()

    for event in patient_events:
        event_date = event.event_time.date()
        # Daily-checkin events share a group_id. Standalone clinical/anatomical
        # events are intentionally not presented as a daily log summary.
        if event.group_id is not None:
            group_key = (event_date, event.group_id)
            daily_counts[group_key] += 1
            daily_groups[group_key].add(event.event_type.value)

        if event.event_type == EventType.VITAL_SIGN and event.concept_id not in seen_concepts:
            payload = db.get(VitalSignPayload, event.event_id)
            concept = db.get(MedicalConcept, event.concept_id) if event.concept_id else None
            if payload:
                latest_vitals.append(LatestVitalMetric(
                    concept_id=event.concept_id,
                    display_name=(concept.short_name or concept.display_name) if concept else "Vital sign",
                    value=payload.value,
                    unit=payload.unit,
                    event_time=event.event_time,
                ))
                if event.concept_id:
                    seen_concepts.add(event.concept_id)

        if event.event_type == EventType.WELLBEING_LOG and today_wellbeing is None and event_date == today:
            payload = db.get(WellbeingPayload, event.event_id)
            if payload:
                today_wellbeing = WellbeingMetric(
                    overall_wellbeing=payload.overall_wellbeing,
                    energy_level=payload.energy_level,
                    stress_level=payload.stress_level,
                    event_time=event.event_time,
                )

        if event.event_type == EventType.PAIN_LOG and latest_pain is None:
            payload = db.get(PainPayload, event.event_id)
            if payload:
                latest_pain = PainMetric(severity=payload.severity, pain_type=payload.pain_type, event_time=event.event_time)

        if event.event_type == EventType.SLEEP_LOG and latest_sleep is None:
            payload = db.get(SleepPayload, event.event_id)
            if payload:
                latest_sleep = SleepMetric(duration_minutes=payload.duration_minutes, sleep_quality=payload.sleep_quality, awakenings=payload.awakenings, event_time=event.event_time)

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
        recent_daily_logs=recent_daily_logs,
    )
