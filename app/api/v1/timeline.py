from datetime import datetime
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, desc

from core.db import get_db
from app.api.dependencies import get_authenticated_patient_id
from models.identity import Patient
from models.events import ClinicalEvent, EventType
from models.events import LabResult
from models.events import EvidenceLink
from models.ontology import MedicalConcept
from models.daily_logs.events import PatientNotePayload, VitalSignPayload
from schemas.events import ClinicalEventResponse

router = APIRouter(prefix="/api/v1/timeline", tags=["timeline"])

@router.get("", response_model=List[ClinicalEventResponse])
def get_timeline(
    start_date: Optional[datetime] = Query(None, description="Filter events after this date"),
    end_date: Optional[datetime] = Query(None, description="Filter events before this date"),
    event_type: Optional[EventType] = Query(None, description="Filter by specific event type (e.g., LAB_RESULT)"),
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id)
):
    """
    Fetches the unified, chronological health timeline for the patient.
    """

    #Build the optimized joined query
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

    # 3. Apply optional filters
    if start_date:
        query = query.filter(ClinicalEvent.event_time >= start_date)
    if end_date:
        query = query.filter(ClinicalEvent.event_time <= end_date)
    if event_type:
        query = query.filter(ClinicalEvent.event_type == event_type)

    #Sort (newest first)
    query = query.order_by(desc(ClinicalEvent.event_time))

    # Execute and map to the unified Pydantic response
    results = query.all()
    
    timeline_response = []
    for event, concept, lab, evidence, vital, note in results:
        
        # Assemble the Pydantic object manually to handle the outer joins safely
        event_dict = {
            "event_id": event.event_id,
            "patient_id": event.patient_id,
            "event_type": event.event_type,
            "source_type": event.source_type,
            "event_time": event.event_time,
            "verification_status": event.verification_status,
            "concept_id": event.concept_id,
            "created_at": event.created_at,
            "updated_at": event.updated_at,
            
            # The Semantic Layer
            "concept_display_name": concept.display_name if concept else None,
            
            # The Payload Layer (Lab)
            "lab_result": {
                "value": lab.value,
                "unit": lab.unit,
                "reference_range": lab.reference_range,
                "abnormal_flag": getattr(lab, 'abnormal_flag', None)
            } if lab else None,
            "vital_sign": {"value": vital.value, "unit": vital.unit} if vital else None,
            "safe_notes": note.safe_notes if note else None,
            
            # The Provenance Layer
            "evidence": {
                "document_id": evidence.document_id,
                "extracted_text": evidence.extracted_text,
                "bounding_box": evidence.bounding_box
            } if evidence else None
        }
        timeline_response.append(event_dict)

    return timeline_response
