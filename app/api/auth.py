import uuid
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel

from core.db import get_db
from models.identity import Patient

router = APIRouter(prefix="/api/v1/auth", tags=["Identity Sync"])
security = HTTPBearer()

class SyncResponse(BaseModel):
    patient_id: uuid.UUID
    status: str

@router.post("/sync", response_model=SyncResponse)
async def sync_firebase_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """
    Called by Flutter immediately after a successful Firebase signup.
    Creates the internal PostgreSQL Patient record linked to the Firebase UID.
    """
    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        firebase_uid = decoded_token.get("uid")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    # Check if patient already exists (idempotent operation)
    stmt = select(Patient.patient_id).where(Patient.firebase_uid == firebase_uid)
    existing_patient_id = db.execute(stmt).scalar_one_or_none()

    if existing_patient_id:
        return SyncResponse(patient_id=existing_patient_id, status="already_synced")

    # Create new canonical patient in the System of Record
    new_patient_id = uuid.uuid4()
    new_patient = Patient(
        patient_id=new_patient_id,
        firebase_uid=firebase_uid
        # Add other fields here if you pass them from Flutter (e.g., name, DOB)
    )
    
    db.add(new_patient)
    db.commit()

    return SyncResponse(patient_id=new_patient_id, status="created")