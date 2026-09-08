import base64
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()  # Load environment variables for local config

try:
    from landingai_ade import LandingAIADE
except ModuleNotFoundError:  # pragma: no cover - optional OCR backend
    LandingAIADE = None

_client = None


def _normalize_apikey(api_key: str) -> str:
    """Return the key in the form the ADE SDK sends as ``Authorization: Bearer``.

    ADE API keys are ``user:password`` pairs; the API authenticates the
    base64-encoded pair (Bearer ``base64(user:password)``). A raw ``user:pass``
    value is encoded here so either form works; token-style keys (no ``:``) are
    passed through unchanged.
    """
    if api_key and ":" in api_key:
        return base64.b64encode(api_key.encode()).decode()
    return api_key


def _get_client():
    global _client
    if _client is not None:
        return _client
    if LandingAIADE is None:
        return None
    api_key = os.getenv("VISION_AGENT_API_KEY") or os.getenv("LANDINGAI_API_KEY")
    if not api_key:
        return None
    try:
        _client = LandingAIADE(apikey=_normalize_apikey(api_key))
        return _client
    except Exception:
        return None


class Extraction:
    @staticmethod
    def _require_client():
        active_client = _get_client()
        if active_client is None:
            raise RuntimeError(
                "The optional OCR dependency 'landingai_ade' is not installed or configured. "
                "Install the LandingAI ADE package and set VISION_AGENT_API_KEY to enable document extraction."
            )
        return active_client

    @staticmethod
    def parse_(document_path: str, model: str = "dpt-3-pro-latest") -> dict:
        """
        Parses a document using the LandingAI ADE API.
        return marksdown and structured json output"""

        active_client = Extraction._require_client()
        response = active_client.v2.parse(
            document=Path(document_path),
            model=model,
        )
        structured = response.structure
        if hasattr(structured, "model_dump"):
            structured = structured.model_dump()
        elif hasattr(structured, "dict"):
            structured = structured.dict()
        return {"markdown": response.markdown, "structured_json": structured}


    @staticmethod
    def extract_(markdown: str, schema: str = "") -> dict:
        """
        Extracts structured data from markdown using the LandingAI ADE API.
        return structured json output"""
        active_client = Extraction._require_client()
        extract_response = active_client.v2.extract(
            markdown=markdown,
            schema=schema,
        )
        extraction = extract_response.extraction
        if hasattr(extraction, "model_dump"):
            extraction = extraction.model_dump()
        elif hasattr(extraction, "dict"):
            extraction = extraction.dict()
        return {"extraction": extraction}


    @staticmethod
    def parse_and_extract(document_path: str, model: str = "dpt-3-pro-latest", schema: str = "") -> dict:
        """
        Parses a document and extracts structured data using the LandingAI ADE API.
        Returns both markdown and structured JSON output.
        """
        parse_result = Extraction.parse_(document_path, model)
        extract_result = Extraction.extract_(parse_result["markdown"], schema)
        return {
            "markdown": parse_result["markdown"],
            "structured_json": parse_result["structured_json"],
            "extraction": extract_result["extraction"]
        }


def get_ade_client():
    """Return the shared LandingAI ADE client, or None if not configured.

    Classification (OCR gateway) and extraction both talk to LandingAI ADE,
    so they share one client and one credential source
    (VISION_AGENT_API_KEY or LANDINGAI_API_KEY).
    """
    return _get_client()