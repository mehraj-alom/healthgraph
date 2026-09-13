"""
Phase 0 / Increment 1 backend tests.

Covers the daily-metrics schema in schemas/daily_metrics.py, with focus on
the nullable-vitals repair area (value/concept_id/unit may all be None).
Pure pydantic validation — no database or external services required,
so CI needs only `pytest` and `pydantic`.
"""

from datetime import date, datetime

import pytest
from pydantic import ValidationError

from schemas.daily_metrics import (
    ActivityMetric,
    DailyMetricsResponse,
    LatestVitalMetric,
    PainMetric,
    RecentDailyLog,
    SleepMetric,
    WellbeingMetric,
)

NOW = datetime(2025, 1, 2, 3, 4, 5)


class TestLatestVitalMetric:
    def test_nullable_vitals_are_accepted(self):
        metric = LatestVitalMetric(
            concept_id=None,
            display_name="Systolic Blood Pressure",
            value=None,
            unit=None,
            event_time=NOW,
        )
        assert metric.value is None
        assert metric.concept_id is None
        assert metric.unit is None

    def test_valued_vital_is_accepted(self):
        metric = LatestVitalMetric(
            concept_id=None,
            display_name="Weight",
            value=72.5,
            unit="kg",
            event_time=NOW,
        )
        assert metric.value == 72.5

    def test_requires_display_name(self):
        with pytest.raises(ValidationError):
            LatestVitalMetric(value=1.0, event_time=NOW)

    def test_requires_event_time(self):
        with pytest.raises(ValidationError):
            LatestVitalMetric(display_name="Pulse", value=1.0)


class TestWellbeingMetric:
    def test_all_null_wellbeing_accepted(self):
        metric = WellbeingMetric(
            overall_wellbeing=None,
            energy_level=None,
            stress_level=None,
            event_time=NOW,
        )
        assert metric.overall_wellbeing is None

    def test_valued_wellbeing_accepted(self):
        metric = WellbeingMetric(
            overall_wellbeing=7, energy_level=6, stress_level=3, event_time=NOW
        )
        assert metric.overall_wellbeing == 7


class TestPainMetric:
    def test_severity_required(self):
        with pytest.raises(ValidationError):
            PainMetric(pain_type="headache", event_time=NOW)

    def test_pain_type_optional(self):
        metric = PainMetric(severity=4, pain_type=None, event_time=NOW)
        assert metric.severity == 4


class TestSleepMetric:
    def test_duration_required(self):
        with pytest.raises(ValidationError):
            SleepMetric(duration_minutes=None, event_time=NOW)

    def test_quality_and_awakenings_optional(self):
        metric = SleepMetric(
            duration_minutes=480, sleep_quality=None, awakenings=None, event_time=NOW
        )
        assert metric.duration_minutes == 480
        assert metric.sleep_quality is None


class TestActivityMetric:
    def test_calories_burned_optional_nullable(self):
        metric = ActivityMetric(
            duration_minutes=30, calories_burned=None, activity_count=1, event_time=NOW
        )
        assert metric.calories_burned is None


class TestRecentDailyLog:
    def test_categories_list(self):
        log = RecentDailyLog(log_date=date(2025, 1, 1), event_count=3, categories=["vitals"])
        assert log.categories == ["vitals"]


class TestDailyMetricsResponse:
    def test_optional_groups_may_be_none(self):
        response = DailyMetricsResponse(
            latest_vitals=[],
            today_wellbeing=None,
            latest_pain=None,
            latest_sleep=None,
            today_activity=None,
            recent_daily_logs=[],
        )
        assert response.today_wellbeing is None

    def test_full_response_accepted(self):
        response = DailyMetricsResponse(
            latest_vitals=[
                LatestVitalMetric(
                    concept_id=None,
                    display_name="Pulse",
                    value=None,
                    unit=None,
                    event_time=NOW,
                )
            ],
            today_wellbeing=WellbeingMetric(
                overall_wellbeing=7, energy_level=6, stress_level=3, event_time=NOW
            ),
            latest_pain=PainMetric(severity=2, pain_type=None, event_time=NOW),
            latest_sleep=SleepMetric(
                duration_minutes=480, sleep_quality=None, awakenings=None, event_time=NOW
            ),
            today_activity=ActivityMetric(
                duration_minutes=30, calories_burned=None, activity_count=1, event_time=NOW
            ),
            recent_daily_logs=[
                RecentDailyLog(
                    log_date=date(2025, 1, 1), event_count=3, categories=["vitals"]
                )
            ],
        )
        assert len(response.recent_daily_logs) == 1