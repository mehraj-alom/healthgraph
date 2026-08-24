"""Core configuration settings for the application.
The only file that will handle the configuration for the whole application."""

from pydantic_settings import BaseSettings
import os

import firebase_admin
from firebase_admin import credentials
from logger import logger

def initialize_firebase():
    """Initializes the Firebase Admin SDK."""
    if not firebase_admin._apps:
        try:
            # Assumes you have your FIREBASE_CREDENTIALS_JSON path in your env
            cred_path = os.getenv("FIREBASE_CREDENTIALS_JSON")
            if cred_path and os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
                firebase_admin.initialize_app(cred)
                logger.info("Firebase Admin SDK initialized using certificate.")
            else:
                # Fallback for GCP environments (Cloud Run/Functions) where default credentials exist
                firebase_admin.initialize_app()
                logger.info("Firebase Admin SDK initialized using default credentials.")
        except Exception as e:
            logger.critical(f"Failed to initialize Firebase Admin SDK: {e}")
            raise


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://medgraph:password@localhost:5432/medgraph_db"
    FIREBASE_CREDENTIALS_PATH: str = "firebase-adminsdk.json"


    CELERY_BROKER_URL : str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND : str = "redis://localhost:6379/0"
    
    # 450m vision language model for document classification and extraction
    MODEL_PATH: str = "./models/lfm-2.5-vl-450m-q4_k_m.gguf"
    MMPROJ_PATH: str = "./models/lfm-2.5-vl-450m-mmproj.gguf"

    # Initialize Firebase when settings are loaded , 
    initialize_firebase() # call this (eg: Settings.initialize_firebase()) to initialize Firebase Admin SDK when the settings are loaded
    STORAGE_DIR: str = "./storage/documents"
    class Config:
        env_file = ".env"

settings = Settings()