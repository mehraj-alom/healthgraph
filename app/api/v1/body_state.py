import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from agents.tools.body_state import _get_current_body_state
from core.db import get_db
from models.anatomy import (
    AnatomicalObservation,
    AnatomicalStructure,
    FindingTrend,
    ObservationType,
    PatientBodyStateSnapshot,
    SourceType,
    VisualStatus,
)
from models.events import (
    ClinicalEvent,
    EventType,
    SourceType as EventSourceType,
    VerificationStatus,
)
from models.outbox import enqueue_clinical_event
from schemas.body_state import BodyStateItem


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

    db.add(observation)

    # -------------------------------------------------------------------------
    # Upsert materialized body-state snapshot.
    # -------------------------------------------------------------------------

    snapshot = db.scalar(
        select(PatientBodyStateSnapshot).where(
            PatientBodyStateSnapshot.patient_id
            == patient_id,
            PatientBodyStateSnapshot.structure_id
            == structure.structure_id,
        )
    )

    now = datetime.now(timezone.utc)

    if snapshot:
        snapshot.mesh_asset_id = (
            structure.mesh_asset_id
        )
        snapshot.mesh_node_name = (
            structure.mesh_node_name
        )
        snapshot.mesh_version = (
            structure.mesh_version
        )
        snapshot.visual_status = (
            payload.visual_status
        )
        snapshot.visual_severity_score = (
            payload.visual_severity_score
        )
        snapshot.trend = FindingTrend.STABLE
        snapshot.latest_observation_id = (
            observation_id
        )
        snapshot.latest_summary = (
            payload.clinical_summary
        )
        snapshot.observation_recorded_at = now
        snapshot.observation_ingested_at = now

    else:
        snapshot = PatientBodyStateSnapshot(
            patient_id=patient_id,
            structure_id=structure.structure_id,
            mesh_asset_id=structure.mesh_asset_id,
            mesh_node_name=structure.mesh_node_name,
            mesh_version=structure.mesh_version,
            visual_status=payload.visual_status,
            visual_severity_score=payload.visual_severity_score,
            trend=FindingTrend.STABLE,
            latest_observation_id=observation_id,
            latest_summary=payload.clinical_summary,
            observation_recorded_at=now,
            observation_ingested_at=now,
        )

        db.add(snapshot)


    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to persist body-state observation.",
        )

    return BodyStateLogResponse(
        observation_id=observation_id,
        event_id=event_id,
        structure_id=structure.structure_id,
        status="created",
    )