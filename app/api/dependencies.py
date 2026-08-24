import uuid
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from firebase_admin import auth
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import get_db
from models.identity import Patient  # Ensure your Patient model has a `firebase_uid` column
from logger import logger
security = HTTPBearer()

def get_authenticated_patient_id(
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

    return patient_id