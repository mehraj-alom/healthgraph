from pydantic import BaseModel, Field


class PatientProfileResponse(BaseModel):
    """Response schema for GET /api/v1/profile."""
    display_name: str | None = None
    email: str | None = None
    phone_number: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None


class PatientProfileUpdate(BaseModel):
    """Request schema for PUT /api/v1/profile.
    
    All fields are optional — only provided fields are updated.
    """
    display_name: str | None = Field(None, max_length=128)
    phone_number: str | None = Field(None, max_length=32)
    height_cm: float | None = Field(None, gt=0, lt=300)  # 0–300 cm
    weight_kg: float | None = Field(None, gt=0, lt=500)  # 0–500 kg
