from pydantic import BaseModel, Field


def clean_id_list(value: list | None) -> list[str] | None:
    """Sanitize a preference id list: strings only, trimmed, capped."""
    if value is None:
        return None
    return [v.strip() for v in value if isinstance(v, str) and v.strip()][:20]


class PatientProfileResponse(BaseModel):
    """Response schema for GET /api/v1/profile."""
    display_name: str | None = None
    email: str | None = None
    phone_number: str | None = None
    height_cm: float | None = None
    weight_kg: float | None = None
    goals: list[str] | None = None
    focus: list[str] | None = None
    # Premium entitlement (server truth; read-only here — only the
    # billing verify endpoint writes it).
    premium_tier: str = "free"
    premium_expires_at: str | None = None


class PatientProfileUpdate(BaseModel):
    """Request schema for PUT /api/v1/profile.
    
    All fields are optional — only provided fields are updated.
    goals/focus are device-owned preference mirrors (stable option ids).
    """
    display_name: str | None = Field(None, max_length=128)
    phone_number: str | None = Field(None, max_length=32)
    height_cm: float | None = Field(None, gt=0, lt=300)  # 0–300 cm
    weight_kg: float | None = Field(None, gt=0, lt=500)  # 0–500 kg
    # Loosely typed on purpose: a junk preference list must never 422 the
    # whole profile save — clean_id_list sanitizes before storage.
    goals: list | None = None
    focus: list | None = None
