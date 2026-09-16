from datetime import datetime
from typing import List, Optional, Union
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select, desc
import json

from core.db import get_db
from app.api.dependencies import get_authenticated_patient_id
from models.identity import Patient
from models.events import ClinicalEvent, EventType
from models.events import LabResult
from models.events import EvidenceLink
from models.ontology import MedicalConcept
from models.daily_logs.events import PatientNotePayload, VitalSignPayload
from models.anatomy import AnatomicalObservation
from logger import logger

router = APIRouter(prefix="/api/v1/timeline", tags=["timeline"])


# ---------------------------------------------------------------------------
# Unified timeline item — can be either a ClinicalEvent or an Observation
# ---------------------------------------------------------------------------

class TimelineObservation(BaseModel):
    """An observation item on the unified health timeline."""
    observation_id: str
    resource_type: str = "observation"
    structure_id: str
    observation_type: str
    finding_code: str
    finding_display_name: str
    visual_status: str
    visual_severity_score: float
    trend: str
    source_type: str
    clinical_summary: Optional[str] = None
    event_time: datetime  # mapped from recorded_at for timeline ordering
    created_at: datetime  # mapped from ingested_at


# Unified type for the timeline endpoint response
class UnifiedTimelineItem(BaseModel):
    """A single item on the unified health timeline.
    
    Can be either a clinical event or an observation. The resource_type field
    indicates which kind of record this is.
    """
    resource_type: str  # "event" or "observation"
    
    # Common fields
    id: str
    event_time: datetime
    
    # Event-specific fields (present when resource_type == "event")
    event_id: Optional[str] = None
    patient_id: Optional[str] = None
    event_type: Optional[str] = None
    source_type: Optional[str] = None
    verification_status: Optional[str] = None
    concept_id: Optional[str] = None
    concept_display_name: Optional[str] = None
    lab_result: Optional[dict] = None
    vital_sign: Optional[dict] = None
    safe_notes: Optional[str] = None
    evidence: Optional[dict] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    # Observation-specific fields (present when resource_type == "observation")
    observation_id: Optional[str] = None
    structure_id: Optional[str] = None
    observation_type: Optional[str] = None
    finding_code: Optional[str] = None
    finding_display_name: Optional[str] = None
    visual_status: Optional[str] = None
    visual_severity_score: Optional[float] = None
    trend: Optional[str] = None
    clinical_summary: Optional[str] = None



