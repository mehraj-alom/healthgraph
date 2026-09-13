"""Summary read-model endpoints.

These provide read-only access to the patient's daily and longitudinal
health summaries.  The summaries are derived caches — not the source of
truth — and can be rebuilt at any time.

POST /api/v1/summaries/daily/{date}
    Rebuild (force-refresh) the daily summary for a specific date.

GET /api/v1/summaries/daily/{date}
    Retrieve the daily summary for a specific date.

GET /api/v1/summaries/health
    Retrieve the longitudinal patient health summary.

POST /api/v1/summaries/health/rebuild
    Rebuild the longitudinal patient health summary.

POST /api/v1/summaries/rebuild-all
    Rebuild all daily summaries + the health summary for a patient.
"""

import uuid
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.config import settings
from core.db import get_db
from core.rate_limiter import RateLimiter
from logger import logger
from models.summaries import PatientDailySummary, PatientHealthSummary
from services.summaries.daily_summary_service import (
    get_daily_summary,
    rebuild_daily_summary,
    upsert_daily_summary,
)
from services.summaries.health_summary_service import (
    get_health_summary,
    rebuild_health_summary,
    upsert_health_summary,
)


router = APIRouter(
    prefix="/api/v1/summaries",
    tags=["Patient Summaries"],
)

# Expensive synchronous rebuild operations are abuse-protected per
# authenticated user: a shared 5-rebuilds/hour budget across all three
# rebuild endpoints. Redis-outage policy is fail-closed outside LOCAL so a
# limiter outage never degrades into unbounded compute. (An existing
# reprocessing surface — document_reprocess is not yet exposed as an
# endpoint — would reuse this same pattern: 5/hour/user.)
_SUMMARY_REBUILD_LIMIT = 5
_SUMMARY_REBUILD_WINDOW_SECONDS = 3600
_summary_rebuild_limiter = RateLimiter()


def _guard_summary_rebuild(patient_id: uuid.UUID) -> None:
    _summary_rebuild_limiter.check(
        str(patient_id),
        "summary_rebuild",
        _SUMMARY_REBUILD_LIMIT,
        _SUMMARY_REBUILD_WINDOW_SECONDS,
        fail_open=settings.APP_ENV == "local",
    )


def _rebuild_all_daily(db: Session, patient_id: uuid.UUID) -> int:
    """Rebuild every dated daily summary for a patient; returns the count."""
    from sqlalchemy import func, select
    from models.events import ClinicalEvent

    date_rows = db.execute(
        select(
            func.date_trunc("day", ClinicalEvent.event_time).label("day")
        )
        .where(ClinicalEvent.patient_id == patient_id)
        .group_by(func.date_trunc("day", ClinicalEvent.event_time))
        .order_by(func.date_trunc("day", ClinicalEvent.event_time))
    ).all()

    daily_count = 0
    for row in date_rows:
        if row.day:
            rebuild_daily_summary(db, patient_id, row.day.date())
            daily_count += 1
    return daily_count


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class DailySummaryResponse(BaseModel):
    patient_id: uuid.UUID
    summary_date: str
    sections: dict
    event_count: int
    updated_at: str


class HealthSummaryResponse(BaseModel):
    patient_id: uuid.UUID
    sections: dict
    total_events: int
    updated_at: str


class RebuildAllResponse(BaseModel):
    patient_id: uuid.UUID
    daily_summaries_rebuilt: int
    health_summary_rebuilt: bool
    status: str


# ---------------------------------------------------------------------------
# Daily summary endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/daily/{summary_date}",
    response_model=DailySummaryResponse,
)
def get_daily(
    summary_date: date,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Retrieve the daily summary for a specific date."""
    result = get_daily_summary(db, patient_id, summary_date)

    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No daily summary found for {summary_date}.",
        )

    return DailySummaryResponse(
        patient_id=result.patient_id,
        summary_date=result.summary_date.isoformat(),
        sections=result.sections,
        event_count=result.event_count,
        updated_at=result.updated_at.isoformat() if result.updated_at else "",
    )


@router.post(
    "/daily/{summary_date}",
    response_model=DailySummaryResponse,
)
def rebuild_daily(
    summary_date: date,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Rebuild (force-refresh) the daily summary for a specific date."""
    _guard_summary_rebuild(patient_id)
    result = rebuild_daily_summary(db, patient_id, summary_date)

    return DailySummaryResponse(
        patient_id=result.patient_id,
        summary_date=result.summary_date.isoformat(),
        sections=result.sections,
        event_count=result.event_count,
        updated_at=result.updated_at.isoformat() if result.updated_at else "",
    )


# ---------------------------------------------------------------------------
# Health (longitudinal) summary endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/health",
    response_model=HealthSummaryResponse,
)
def get_health(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Retrieve the longitudinal patient health summary."""
    result = get_health_summary(db, patient_id)

    if not result:
        # Auto-build if not yet populated
        result = upsert_health_summary(db, patient_id, auto_commit=True)

    return HealthSummaryResponse(
        patient_id=result.patient_id,
        sections=result.sections,
        total_events=result.total_events,
        updated_at=result.updated_at.isoformat() if result.updated_at else "",
    )


@router.post(
    "/health/rebuild",
    response_model=HealthSummaryResponse,
)
def rebuild_health(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Rebuild (force-refresh) the longitudinal patient health summary."""
    _guard_summary_rebuild(patient_id)
    result = rebuild_health_summary(db, patient_id)

    return HealthSummaryResponse(
        patient_id=result.patient_id,
        sections=result.sections,
        total_events=result.total_events,
        updated_at=result.updated_at.isoformat() if result.updated_at else "",
    )


# ---------------------------------------------------------------------------
# Full rebuild endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/rebuild-all",
    response_model=RebuildAllResponse,
)
def rebuild_all(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Rebuild all daily summaries and the health summary for a patient.

    Iterates over all clinical events to find unique dates, then
    rebuilds the daily summary for each date and finally rebuilds
    the health summary.
    """
    _guard_summary_rebuild(patient_id)
    daily_count = _rebuild_all_daily(db, patient_id)
    # Rebuild the health summary
    rebuild_health_summary(db, patient_id)

    return RebuildAllResponse(
        patient_id=patient_id,
        daily_summaries_rebuilt=daily_count,
        health_summary_rebuilt=True,
        status="complete",
    )
