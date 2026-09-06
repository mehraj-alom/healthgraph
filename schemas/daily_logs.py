from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import date
from uuid import UUID

class VitalSignCreate(BaseModel):
    concept_id: UUID
    value: Optional[float] = None
    unit: Optional[str] = None

class SymptomCreate(BaseModel):
    concept_id: UUID
    severity: int = Field(ge=1, le=10)
    duration_minutes: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = None

class PainCreate(BaseModel):
    body_location_id: Optional[UUID] = None
    structure_id: Optional[str] = Field(None, max_length=64)
    severity: int = Field(ge=1, le=10)
    pain_type: Optional[str] = None

class SleepCreate(BaseModel):
    duration_minutes: int
    sleep_quality: Optional[int] = Field(None, ge=1, le=5)
    awakenings: Optional[int] = Field(None, ge=0)

class ActivityCreate(BaseModel):
    activity_type: str
    duration_minutes: Optional[int] = None
    calories_burned: Optional[float] = None

class NutritionCreate(BaseModel):
    water_ml: Optional[int] = None
    meals_count: Optional[int] = None
    appetite_level: Optional[int] = Field(None, ge=1, le=5)

class MedicationTakenCreate(BaseModel):
    medication_name: str
    dosage_value: Optional[float] = None
    dosage_unit: Optional[str] = None

class DailyCheckInRequest(BaseModel):
    """The complete API payload for a daily log."""
    log_date: date
    
    # Wellbeing (Singular)
    overall_wellbeing: Optional[int] = Field(None, ge=1, le=5)
    energy_level: Optional[int] = Field(None, ge=1, le=5)
    stress_level: Optional[int] = Field(None, ge=1, le=5)
    
    # Singular Logs
    sleep: Optional[SleepCreate] = None
    nutrition: Optional[NutritionCreate] = None
    notes: Optional[str] = Field(None, max_length=4000)
    
    #Multiple Logs (Arrays)
    symptoms: List[SymptomCreate] = Field(default_factory=list)
    vitals: List[VitalSignCreate] = Field(default_factory=list)
    pain: List[PainCreate] = Field(default_factory=list)
    activities: List[ActivityCreate] = Field(default_factory=list)
    medications: List[MedicationTakenCreate] = Field(default_factory=list)
