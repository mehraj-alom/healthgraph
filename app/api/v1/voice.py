"""Turn-based voice STT transport (Phase 5).

POST /api/v1/voice/transcribe accepts one short voice turn (multipart WAV/
container audio, 5 MB / 60 s caps) from the authenticated patient and proxies
it to the localhost-only Pakeet sidecar. No DB writes, no Redis state, no new
tables: the backend is a thin authenticated pipe (audio in, text out). The
transcribed text then flows through the existing chat/LangGraph path, and the
response is synthesized on-device by sanoTTS. No streaming, no session state.
"""
import uuid

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.api.dependencies import get_authenticated_patient_id
from core.config import settings
from core.rate_limiter import RateLimiter
from logger import logger

router = APIRouter(prefix="/api/v1/voice", tags=["Voice STT"])

_MAX_TURN_BYTES = 5 * 1024 * 1024  # 5 MiB ≈ 2.5 min @16kHz mono
_ALLOWED_SUFFIXES = (".wav", ".m4a", ".aac", ".mp4", ".webm", ".3gp", ".ogg")
_SIDECAR_TIMEOUT_S = 75.0

# STT burns ~1 CPU core per turn on the shared VPS: bounded like chat.
_stt_limiter = RateLimiter()


@router.post("/transcribe", response_model=dict)
async def transcribe_turn(
    file: UploadFile = File(...),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    _stt_limiter.check(
        str(patient_id),
        "voice_stt",
        limit=30,
        window_seconds=600,
        fail_open=settings.APP_ENV == "local",
    )

    name = (file.filename or "").lower()
    if not name.endswith(_ALLOWED_SUFFIXES):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported audio type. Send wav, m4a, aac, mp4, webm, 3gp, or ogg.",
        )
    try:
        raw = await file.read()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Could not read audio.")
    if not raw or len(raw) > _MAX_TURN_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="Voice turn too large (5 MB max). Record a shorter turn.",
        )

    try:
        async with httpx.AsyncClient(timeout=_SIDECAR_TIMEOUT_S) as client:
            resp = await client.post(
                f"{settings.PAKEET_URL}/transcribe",
                content=raw,
                headers={"Content-Type": "application/octet-stream"},
            )
    except (httpx.ConnectError, httpx.TimeoutException):
        logger.warning("Pakeet sidecar unreachable (patient %s).", str(patient_id)[:8])
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Voice transcription is unavailable right now.")
    if resp.status_code != 200:
        logger.warning("Pakeet sidecar rejected turn: HTTP %s.", resp.status_code)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Voice transcription failed for this turn.")
    try:
        data = resp.json()
        text = str(data.get("text", "") or "")
    except Exception:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Voice transcription failed for this turn.")
    # Lengths only in logs: transcript content is patient speech.
    logger.info("Voice turn transcribed: %d audio bytes -> %d text chars.", len(raw), len(text))
    return {"text": text}
