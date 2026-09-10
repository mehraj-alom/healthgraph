"""Core configuration settings for the application.
The only file that will handle the configuration for the whole application."""

import os
import json

import firebase_admin
from firebase_admin import credentials
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from logger import logger


def initialize_firebase():
    """Initializes the Firebase Admin SDK if credentials are available."""
    if firebase_admin._apps:
        return

    # Fail fast: if neither credential source is set, do not fall through
    # to default credentials (which don't exist on Voroa).
    cred_value = os.getenv("FIREBASE_CREDENTIALS_JSON") or os.getenv("FIREBASE_CREDENTIALS_PATH")
    if not cred_value:
        raise RuntimeError(
            "Firebase credentials not configured. "
            "Set FIREBASE_CREDENTIALS_JSON (inline JSON) or "
            "FIREBASE_CREDENTIALS_PATH (path to service-account file)."
        )

    try:
        cred_data = None
        if cred_value and cred_value.lstrip().startswith("{"):
            # The env var itself contains the serialized service-account JSON
            # (the practical delivery mechanism on container PaaS such as
            # Voroa, where a secret can be injected as an env var directly).
            cred_data = json.loads(cred_value)
            cred_path = None
        elif cred_value and os.path.exists(cred_value):
            with open(cred_value, "r", encoding="utf-8") as f:
                cred_data = json.load(f)
            cred_path = cred_value

        if cred_data:
            credential_project_id = cred_data.get("project_id")
            configured_project_id = os.getenv("GOOGLE_CLOUD_PROJECT")

            if credential_project_id:
                # Keep runtime project explicit for SDKs that rely on GOOGLE_CLOUD_PROJECT.
                if not configured_project_id:
                    os.environ["GOOGLE_CLOUD_PROJECT"] = credential_project_id
                elif configured_project_id != credential_project_id:
                    raise RuntimeError(
                        "GOOGLE_CLOUD_PROJECT does not match firebase service-account project_id "
                        f"({configured_project_id} != {credential_project_id})"
                    )

            if cred_path:
                cred = credentials.Certificate(cred_path)
            else:
                cred = credentials.Certificate(cred_data)
            firebase_admin.initialize_app(cred)
            logger.info(
                "Firebase Admin SDK initialized using certificate for project %s.",
                os.getenv("GOOGLE_CLOUD_PROJECT", credential_project_id),
            )
            return

        # Neither FIREBASE_CREDENTIALS_JSON nor FIREBASE_CREDENTIALS_PATH provided
        # a usable credential. Default credentials (GCP metadata) are not available
        # on Voroa, so falling through here would silently leave Firebase un-initialized
        # and cause every authenticated endpoint to 401. Fail loudly at startup.
        raise RuntimeError(
            "Firebase credentials not configured. "
            "Set FIREBASE_CREDENTIALS_JSON (inline JSON) or "
            "FIREBASE_CREDENTIALS_PATH (path to service-account file)."
        )
    except Exception as e:
        logger.warning(f"Firebase Admin SDK not initialized; continuing without it: {e}")
        return False

    return True


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    DATABASE_URL: str = "postgresql://medgraph:password@localhost:5432/medgraph_db"
    ASYNC_DATABASE_URL: str = "postgresql+asyncpg://medgraph:password@localhost:5432/medgraph_db"
    FIREBASE_CREDENTIALS_PATH: str = "firebase-adminsdk.json"
    secret_key: str = Field(default="dev-secret-key", alias="secret_key")

    # Required in every deployment. Voroa provides these as service
    # environment variables (rediss://...); local dev provides them via
    # .env / docker-compose. There is deliberately NO localhost fallback:
    # silently falling back to a non-existent local Redis hides
    # misconfiguration, so core/celery_app.py fails fast if either is
    # empty.
    CELERY_BROKER_URL: str = ""
    CELERY_RESULT_BACKEND: str = ""

    STORAGE_DIR: str = "./storage/documents"

    # CORS origins — comma-separated list of allowed origins.
    # React Native/Expo does not enforce CORS, so this only affects
    # browser-based access (dev console, web admin).
    # Empty string = no cross-origin allowed (most restrictive).
    CORS_ORIGINS: str = ""


settings = Settings()