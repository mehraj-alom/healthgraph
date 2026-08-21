"""Core configuration settings for the application.
The only file that will handle the configureation for the whole application."""

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://medgraph:password@localhost:5432/medgraph_db"
    FIREBASE_CREDENTIALS_PATH: str = "firebase-adminsdk.json"


    CELERY_BROKER_URL : str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND : str = "redis://localhost:6379/0"
    
    # 450m vision language model for document classification and extraction
    MODEL_PATH: str = "./models/lfm-2.5-vl-450m-q4_k_m.gguf"
    MMPROJ_PATH: str = "./models/lfm-2.5-vl-450m-mmproj.gguf"


    STORAGE_DIR: str = "./storage/documents"
    class Config:
        env_file = ".env"

settings = Settings()