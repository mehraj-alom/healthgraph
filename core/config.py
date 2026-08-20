"""Core configuration settings for the application.
The only file that will handle the configureation for the whole application."""

from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql://medgraph:password@localhost:5432/medgraph_db"
    FIREBASE_CREDENTIALS_PATH: str = "firebase-adminsdk.json"
    
    class Config:
        env_file = ".env"

settings = Settings()