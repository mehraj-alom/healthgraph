from firebase_admin import auth
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from logger import auth_logger as logger

security = HTTPBearer()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        user = auth.verify_id_token(credentials.credentials)
        uid = user.get("uid") if isinstance(user, dict) else None
        if not uid:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: missing uid",
            )
        logger.info(f"User authenticated: {uid}")
        return uid
    except Exception as e:
        logger.error(f"Error occurred while verifying token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}",
        )
