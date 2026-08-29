from contextlib import asynccontextmanager
import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from dotenv import load_dotenv

from app.api.auth import router as auth_router
from app.api.v1 import (
    body_state,
    chat,
    daily_logs,
    daily_metrics,
    documents,
    logs,
    ontology,
    provenance,
    review,
    timeline,
)
from agents.agent_setup import close_agent, initialize_agent
from core.config import initialize_firebase
from core.db import engine
from core.neo4j_client import close_neo4j_driver
from logger import logger
from models.base import Base
from services.deidentification.deidentifier import DeIdentificationService
from services.vectorization.qdrant_client import vector_db
from services.ontology_seed import seed_medical_concepts

load_dotenv()


from core.config import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for FastAPI application."""
    logger.info("Starting up the FastAPI application.")
    secret_key = settings.secret_key
    if not secret_key:
        logger.error("Secret key not found in environment variables.")
        raise RuntimeError("Secret key not found in environment variables.")

    app.state.deidentifier = DeIdentificationService(secret_key.encode() if isinstance(secret_key, str) else secret_key)
    app.state.qdrant_client = vector_db.setup_collection()
    initialize_firebase()
    await initialize_agent()
    # Store agent in app.state for access without globals
    from agents.agent_setup import medical_agent
    logger.info(f"DEBUG: medical_agent after init = {medical_agent}")
    app.state.medical_agent = medical_agent
    logger.info(f"DEBUG: app.state.medical_agent set = {app.state.medical_agent}")
    yield

    logger.info("Shutting down the FastAPI application.")
    await close_agent()
    close_neo4j_driver()


def create_app() -> FastAPI:
    """Application factory for FastAPI."""
    logger.info("Initializing FastAPI application.")
    Base.metadata.create_all(bind=engine)
    from core.db import SessionLocal
    db = SessionLocal()
    try:
        seed_medical_concepts(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()

    app = FastAPI(
        title="MedGraph Core API",
        description="Longitudinal Health Timeline & Automated Extraction API",
        version="1.0.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth_router)
    app.include_router(documents.router)
    app.include_router(review.router)
    app.include_router(provenance.router)
    app.include_router(timeline.router)
    app.include_router(daily_logs.router)
    app.include_router(daily_metrics.router)
    app.include_router(chat.router)
    app.include_router(body_state.router)
    app.include_router(logs.router)
    app.include_router(ontology.router)

    @app.get("/health", tags=["System"])
    def health_check():
        """Basic health check endpoint."""
        return {"status": "ok", "service": "MedGraph API"}

    # Development console - serves index.html at root
    @app.get("/", include_in_schema=False)
    def dev_console():
        index_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, media_type="text/html")
        return {"detail": "Dev console not found. Place index.html in the project root."}

    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)


