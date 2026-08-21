import firebase_admin
from firebase_admin import credentials, auth
from fastapi import HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from core.config import settings
from logger import auth_logger as logger

try : 
    credentials = credentials.Certificate(settings.FIREBASE_CREDENTIALS_PATH)
    firebase_admin.initialize_app(credentials)
except Exception as e:
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Failed to initialize Firebase Admin SDK: {str(e)}"
    )


security = HTTPBearer()

def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        user = auth.verify_id_token(credentials.credentials)
        if user :
            logger.info(f"User authenticated: {user['uid']}")
        return user
    except Exception as e:
        logger.error(f"Error occurred while verifying token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}"
        )