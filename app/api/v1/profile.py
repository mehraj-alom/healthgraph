import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.identity import Patient
from schemas.profile import PatientProfileResponse, PatientProfileUpdate


router = APIRouter(
    prefix="/api/v1/profile",
    tags=["profile"],
)


def _get_or_create_patient(db: Session, patient_id: uuid.UUID) -> Patient:
    """Get existing patient or create a new one from the authenticated ID."""
    patient = db.get(Patient, patient_id)
    if patient is None:
        # Patient row should exist from auth sync, but create if missing
        patient = Patient(
            patient_id=patient_id,
            firebase_uid="",
        )
        db.add(patient)
        db.flush()
    return patient


@router.get("", response_model=PatientProfileResponse)
def get_profile(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Retrieve the authenticated patient's health profile.

    Returns null for any fields not yet set.
    """
    patient = _get_or_create_patient(db, patient_id)

    return PatientProfileResponse(
        display_name=patient.full_name,
        phone_number=patient.phone_number,
        height_cm=patient.height_cm,
        weight_kg=patient.weight_kg,
    )


@router.put("", response_model=PatientProfileResponse)
def update_profile(
    payload: PatientProfileUpdate,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Update the authenticated patient's health profile.

    Fields explicitly included in the request are updated, even if null.
    Fields omitted from the request are left unchanged.
    The frontend sends null to clear optional fields, so we must
    distinguish between "not provided" (absent from payload) and
    "explicitly set to null" (present but None).
    """
    patient = _get_or_create_patient(db, patient_id)
    provided = payload.model_fields_set

    if "display_name" in provided:
        patient.full_name = (payload.display_name or "").strip() or None

    if "phone_number" in provided:
        patient.phone_number = (payload.phone_number or "").strip() or None

    if "height_cm" in provided:
        patient.height_cm = payload.height_cm

    if "weight_kg" in provided:
        patient.weight_kg = payload.weight_kg

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Failed to update profile.",
        )

    return PatientProfileResponse(
        display_name=patient.full_name,
        phone_number=patient.phone_number,
        height_cm=patient.height_cm,
        weight_kg=patient.weight_kg,
    )
