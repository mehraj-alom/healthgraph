from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from typing import List
from logger import logger
from core.db import get_db
from app.api.dependencies import get_authenticated_patient_id
from models.identity import Patient
from models.events import ClinicalEvent, VerificationStatus,EvidenceLink,LabResult
from models.ontology import MedicalConcept
from schemas.events import PendingReviewItem, ResolveEventRequest
from services.ocr.canonicalization import Canonicalizer

router = APIRouter(prefix="/api/v1/review", tags=["review"])

@router.get("/pending", response_model=List[PendingReviewItem])
def get_pending_reviews(
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id)
):
    """Fetches all events that failed automatic canonicalization."""

    # Fetch UNVERIFIED events joined with their payloads and evidence
    events = db.query(ClinicalEvent, LabResult, EvidenceLink).outerjoin(
        LabResult, ClinicalEvent.event_id == LabResult.event_id
    ).outerjoin(
        EvidenceLink, ClinicalEvent.event_id == EvidenceLink.event_id
    ).filter(
        ClinicalEvent.patient_id == patient_id,
        ClinicalEvent.verification_status == VerificationStatus.UNVERIFIED,
        ClinicalEvent.concept_id.is_(None)
    ).all()

    response = []
    for event, lab, evidence in events:
        response.append({
            "event_id": event.event_id,
            "event_time": event.event_time,
            "event_type": event.event_type.value,
            "extracted_text": evidence.extracted_text if evidence else None,
            "document_id": evidence.document_id if evidence else None,
            "value": lab.value if lab else None,
            "unit": lab.unit if lab else None
        })
    
    return response



@router.post("/{event_id}/resolve")
def resolve_pending_event(
    event_id: UUID,
    request: ResolveEventRequest,
    db: Session = Depends(get_db),
    patient_id: UUID = Depends(get_authenticated_patient_id)
):
    """Maps an unknown event to a concept and permanently learns the alias."""
    logger.info(f"Resolving pending event for patient: {patient_id}")
    # Lock the event and verify ownership
    event = db.scalar(select(ClinicalEvent).where(
        ClinicalEvent.event_id == event_id,
        ClinicalEvent.patient_id == patient_id
    ))
    
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.verification_status == VerificationStatus.HUMAN_VERIFIED:
        raise HTTPException(status_code=400, detail="Event is already verified.")

    # Validate the target concept exists
    concept = db.get(MedicalConcept, request.concept_id)
    if not concept:
        raise HTTPException(status_code=400, detail="Invalid target concept_id.")

    try:
        # Trigger atomic PostgreSQL UPSERT to learn the new alias globally
        Canonicalizer.learn_alias(
            db=db,
            raw_term=request.raw_term,
            concept_id=request.concept_id,
            source="human_review",
            confidence=1.0 # 100% confidence since a human verified it
        )
        
        #Update the event timeline record
        event.concept_id = request.concept_id
        event.verification_status = VerificationStatus.HUMAN_VERIFIED
        
        db.commit()
        return {"status": "success", "message": f"Learned alias '{request.raw_term}' for concept {concept.display_name}"}
        
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to resolve event: {str(e)}")