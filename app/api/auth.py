import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.orm import Session
from pydantic import BaseModel

from core.db import get_db
from core.rate_limiter import RateLimiter
from models.identity import Patient

router = APIRouter(prefix="/api/v1/auth", tags=["Identity Sync"])
security = HTTPBearer()

# Pre-authentication rate limit for auth attempts. Two layered guards run
# per attempt (see core/rate_limiter.guard_auth):
#   Layer 1 (IP):       10 attempts / 10 min per trusted client IP
#   Layer 2 (identity): 10 attempts / 10 min per verified Firebase uid
# Both layers fail open so users are never locked out of sign-in during a
# Redis blip, and repeated failures trigger a temporary expiring JIT block.
_auth_limiter = RateLimiter()
_AUTH_ATTEMPT_LIMIT = 10
_AUTH_ATTEMPT_WINDOW_SECONDS = 600
_AUTH_BLOCK_SECONDS = 900  # 15-minute temporary block (Redis TTL only)

class SyncResponse(BaseModel):
    patient_id: uuid.UUID
    status: str

@router.post("/sync", response_model=SyncResponse)
async def sync_firebase_user(
    http_request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
):
    """
    Called by Flutter immediately after a successful Firebase signup.
    Creates the internal PostgreSQL Patient record linked to the Firebase UID.
    """
    # Layer 1 — per trusted client IP (pre-authentication). The identity
    # comes from the connection address (see client_ip: header-derived
    # addresses are only trusted behind an explicit proxy configuration).
    _auth_limiter.guard_auth(
        _auth_limiter.client_ip(http_request),
        operation="auth_ip",
        limit=_AUTH_ATTEMPT_LIMIT,
        window_seconds=_AUTH_ATTEMPT_WINDOW_SECONDS,
        block_seconds=_AUTH_BLOCK_SECONDS,
        fail_open=True,  # never lock users out of sign-in during a Redis blip
    )

    token = credentials.credentials
    try:
        decoded_token = auth.verify_id_token(token)
        firebase_uid = decoded_token.get("uid")
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token.")

    # Layer 2 — per verified Firebase identity. Runs only once a principal
    # is actually established; an attacker rotating IPs still hits this
    # identity bucket, and rotating identities still hits the IP bucket.
    _auth_limiter.guard_auth(
        firebase_uid,
        operation="auth_identity",
        limit=_AUTH_ATTEMPT_LIMIT,
        window_seconds=_AUTH_ATTEMPT_WINDOW_SECONDS,
        block_seconds=_AUTH_BLOCK_SECONDS,
        fail_open=True,
    )

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