@router.get("", response_model=List[UnifiedTimelineItem])
def get_timeline(
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
    event_type: Optional[EventType] = Query(None, description="Filter by specific event type (e.g., LAB_RESULT)"),
    limit: int = Query(500, ge=1, le=2000, description="Max events and observations each (newest first)"),
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id)
):
    """
    Fetches the unified, chronological health timeline for the patient.

    Returns BOTH clinical events AND anatomical observations in chronological order.
    Each item has a `resource_type` field: "event" or "observation".
    Both lists are newest-first and bounded by `limit` so the endpoint can
    never full-scan an unbounded patient history into one response.
    """

    # ── 1. Clinical Events ──────────────────────────────────────────────
    query = db.query(
        ClinicalEvent, 
        MedicalConcept, 
        LabResult, 
        EvidenceLink
        , VitalSignPayload, PatientNotePayload
    ).outerjoin(
        MedicalConcept, ClinicalEvent.concept_id == MedicalConcept.id
    ).outerjoin(
        LabResult, ClinicalEvent.event_id == LabResult.event_id
    ).outerjoin(
        EvidenceLink, ClinicalEvent.event_id == EvidenceLink.event_id
    ).outerjoin(
        VitalSignPayload, ClinicalEvent.event_id == VitalSignPayload.event_id
    ).outerjoin(
        PatientNotePayload, ClinicalEvent.event_id == PatientNotePayload.event_id
    ).filter(
        ClinicalEvent.patient_id == patient_id
    )

    # Apply optional filters
    if start_date:
        query = query.filter(ClinicalEvent.event_time >= start_date)
    if end_date:
        query = query.filter(ClinicalEvent.event_time <= end_date)
    if event_type:
        query = query.filter(ClinicalEvent.event_type == event_type)

    # Sort (newest first), bounded — same window semantics, never unbounded.
    query = query.order_by(desc(ClinicalEvent.event_time)).limit(limit)

    results = query.all()
    
    event_count = len(results)

    timeline_items: List[UnifiedTimelineItem] = []
    
    for event, concept, lab, evidence, vital, note in results:
        item = UnifiedTimelineItem(
            resource_type="event",
            id=str(event.event_id),
            event_time=event.event_time,
            event_id=str(event.event_id),
            patient_id=str(event.patient_id),
            event_type=event.event_type.value if event.event_type else None,
            source_type=event.source_type.value if event.source_type else None,
            verification_status=event.verification_status.value if event.verification_status else None,
            concept_id=str(event.concept_id) if event.concept_id else None,
            concept_display_name=concept.display_name if concept else None,
            lab_result={
                "value": lab.value,
                "unit": lab.unit,
                "reference_range": lab.reference_range,
                "abnormal_flag": getattr(lab, 'abnormal_flag', None)
            } if lab else None,
            vital_sign={"value": vital.value, "unit": vital.unit} if vital else None,
            safe_notes=note.safe_notes if note else None,
            evidence={
                "document_id": str(evidence.document_id),
                "extracted_text": evidence.extracted_text,
                "bounding_box": evidence.bounding_box
            } if evidence else None,
            created_at=event.created_at,
            updated_at=event.updated_at,
        )
        timeline_items.append(item)

    # ── 2. Anatomical Observations ──────────────────────────────────────
    obs_query = (
        select(AnatomicalObservation)
        .where(AnatomicalObservation.patient_id == patient_id)
    )
    if start_date:
        obs_query = obs_query.where(AnatomicalObservation.recorded_at >= start_date)
    if end_date:
        obs_query = obs_query.where(AnatomicalObservation.recorded_at <= end_date)
    
    obs_query = obs_query.order_by(desc(AnatomicalObservation.recorded_at)).limit(limit)

    observations = db.scalars(obs_query).all()
    
    observation_count = len(observations)

    for obs in observations:
        item = UnifiedTimelineItem(
            resource_type="observation",
            id=str(obs.observation_id),
            event_time=obs.recorded_at,
            observation_id=str(obs.observation_id),
            structure_id=obs.structure_id,
            observation_type=obs.observation_type.value if obs.observation_type else None,
            finding_code=obs.finding_code,
            finding_display_name=obs.finding_display_name,
            visual_status=obs.visual_status.value if obs.visual_status else None,
            visual_severity_score=obs.visual_severity_score,
            trend=obs.trend.value if obs.trend else None,
            source_type=obs.source_type.value if obs.source_type else None,
            clinical_summary=obs.clinical_summary,
            created_at=obs.ingested_at,
        )
        timeline_items.append(item)

    # ── 3. Sort unified timeline (newest first) ─────────────────────────
    timeline_items.sort(key=lambda x: x.event_time, reverse=True)

    # ── 4. Diagnostics ──────────────────────────────────────────────────
    logger.info(
        "[GraphData] timeline endpoint: events=%d, observations=%d, total=%d",
        event_count, observation_count, len(timeline_items),
    )

    # Count by resource type
    events = [i for i in timeline_items if i.resource_type == "event"]
    obs = [i for i in timeline_items if i.resource_type == "observation"]
    
    # Count event types
    event_type_counts: dict[str, int] = {}
    for e in events:
        et = e.event_type or "unknown"
        event_type_counts[et] = event_type_counts.get(et, 0) + 1
    
    # Count observation types
    obs_type_counts: dict[str, int] = {}
    for o in obs:
        ot = o.observation_type or "unknown"
        obs_type_counts[ot] = obs_type_counts.get(ot, 0) + 1

    logger.info("[GraphData] event types: %s", json.dumps(event_type_counts))
    logger.info("[GraphData] observation types: %s", json.dumps(obs_type_counts))
    logger.info("[GraphData] other=0 (conditions, medications, procedures, encounters not yet in database)")

    return timeline_items
