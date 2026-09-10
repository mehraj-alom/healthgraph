from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class LatestVitalMetric(BaseModel):
    concept_id: UUID | None
    display_name: str
    value: float | None
    unit: str | None
    event_time: datetime


class WellbeingMetric(BaseModel):
    overall_wellbeing: int | None
    energy_level: int | None
    stress_level: int | None
    event_time: datetime


class PainMetric(BaseModel):
    severity: int
    pain_type: str | None
    event_time: datetime


class SleepMetric(BaseModel):
    duration_minutes: int
    sleep_quality: int | None
    awakenings: int | None
    event_time: datetime


class ActivityMetric(BaseModel):
    duration_minutes: int
    calories_burned: float | None
    activity_count: int
    event_time: datetime


class RecentDailyLog(BaseModel):
    log_date: date
    event_count: int
    categories: list[str]


class DailyMetricsResponse(BaseModel):
    latest_vitals: list[LatestVitalMetric]
    today_wellbeing: WellbeingMetric | None
    latest_pain: PainMetric | None
    latest_sleep: SleepMetric | None
    today_activity: ActivityMetric | None
    recent_daily_logs: list[RecentDailyLog]
