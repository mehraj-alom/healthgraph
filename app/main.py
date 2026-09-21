import asyncio
from contextlib import asynccontextmanager
import os
import time as _time
from uuid import uuid4 as _uuid4

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from agents.agent_setup import close_agent, get_medical_agent, initialize_agent
from app.api.auth import router as auth_router
from app.api.v1 import (
    body_state,
    chat,
    daily_logs,
    daily_metrics,
    documents,
    health_graph,
    logs,
    medications,
    nutrition,
    ontology,
    outbox,
    ppg,
    privacy,
    profile,
    provenance,
    review,
    statements,
    summaries,
    timeline,
    trends,
)
from core.config import initialize_firebase, settings
from core.db import SessionLocal, engine
from core.neo4j_client import close_neo4j_driver
from core.security_events import log_security_event
from logger import logger
from models.base import Base
import models.summaries  # noqa: F401 — ensure summary tables are registered with Base.metadata
from services.deidentification.deidentifier import DeIdentificationService
from scripts.migrate_outbox_enum import ensure_enum_values
from services.ontology_seed import seed_medical_concepts
from services.vectorization.qdrant_client import vector_db

load_dotenv()


def _marker(name: str):
    now = _time.monotonic()
    prev = getattr(_marker, "_t", None)
    delta = f" +{now - prev:.1f}s" if prev is not None else ""
    _marker._t = now
    logger.info("START %s%s", name, delta)
    return now


def _done(name: str, t0) -> None:
    logger.info("DONE %s (%.1fs)", name, _time.monotonic() - t0)


def _ensure_nutrition_columns() -> None:
    """Idempotent backfill for the food-scan nutrition columns.

    Alembic migrations are not executed at startup (only
    Base.metadata.create_all, which never alters existing tables), so
    databases created before revision e7f8a9b0c1d2 lack
    payload_nutrition.calories_kcal / food_label and every check-in
    carrying a nutrition block 500s with UndefinedColumn. ADD COLUMN
    IF NOT EXISTS heals them without touching anything else.

    Non-fatal by design: if it fails, startup continues and only
    nutrition-bearing check-ins keep 500ing (current behavior) instead
    of gating the whole API behind readiness.
    """
    from sqlalchemy import text

    try:
        with engine.connect() as conn:
            conn.execute(
                text(
                    "ALTER TABLE payload_nutrition "
                    "ADD COLUMN IF NOT EXISTS calories_kcal INTEGER"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE payload_nutrition "
                    "ADD COLUMN IF NOT EXISTS food_label VARCHAR(255)"
                )
            )
            conn.commit()
    except Exception:
        logger.warning(
            "Nutrition column backfill skipped; check-ins with "
            "nutrition data may 500 until e7f8a9b0c1d2 is applied.",
            exc_info=True,
        )


def _db_init() -> None:
    """Sync PostgreSQL schema/migration/seed steps (blocking psycopg2).

    Moved out of create_app() so module import and socket binding never
    depend on database reachability. Runs inside a worker thread from
    the startup hooks task.
    """
    _marker("hooks.enum_migrate")
    try:
        ensure_enum_values()
    except Exception:
        logger.warning("Enum migration skipped (table may not exist yet).")
    _done("hooks.enum_migrate", _marker("hooks.create_all"))

    _marker("hooks.create_all")
    Base.metadata.create_all(bind=engine)
    _done("hooks.create_all", _marker("hooks.nutrition_columns"))

    _marker("hooks.nutrition_columns")
    _ensure_nutrition_columns()
    _done("hooks.nutrition_columns", _marker("hooks.seed"))

    _marker("hooks.seed")
    db = SessionLocal()
    try:
        seed_medical_concepts(db)
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    _done("hooks.seed", _marker("hooks.seed.done"))


