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


def _production_validation_error(message: str) -> None:
    """Raise a hard, secret-safe start-up failure for production config.

    The message names environment variables only — never file paths,
    credential contents, or the secret value itself.
    """
    from logger import logger as _logger
    _logger.error(message)
    raise RuntimeError(message)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Runtime environment discriminator. LOCAL is the default so local
    # development never accidentally behaves as production. PREVIEW and
    # PRODUCTION must be set explicitly by the deployment environment.
    APP_ENV: str = "local"

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

    # Pakeet STT sidecar (localhost-only, Phase 5 voice transport). The
    # sidecar binds 127.0.0.1 and is never exposed publicly; the API
    # proxies authenticated patient turns to it. Override only to point at
    # an equivalent loopback sidecar.
    PAKEET_URL: str = "http://127.0.0.1:8477"

    # Optional explicit key for at-rest document encryption
    # (core/at_rest_crypto.py). Must be base64 encoding of exactly 32 bytes
    # (the standard Fernet-format key also works). When empty, the key is
    # derived deterministically from secret_key (HKDF-SHA256), so the feature
    # needs no extra deployment secret. Production SHOULD set a dedicated
    # DOC_ENCRYPTION_KEY so document ciphertext survives a secret_key
    # rotation.
    DOC_ENCRYPTION_KEY: str = ""

    # When True, rate limiting trusts the first entry of the
    # X-Forwarded-For header as the real client IP. This MUST only be
    # enabled behind a trusted reverse proxy that overwrites/strips
    # client-supplied X-Forwarded-For; otherwise any client can spoof its
    # apparent IP (and thus its rate-limit bucket). Default False: the
    # peer connection address (request.client.host) is used, which cannot
    # be spoofed over plain TCP.
    RATE_LIMIT_TRUST_PROXY_HEADERS: bool = False

    # CORS origins — comma-separated list of allowed origins.
    # React Native/Expo does not enforce CORS, so this only affects
    # browser-based access (dev console, web admin).
    # Empty string = no cross-origin allowed (most restrictive).
    CORS_ORIGINS: str = ""

    # ─────────────────────────────────────────────────────────────────────
    # Nutrition / food-scan (AICredits VLM + USDA FoodData Central).
    #
    # AICredits is OpenAI-compatible (base_url + api_key). The key is a
    # bearer secret: it must never be logged, only passed to the SDK
    # client constructor. Empty AICREDITS_API_KEY disables /analyze
    # with a safe 503 (see app/services/nutrition/vlm.py).
    # ─────────────────────────────────────────────────────────────────────
    AICREDITS_API_KEY: str = ""
    AICREDITS_BASE_URL: str = "https://api.aicredits.in/v1"
    AICREDITS_MODEL: str = "openai/gpt-4o"
    USDA_API_KEY: str = "DEMO_KEY"

    # ─────────────────────────────────────────────────────────────────────
    # P0 knowledge-graph flags.
    #
    # GRAPH_CONCEPT_EDGES_ENABLED: when True, the graph_sync worker also
    # projects (Event)-[:HAS_CODE]->(Concept {system, code}) edges for
    # normalized mentions. Concept nodes are shared reference data (like
    # AnatomicalStructure) and are TERMINAL for traversal — see
    # app/api/v1/health_graph.py. Default False until terminology coverage
    # is validated.
    # ─────────────────────────────────────────────────────────────────────
    GRAPH_CONCEPT_EDGES_ENABLED: bool = False
    # ─────────────────────────────────────────────────────────────────────
    # Production start-up gates.
    #
    # The development fallbacks (secret_key="dev-secret-key", missing
    # Firebase service-account credentials) remain acceptable for local and
    # preview work, but PRODUCTION must never start with them. These checks
    # are only reachable when APP_ENV=production; they fail loudly and never
    # print the secret or credential contents.
    # ─────────────────────────────────────────────────────────────────────
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        if self.APP_ENV != "production":
            return

        if self.secret_key == "dev-secret-key":
            _production_validation_error(
                "Production startup refused: secret_key is set to the "
                "well-known development default. Set a strong, unique "
                "secret_key in the production environment "
                "(see .env.example)."
            )

        if self.DOC_ENCRYPTION_KEY:
            try:
                from core.at_rest_crypto import decode_key
            except ImportError:
                _production_validation_error(
                    "Production startup refused: the cryptography package "
                    "is not installed, so DOC_ENCRYPTION_KEY cannot even "
                    "be validated. Install dependencies from "
                    "requirements.prod.txt."
                )
            try:
                if decode_key(self.DOC_ENCRYPTION_KEY) is None:
                    raise ValueError("empty")
            except ValueError:
                _production_validation_error(
                    "Production startup refused: DOC_ENCRYPTION_KEY is set "
                    "but invalid. It must be the base64 encoding of exactly "
                    "32 bytes (e.g. `python -c \"from cryptography.fernet "
                    "import Fernet; print(Fernet.generate_key().decode())\"`)."
                )

        cred_json = os.getenv("FIREBASE_CREDENTIALS_JSON", "").strip()
        cred_path = self.FIREBASE_CREDENTIALS_PATH.strip()
        has_json_creds = cred_json.startswith("{")
        has_path_creds = bool(cred_path) and os.path.isfile(cred_path)
        if not (has_json_creds or has_path_creds):
            _production_validation_error(
                "Production startup refused: Firebase service-account "
                "credentials are not configured. Set FIREBASE_CREDENTIALS_JSON "
                "(inline service-account JSON) or FIREBASE_CREDENTIALS_PATH "
                "(path to the mounted service-account file)."
            )

        # P7: development database/lookup defaults must never reach
        # production (localhost PG, USDA demo key). Messages name variables
        # only — never values.
        if "localhost" in (self.DATABASE_URL or "") or "127.0.0.1" in (self.DATABASE_URL or ""):
            _production_validation_error(
                "Production startup refused: DATABASE_URL points at a local "
                "database. Set the managed production DATABASE_URL."
            )
        if (self.USDA_API_KEY or "").strip().upper() in ("", "DEMO_KEY"):
            _production_validation_error(
                "Production startup refused: USDA_API_KEY is unset or the "
                "demo key. Set a production USDA_API_KEY."
            )


settings = Settings()