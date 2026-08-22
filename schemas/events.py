from pydantic import BaseModel, ConfigDict, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from uuid import UUID

from models.events import EventType, SourceType, VerificationStatus

#  INGESTION & DOCUMENTS=
class DocumentResponse(BaseModel):
    document_id: UUID
    patient_id: UUID
    file_hash: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)

#  ONTOLOGY
class BodyRegionResponse(BaseModel):
    region_id: UUID
    name: str
    parent_id: Optional[UUID] = None

    model_config = ConfigDict(from_attributes=True)

# PROVENANCE & EVIDENCE
class EvidenceResponse(BaseModel):
    document_id: UUID
    extracted_text: str
    bounding_box: Optional[List[float]] = None  # [0.1, 0.2, 0.5, 0.3]
    
    model_config = ConfigDict(from_attributes=True)

# EVENT PAYLOADS
class LabResultResponse(BaseModel):
    value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    abnormal_flag: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

# CORE CLINICAL EVENTS (TIMELINE)
class ClinicalEventBase(BaseModel):
    event_type: EventType
    source_type: SourceType
    event_time: datetime
    concept_id: Optional[UUID] = None

class ClinicalEventCreate(ClinicalEventBase):
    patient_id: UUID

class ClinicalEventResponse(BaseModel):
    """
    Master response schema used by the Timeline API. 
    Returns the event, its payload, and visual provenance in one object.
    """
    event_id: UUID
    patient_id: UUID
    event_type: EventType
    source_type: SourceType
    event_time: datetime
    verification_status: VerificationStatus
    concept_id: Optional[UUID] = None
    
    # Joined contextual fields for the UI
    concept_display_name: Optional[str] = None 
    lab_result: Optional[LabResultResponse] = None
    evidence: Optional[EvidenceResponse] = None

    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

# REVIEW QUEUE & ALIAS LEARNING
class PendingReviewItem(BaseModel):
    """
    Used when returning uncertain extractions that require human review.
    """
    event_id: UUID
    event_time: datetime
    event_type: str
    extracted_text: Optional[str] = None
    document_id: Optional[UUID] = None
    
    # Lab specific context to help the reviewer decide
    value: Optional[str] = None
    unit: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class ResolveEventRequest(BaseModel):
    """
    Payload sent by the frontend when a user manually maps an unknown term.
    """
    concept_id: UUID
    raw_term: str  # The exact string from OCR to learn (e.g., "S. Creat")