async def _run_startup_hooks(app: FastAPI, secret_key) -> None:
    """Run deferred startup initialization as a background task.

    Every expensive external dependency is initialized here instead of
    before socket binding, so uvicorn reports "Application startup
    complete" immediately and /health responds inside the deployment
    window even if a dependency is slow or unreachable.

    app.state.ready becomes True only when ALL dependencies are ready;
    on any failure it stays False and non-/health endpoints return 503
    (clear failure, never silent partial initialization).
    """
    loop = asyncio.get_running_loop()
    try:
        await loop.run_in_executor(None, _db_init)

        _marker("lifespan.qdrant.setup")
        # P7: vector-store outage must not gate the whole API. Degrade to
        # PG-only evidence with an explicit flag instead of ready=False.
        try:
            app.state.qdrant_client = await loop.run_in_executor(
                None, vector_db.setup_collection
            )
            app.state.qdrant_degraded = False
        except Exception:
            app.state.qdrant_client = None
            app.state.qdrant_degraded = True
            logger.exception(
                "Qdrant setup failed — continuing degraded (document search "
                "unavailable, PG evidence only)"
            )
        _done("lifespan.qdrant.setup", _marker("lifespan.firebase.init"))

        # P7: initialize_firebase returns False (not raise) on malformed
        # credentials — failing over to ready=True would 401 every request.
        _firebase_ok = await loop.run_in_executor(None, initialize_firebase)
        if _firebase_ok is False:
            raise RuntimeError("Firebase Admin SDK initialization failed.")
        _done("lifespan.firebase.init", _marker("lifespan.deidentifier.init"))

        app.state.deidentifier = DeIdentificationService(
            secret_key.encode() if isinstance(secret_key, str) else secret_key
        )
        _done("lifespan.deidentifier.init", _marker("lifespan.agent.init"))

        await initialize_agent()
        app.state.medical_agent = get_medical_agent()
        _done("lifespan.agent.init", _marker("lifespan.ready"))

        app.state.ready = True
        logger.info(
            "STARTUP HOOKS COMPLETE - all dependencies initialized; "
            "app.state.ready=True"
        )
    except Exception:
        app.state.ready = False
        logger.exception(
            "STARTUP HOOKS FAILED - serving /health only; all other "
            "endpoints return 503 until the cause is fixed "
            "(app.state.ready=False)"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting up the FastAPI application.")
    t_lifespan = _time.monotonic()

    _marker("lifespan.secret.settings")
    secret_key = settings.secret_key

    if not secret_key:
        logger.error("Secret key not found in environment variables.")
        raise RuntimeError("Secret key not found in environment variables.")

    if secret_key == "dev-secret-key":
        logger.warning(
            "secret_key is set to the well-known development default "
            "'dev-secret-key'. De-identification pseudonymization is "
            "reversible with the default value. Set a strong, unique "
            "secret_key in production (see .env.example)."
        )
    _done("lifespan.secret.settings", _marker("lifespan.background.start"))

    # Do NOT block the event loop: run all expensive external
    # initialization as a background task so uvicorn reports startup
    # complete immediately and /health responds inside the deployment
    # window even if a dependency stalls or is unreachable.
    app.state.startup_task = asyncio.create_task(_run_startup_hooks(app, secret_key))
    logger.info("START lifespan.background.start (deferred hooks task spawned)")

    yield

    logger.info("Shutting down the FastAPI application.")

    # Stop handing out the agent to new requests BEFORE closing the
    # connection pool so in-flight handlers fail fast instead of
    # hitting a closed pool.
    app.state.medical_agent = None

    if app.state.startup_task is not None and not app.state.startup_task.done():
        app.state.startup_task.cancel()

    await close_agent()

    close_neo4j_driver()

    # P7: release pooled PG connections on shutdown.
    try:
        from core.db import engine as _engine

        _engine.dispose()
    except Exception:
        logger.exception("Engine dispose failed during shutdown.")


def create_app() -> FastAPI:
    logger.info("Initializing FastAPI application.")
    t_start = _marker("create_app")

    _t_build = _marker("create_app.build")

    # Interactive API docs / schema are a development and preview surface,
    # not a production one: they expose the full endpoint model publicly.
    # Disabled in PRODUCTION; /health is unaffected. (Per Increment 6.)
    _docs_enabled = settings.APP_ENV != "production"

    app = FastAPI(
        title="MedGraph Core API",
        description="Longitudinal Health Timeline & Automated Extraction API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if _docs_enabled else None,
        redoc_url="/redoc" if _docs_enabled else None,
        openapi_url="/openapi.json" if _docs_enabled else None,
    )

    # CORS configuration: restrict to explicit origins.
    # React Native/Expo does not enforce browser CORS, so this only
    # affects browser-based access (dev console, web admin).
    # Set CORS_ORIGINS env var to a comma-separated list for production.
    cors_origins_str = os.getenv("CORS_ORIGINS", "")
    if cors_origins_str:
        cors_origins = [
            origin.strip()
            for origin in cors_origins_str.split(",")
            if origin.strip()
        ]
    else:
        # P7: empty CORS_ORIGINS means most restrictive. In production that
        # is deny-all; outside production the dev console needs open access
        # (safe: allow_credentials is False, auth uses Bearer tokens).
        cors_origins = [] if settings.APP_ENV == "production" else ["*"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Readiness gate: /health and the static dev console never depend on
    # external services and respond immediately; every other endpoint
    # returns 503 until the deferred startup hooks finish (or 503 forever
    # if they failed) so failures are loud instead of partial.
    app.state.ready = False
    app.state.startup_task = None

    @app.middleware("http")
    async def readiness_gate(request, call_next):
        if not app.state.ready and request.url.path not in ("/health", "/ready", "/"):
            return JSONResponse(
                status_code=503,
                content={
                    "detail": (
                        "Service is initializing and not ready yet. "
                        "Please retry shortly."
                    )
                },
            )
        return await call_next(request)

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        # Assign/extract a correlation id used in every security/ops log
        # and returned to the client. Only the id itself is ever logged.
        request_id = request.headers.get("x-request-id") or str(_uuid4())
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        # Never leak exception internals to clients. Log the category and
        # correlation id only (no bodies, no values, no paths).
        request_id = getattr(request.state, "request_id", "-")
        logger.exception(
            "Unhandled exception: endpoint=%s request_id=%s type=%s",
            request.url.path,
            request_id,
            type(exc).__name__,
        )
        log_security_event(
            "unhandled_5xx",
            request_id=request_id,
            endpoint=request.url.path,
            status=500,
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal Server Error"},
            headers={"X-Request-ID": request_id},
        )

    app.include_router(auth_router)
    app.include_router(documents.router)
    app.include_router(nutrition.router)
    app.include_router(review.router)
    app.include_router(provenance.router)
    app.include_router(timeline.router)
    app.include_router(daily_logs.router)
    app.include_router(daily_metrics.router)
    app.include_router(chat.router)
    app.include_router(body_state.router)
    app.include_router(summaries.router)
    app.include_router(statements.router)
    app.include_router(logs.router)
    app.include_router(outbox.router)
    app.include_router(ontology.router)
    app.include_router(ppg.router)
    app.include_router(privacy.router)
    app.include_router(profile.router)
    app.include_router(trends.router)
    app.include_router(health_graph.router)
    app.include_router(medications.router)

    @app.get("/health", tags=["System"])
    def health_check():
        return {
            "status": "ok",
            "service": "MedGraph API",
        }

    @app.get("/ready", tags=["System"])
    def readiness_check():
        """Readiness (distinct from liveness): 200 only when startup hooks
        completed. Cheap flag check — no dependency I/O. Orchestrators
        should probe /ready, not /health, for traffic gating."""
        if getattr(app.state, "ready", False):
            return {"status": "ready", "service": "MedGraph API"}
        return JSONResponse(
            status_code=503,
            content={"status": "not-ready", "service": "MedGraph API"},
        )

    @app.get("/", include_in_schema=False)
    def dev_console():
        """Serve the web app. Tries frontend/web/index.html first,
        falls back to root index.html (legacy dev console)."""
        if settings.APP_ENV == "production":
            return JSONResponse(status_code=404, content={"detail": "Not Found"})

        # Try the new web app first
        web_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "frontend", "web", "index.html",
        )
        if os.path.exists(web_path):
            return FileResponse(web_path, media_type="text/html")

        # Fallback to legacy root index.html
        root_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)),
            "index.html",
        )
        if os.path.exists(root_path):
            return FileResponse(root_path, media_type="text/html")

        return {"detail": "Web app not found."}

    _done("create_app.build", _t_build)
    _done("create_app", t_start)
    return app


app = create_app()


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )