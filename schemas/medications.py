"""Pydantic schemas for Medication CRUD and related operations."""
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date, datetime
from uuid import UUID
from enum import Enum


class MedicationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SCHEDULED = "SCHEDULED"
    COMPLETED = "COMPLETED"
    PAUSED = "PAUSED"
    DISCONTINUED = "DISCONTINUED"


class MedicationFrequency(str, Enum):
    ONCE_DAILY = "ONCE_DAILY"
    TWICE_DAILY = "TWICE_DAILY"
    THREE_TIMES_DAILY = "THREE_TIMES_DAILY"
    FOUR_TIMES_DAILY = "FOUR_TIMES_DAILY"
    EVERY_MORNING = "EVERY_MORNING"
    EVERY_EVENING = "EVERY_EVENING"
    EVERY_NIGHT = "EVERY_NIGHT"
    EVERY_8_HOURS = "EVERY_8_HOURS"
    EVERY_12_HOURS = "EVERY_12_HOURS"
    WEEKLY = "WEEKLY"
    AS_NEEDED = "AS_NEEDED"
    CUSTOM = "CUSTOM"


class MedicationRoute(str, Enum):
    ORAL = "ORAL"
    TOPICAL = "TOPICAL"
    INJECTION = "INJECTION"
    INHALED = "INHALED"
    SUBLINGUAL = "SUBLINGUAL"
    RECTAL = "RECTAL"
    NASAL = "NASAL"
    OPHTHALMIC = "OPHTHALMIC"
    OTHER = "OTHER"


class DoseTakenStatus(str, Enum):
    TAKEN = "TAKEN"
    MISSED = "MISSED"
    SKIPPED = "SKIPPED"
    LATE = "LATE"


# ─────────────────────────────────────────────────────────────────────────────
# Create / Update
# ─────────────────────────────────────────────────────────────────────────────

class MedicationCreate(BaseModel):
    """Schema for creating a new medication."""
    name: str = Field(..., max_length=255)
    generic_name: Optional[str] = Field(None, max_length=255)
    brand_name: Optional[str] = Field(None, max_length=255)
    strength: Optional[str] = Field(None, max_length=50)
    strength_unit: Optional[str] = Field(None, max_length=50)
    dose_amount: Optional[float] = None
    dose_unit: Optional[str] = Field(None, max_length=50)
    route: Optional[MedicationRoute] = None
    frequency: MedicationFrequency
    scheduled_times: Optional[List[str]] = None  # ["08:00", "20:00"]
    scheduled_weekdays: Optional[List[int]] = None  # [0,1,2,3,4,5,6]
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: MedicationStatus = MedicationStatus.ACTIVE
    purpose: Optional[str] = Field(None, max_length=500)
    instructions: Optional[str] = None
    prescriber: Optional[str] = Field(None, max_length=255)
    prn: bool = False
    reminder_enabled: bool = False
    notes: Optional[str] = None
    source_document_id: Optional[UUID] = None
    supply_quantity: Optional[float] = None
    supply_started_on: Optional[date] = None
    refills_left: Optional[int] = None


class MedicationUpdate(BaseModel):
    """Schema for updating an existing medication."""
    name: Optional[str] = Field(None, max_length=255)
    generic_name: Optional[str] = Field(None, max_length=255)
    brand_name: Optional[str] = Field(None, max_length=255)
    strength: Optional[str] = Field(None, max_length=50)
    strength_unit: Optional[str] = Field(None, max_length=50)
    dose_amount: Optional[float] = None
    dose_unit: Optional[str] = Field(None, max_length=50)
    route: Optional[MedicationRoute] = None
    frequency: Optional[MedicationFrequency] = None
    scheduled_times: Optional[List[str]] = None
    scheduled_weekdays: Optional[List[int]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[MedicationStatus] = None
    purpose: Optional[str] = Field(None, max_length=500)
    instructions: Optional[str] = None
    prescriber: Optional[str] = Field(None, max_length=255)
    prn: Optional[bool] = None
    reminder_enabled: Optional[bool] = None
    notes: Optional[str] = None
    supply_quantity: Optional[float] = None
    supply_started_on: Optional[date] = None
    refills_left: Optional[int] = None


# ─────────────────────────────────────────────────────────────────────────────
# Response
# ─────────────────────────────────────────────────────────────────────────────

class MedicationResponse(BaseModel):
    """Schema for medication response."""
    medication_id: UUID
    patient_id: UUID
    name: str
    generic_name: Optional[str] = None
    brand_name: Optional[str] = None
    strength: Optional[str] = None
    strength_unit: Optional[str] = None
    dose_amount: Optional[float] = None
    dose_unit: Optional[str] = None
    route: Optional[MedicationRoute] = None
    frequency: MedicationFrequency
    scheduled_times: Optional[List[str]] = None
    scheduled_weekdays: Optional[List[int]] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: MedicationStatus
    purpose: Optional[str] = None
    instructions: Optional[str] = None
    prescriber: Optional[str] = None
    prn: bool
    reminder_enabled: bool
    notes: Optional[str] = None
    source_document_id: Optional[UUID] = None
    supply_quantity: Optional[float] = None
    supply_started_on: Optional[date] = None
    refills_left: Optional[int] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MedicationListResponse(BaseModel):
    """Schema for list of medications."""
    medications: List[MedicationResponse]
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Medication Taken Events
# ─────────────────────────────────────────────────────────────────────────────

class MedicationTakenCreate(BaseModel):
    """Schema for recording a medication dose taken."""
    medication_id: UUID
    taken_at: Optional[datetime] = None  # Defaults to now if not provided
    scheduled_for: Optional[datetime] = None
    dose_taken: Optional[float] = None
    dose_unit: Optional[str] = Field(None, max_length=50)
    status: DoseTakenStatus = DoseTakenStatus.TAKEN
    notes: Optional[str] = None
    clinical_event_id: Optional[UUID] = None  # Link to existing ClinicalEvent if applicable


class MedicationTakenResponse(BaseModel):
    """Schema for medication taken event response."""
    event_id: UUID
    medication_id: UUID
    patient_id: UUID
    taken_at: datetime
    scheduled_for: Optional[datetime] = None
    dose_taken: Optional[float] = None
    dose_unit: Optional[str] = None
    status: DoseTakenStatus
    notes: Optional[str] = None
    clinical_event_id: Optional[UUID] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class MedicationTakenListResponse(BaseModel):
    """Schema for list of medication taken events."""
    events: List[MedicationTakenResponse]
    total: int


# ─────────────────────────────────────────────────────────────────────────────
# Active Medications for Daily Log
# ─────────────────────────────────────────────────────────────────────────────

class ActiveMedicationForDailyLog(BaseModel):
    """Schema for active medications shown in daily log."""
    medication_id: UUID
    name: str
    strength: Optional[str] = None
    strength_unit: Optional[str] = None
    dose_amount: Optional[float] = None
    dose_unit: Optional[str] = None
    frequency: MedicationFrequency
    scheduled_times: Optional[List[str]] = None
    route: Optional[MedicationRoute] = None
    prn: bool

    class Config:
        from_attributes = True


class DailyMedicationSchedule(BaseModel):
    """Schema for today's medication schedule with taken status."""
    medication: ActiveMedicationForDailyLog
    scheduled_time: str  # "08:00"
    taken: bool = False
    taken_event_id: Optional[UUID] = None
    taken_at: Optional[datetime] = None