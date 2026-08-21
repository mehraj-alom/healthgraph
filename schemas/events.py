from pydantic import BaseModel, ConfigDict, Field
from typing import Optional
from datetime import datetime
from uuid import UUID
from models.events import EventType, SourceType, VerificationStatus

class ClinicalEventBase(BaseModel):
    event_type: EventType
    source_type: SourceType
    event_time: datetime
    concept_id: Optional[UUID] = None

class ClinicalEventCreate(ClinicalEventBase):
    patient_id: UUID

class ClinicalEventResponse(ClinicalEventBase):
    event_id: UUID
    verification_status: VerificationStatus
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class LabResultResponse(BaseModel):
    value: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    abnormal_flag: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ingestion
class DocumentResponse(BaseModel):
    document_id: UUID
    patient_id: UUID
    file_hash: str
    status: str
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


#$ ontology
class BodyRegionResponse(BaseModel):
    region_id: UUID
    name: str
    parent_id: Optional[UUID]

    model_config = ConfigDict(from_attributes=True)