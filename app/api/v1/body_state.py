import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from logger import logger
from app.api.dependencies import get_authenticated_patient_id
from agents.tools.body_state import _get_current_body_state
from core.db import get_db
from models.anatomy import (
    AnatomicalObservation,
    AnatomicalStructure,
    FindingTrend,
    ObservationType,
    SourceType,
    VisualStatus,
)
from services.anatomy.body_state_service import (
    record_anatomical_observation,
)
from models.events import (
    ClinicalEvent,
    EventType,
    SourceType as EventSourceType,
    VerificationStatus,
)
from models.outbox import enqueue_clinical_event
from schemas.body_state import BodyStateItem
from services.summaries.daily_summary_service import upsert_daily_summary


router = APIRouter(
    prefix="/api/v1/body-state",
    tags=["3D Body State"],
)


class BodyStateLogRequest(BaseModel):
    """
    Client payload for a manually entered body/vital observation.

    patient_id is intentionally NOT accepted here.
    The authenticated Firebase token determines the patient.
    """

    structure_id: str = Field(
        min_length=1,
        max_length=64,
    )

    finding_code: str = Field(
        min_length=1,
        max_length=100,
    )

    visual_severity_score: float = Field(
        ge=0.0,
        le=1.0,
    )

    visual_status: VisualStatus = VisualStatus.NORMAL

    clinical_summary: str | None = None

    source_type: SourceType = SourceType.PATIENT_REPORTED


class BodyStateLogResponse(BaseModel):
    observation_id: uuid.UUID
    event_id: uuid.UUID
    structure_id: str
    status: str


class AnatomicalStructureItem(BaseModel):
    structure_id: str
    display_name: str
    category: str
    parent_id: str | None
    is_internal_organ: bool


@router.get(
    "/structures",
    response_model=List[AnatomicalStructureItem],
)
def list_anatomical_structures(
    db: Session = Depends(get_db),
):
    """
    Return the full anatomical structure registry.
    Used by the frontend body-location picker.
    """
    structures = db.execute(
        select(AnatomicalStructure).order_by(
            AnatomicalStructure.parent_id.nulls_first(),
            AnatomicalStructure.structure_id,
        )
    ).scalars().all()

    return [
        AnatomicalStructureItem(
            structure_id=s.structure_id,
            display_name=s.display_name,
            category=s.category.value,
            parent_id=s.parent_id,
            is_internal_organ=s.is_internal_organ,
        )
        for s in structures
    ]


@router.get(
    "",
    response_model=List[BodyStateItem],
)
async def fetch_body_state(
    patient_id: uuid.UUID = Depends(
        get_authenticated_patient_id
    ),
    db: Session = Depends(get_db),
):
    """
    Returns the patient's materialized 3D body-state read model.
    """
    return [
        BodyStateItem(**row)
        for row in _get_current_body_state(
            patient_id,
            db,
        )
    ]


@router.post(
    "/log",
    response_model=BodyStateLogResponse,
    status_code=201,
)
def log_body_state(
    payload: BodyStateLogRequest,
    patient_id: uuid.UUID = Depends(
        get_authenticated_patient_id
    ),
    db: Session = Depends(get_db),
):
    """
    Persist a patient-reported observation and update
    the materialized body-state snapshot.

    The patient identity comes exclusively from Firebase
    authentication and is mapped by the backend.
    """

    # -------------------------------------------------------------------------
    # Validate anatomical structure.
    # -------------------------------------------------------------------------

    structure = db.scalar(
        select(AnatomicalStructure).where(
            AnatomicalStructure.structure_id
            == payload.structure_id
        )
    )

    if not structure:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Unknown anatomical structure: "
                f"{payload.structure_id}"
            ),
        )

    # -------------------------------------------------------------------------
    # Create clinical event.
    #
    # This gives the observation a place in the longitudinal
    # clinical timeline.
    # -------------------------------------------------------------------------

    event_id = uuid.uuid4()

    event_type = (
        EventType.PAIN_LOG
        if payload.finding_code == "pain_level"
        else EventType.VITAL_SIGN
    )

    clinical_event = ClinicalEvent(
        event_id=event_id,
        patient_id=patient_id,
        concept_id=None,
        event_type=event_type,
        source_type=EventSourceType.PATIENT_REPORTED,
        verification_status=VerificationStatus.HUMAN_VERIFIED,
        event_time=datetime.now(timezone.utc),
    )

    db.add(clinical_event)
    db.flush()

    enqueue_clinical_event(
        db,
        event_id=clinical_event.event_id,
        patient_id=patient_id,
        event_type=clinical_event.event_type,
        source_type=clinical_event.source_type,
        verification_status=clinical_event.verification_status,
        event_time=clinical_event.event_time,
    )

    # -------------------------------------------------------------------------
    # Create authoritative anatomical observation.
    # -------------------------------------------------------------------------

    observation_id = uuid.uuid4()

    observation = AnatomicalObservation(
        observation_id=observation_id,
        patient_id=patient_id,
        structure_id=payload.structure_id,
        observation_type=ObservationType.LAB_ASSOCIATED_FINDING
        if payload.finding_code in {
            "blood_sugar",
            "resting_pulse",
        }
        else ObservationType.SYMPTOM,
        finding_code=payload.finding_code,
        finding_display_name=payload.finding_code.replace(
            "_",
            " ",
        ).title(),
        visual_status=payload.visual_status,
        visual_severity_score=payload.visual_severity_score,
        trend=FindingTrend.STABLE,
        source_type=payload.source_type,
        source_id=str(event_id),
        event_id=event_id,
        clinical_summary=payload.clinical_summary,
        recorded_at=datetime.now(timezone.utc),
        ingested_at=datetime.now(timezone.utc),
    )

    record_anatomical_observation(
        db,
        observation,
        auto_commit=False,
    )


    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to persist body-state observation.",
        )

    # Daily summary update (best-effort)
    try:
        from datetime import date as _date
        upsert_daily_summary(
            db,
            patient_id,
            _date.today(),
            auto_commit=True,
        )
    except Exception:
        logger.warning(
            "Daily summary update failed for body-state observation",
            exc_info=True,
        )

    return BodyStateLogResponse(
        observation_id=observation_id,
        event_id=event_id,
        structure_id=structure.structure_id,
        status="created",
    )