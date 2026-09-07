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

    try:
        cred_path = os.getenv("FIREBASE_CREDENTIALS_JSON") or os.getenv("FIREBASE_CREDENTIALS_PATH")
        if cred_path and os.path.exists(cred_path):
            with open(cred_path, "r", encoding="utf-8") as f:
                cred_data = json.load(f)

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

            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
            logger.info(
                "Firebase Admin SDK initialized using certificate for project %s.",
                os.getenv("GOOGLE_CLOUD_PROJECT", credential_project_id),
            )
            return

        firebase_admin.initialize_app()
        logger.info("Firebase Admin SDK initialized using default credentials.")
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

    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/0"

    # 450m vision language model for document classification and extraction
    MODEL_PATH: str = "./models/lfm-2.5-vl-450m-q4_k_m.gguf"
    MMPROJ_PATH: str = ""

    STORAGE_DIR: str = "./storage/documents"

    # CORS origins — comma-separated list of allowed origins.
    # React Native/Expo does not enforce CORS, so this only affects
    # browser-based access (dev console, web admin).
    # Empty string = no cross-origin allowed (most restrictive).
    CORS_ORIGINS: str = ""


settings = Settings()