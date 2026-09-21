import uuid
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import get_db
from core.config import settings
from core.rate_limiter import RateLimiter
from models.identity import Patient  # Ensure your Patient model has a `firebase_uid` column
from logger import logger
security = HTTPBearer()

# General abuse-protection limits for cheap, authenticated API operations.
# These are abuse-protection budgets, not product quotas; the headroom is
# high so normal HealthGraph usage is never affected. They are checked
# inside the canonical auth dependency so every authenticated request is
# covered without editing every router, and the identity is ALWAYS the
# verified canonical patient UUID (never client input).
_READ_LIMIT = 120   # requests / minute / authenticated user
_WRITE_LIMIT = 60   # requests / minute / authenticated user
_RATE_WINDOW_SECONDS = 60
_general_limiter = RateLimiter()


def get_authenticated_patient_id(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db)
) -> uuid.UUID:
    """
    Validates the Firebase JWT and maps it to the internal canonical patient_id.
    This enforces the Tenant Isolation boundary at the API gateway.
    """
    token = credentials.credentials
    
    # Cryptographic Verification via Firebase Admin SDK
    try:
        decoded_token = auth.verify_id_token(token)
        firebase_uid = decoded_token.get("uid")
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token has expired.")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid authentication token.")
    except Exception as e:
        logger.error(f"Firebase auth error: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication failed.")

    if not firebase_uid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload.")

    #Map Identity: Firebase UID -> PostgreSQL patient_id
    stmt = select(Patient.patient_id).where(Patient.firebase_uid == firebase_uid)
    patient_id = db.execute(stmt).scalar_one_or_none()

    if not patient_id:
        # The user is authenticated in Firebase, but hasn't completed backend onboarding.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User identity established, but no corresponding patient record exists in the clinical database. Please complete registration."
        )

    # General per-patient read/write abuse protection. Cheap operations
    # fail open ONLY in local (a dev box without Redis must work);
    # preview/production fail closed so a Redis outage cannot silently
    # disable abuse protection. (Chat/upload already fail closed outside
    # local; this aligns the general limiter with them.)
    operation = (
        "writes" if request.method in ("POST", "PUT", "PATCH", "DELETE") else "reads"
    )
    limit = _WRITE_LIMIT if operation == "writes" else _READ_LIMIT
    _general_limiter.check(
        str(patient_id),
        operation,
        limit,
        _RATE_WINDOW_SECONDS,
        fail_open=settings.APP_ENV == "local",
    )

    return patient_id