from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from core.db import get_db
from core.security import get_current_user
from models.identity import Patient
from models.events import ClinicalEvent
from models.events import EvidenceLink, Document
from schemas.events import ProvenanceResponse

router = APIRouter(prefix="/v1/events", tags=["provenance"])

@router.get("/{event_id}/provenance", response_model=ProvenanceResponse)
def get_event_provenance(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_patient_uid: str = Depends(get_current_user)
):
    """
    Fetches the visual evidence (document URL and bounding box) for a specific clinical event.
    """
    #Authenticate patient
    patient = db.scalar(select(Patient).where(Patient.firebase_uid == current_patient_uid))
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")

    #Query the event to ensure the patient actually owns it
    event = db.scalar(select(ClinicalEvent).where(
        ClinicalEvent.event_id == event_id,
        ClinicalEvent.patient_id == patient.patient_id
    ))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or access denied.")

    # Join EvidenceLink with Document to get the storage_url and bbox
    result = db.query(EvidenceLink, Document).join(
        Document, EvidenceLink.document_id == Document.document_id
    ).filter(
        EvidenceLink.event_id == event_id
    ).first()

    if not result:
        raise HTTPException(status_code=404, detail="No visual provenance found for this event.")

    evidence, document = result

    # Return the complete package for the frontend
    return ProvenanceResponse(
        event_id=event_id,
        document_id=document.document_id,
        storage_url=document.storage_url,
        extracted_text=evidence.extracted_text,
        bounding_box=evidence.bounding_box
    )