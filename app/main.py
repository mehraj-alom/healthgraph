
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from logger import logger
import uvicorn
# Database imports
from core.db import engine
from models.base import Base

# Router imports
from api.v1 import documents, review ,provenance, timeline,daily_logs


# Configure logging
#TODO : Configure logging to write to a file and set the appropriate log level

def create_app() -> FastAPI:
    """Application factory for FastAPI."""
    logger.info("Initializing FastAPI application.")
    # Optional: If you are using Alembic for migrations (recommended), 
    # remove this line. If developing locally without Alembic, this 
    # automatically creates your tables.
    Base.metadata.create_all(bind=engine)
    
    app = FastAPI(
        title="MedGraph Core API",
        description="Longitudinal Health Timeline & Automated Extraction API",
        version="1.0.0",
    )

    # Configure CORS for frontend access
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Restrict to your frontend domain in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    #Document Upload & Ingestion Trigger
    app.include_router(documents.router, prefix="/api")
    # The Review Queue & Alias Learning API
    app.include_router(review.router, prefix="/api")
    # Provenance API for fetching visual evidence of events
    app.include_router(provenance.router, prefix="/api")
    # Timeline API for fetching longitudinal health events
    app.include_router(timeline.router, prefix="/api")
    # Daily Logs API for submitting daily health logs
    app.include_router(daily_logs.router, prefix="/api")

    @app.get("/health", tags=["System"])
    def health_check():
        """Basic health check endpoint."""
        return {"status": "ok", "service": "MedGraph API"}

    return app

app = create_app()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)




