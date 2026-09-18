import os
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.dependencies import get_authenticated_patient_id
from app.services.nutrition import usda, vlm
from app.services.nutrition.vlm import NutritionError, VlmItem
from core.config import settings
from core.rate_limiter import RateLimiter
from core.security_events import log_security_event
from logger import logger
from schemas.nutrition import AnalyzeResponse, ScanItem

router = APIRouter(prefix="/api/v1/nutrition", tags=["nutrition"])

PatientIdDep = Annotated[uuid.UUID, Depends(get_authenticated_patient_id)]
PhotoDep = Annotated[UploadFile, File()]

_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg"}
_ALLOWED_MAGIC_BYTES = {
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
}
_ALLOWED_CONTENT_TYPES = {"image/png", "image/jpeg"}
_MAX_PHOTO_BYTES = 10 * 1024 * 1024  # 10 MiB — frozen frontend contract

# Photo analysis feeds the paid VLM + USDA pipeline. 10/min burst +
# 30/hour per patient. fail_open only in LOCAL so a dev box without
# Redis works; preview/production fail closed (503) so abuse
# protection never silently disables.
_analyze_limiter = RateLimiter()

# Fallback energy density when USDA has no hit and the VLM gave no
# estimated_kcal: a conservative mixed-dish average.
_FALLBACK_KCAL_PER_G = 1.5
_CONFIDENCE_PENALTY = 0.2


def _validate_photo(photo: UploadFile) -> None:
    """Validate extension, content-type, and magic bytes. 400 on mismatch."""
    filename = photo.filename or ""
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    content_type = (photo.content_type or "").lower()
    if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported content type.")

    # Magic-byte sniff (first 8 bytes; seek back afterwards). Prevents a
    # renamed/abused file from entering the paid VLM pipeline.
    head = photo.file.read(8)
    photo.file.seek(0)
    if not any(head.startswith(magic) for magic in _ALLOWED_MAGIC_BYTES[file_ext]):
        raise HTTPException(
            status_code=400, detail="File content does not match its extension."
        )


def _merge_items(vlm_items: list[VlmItem]) -> tuple[list[ScanItem], bool]:
    """Merge VLM portions with USDA nutrients. Returns (items, fallback_used)."""
    merged: list[ScanItem] = []
    fallback_used = False
    for detected in vlm_items:
        per_100g = usda.lookup_per_100g(detected.label)
        if per_100g is not None:
            scaled = usda.scale_to_portion(per_100g, detected.portion_g)
            merged.append(
                ScanItem(
                    label=detected.label,
                    grams=round(detected.portion_g, 1),
                    kcal=round(scaled.kcal, 1),
                    protein_g=round(scaled.protein_g, 1),
                    carbs_g=round(scaled.carbs_g, 1),
                    fat_g=round(scaled.fat_g, 1),
                    confidence=round(detected.confidence, 2),
                )
            )
        else:
            fallback_used = True
            kcal = (
                detected.estimated_kcal
                if detected.estimated_kcal is not None
                else detected.portion_g * _FALLBACK_KCAL_PER_G
            )
            merged.append(
                ScanItem(
                    label=detected.label,
                    grams=round(detected.portion_g, 1),
                    kcal=round(kcal, 1),
                    protein_g=0.0,
                    carbs_g=0.0,
                    fat_g=0.0,
                    confidence=round(max(0.0, detected.confidence - _CONFIDENCE_PENALTY), 2),
                )
            )
    return merged, fallback_used


def _overall_confidence(items: list[ScanItem], fallback_used: bool) -> Literal["low", "med", "high"]:
    """Map mean item confidence to low/med/high, capped at med on fallback."""
    if not items:
        return "low"
    mean_conf = sum(item.confidence for item in items) / len(items)
    level: Literal["low", "med", "high"] = (
        "high" if mean_conf >= 0.75 else "med" if mean_conf >= 0.45 else "low"
    )
    if fallback_used and level == "high":
        return "med"
    return level


@router.post("/analyze", response_model=AnalyzeResponse)
def analyze_photo(photo: PhotoDep, patient_id: PatientIdDep) -> AnalyzeResponse:
    """Estimate calories + macros from a food photo (VLM detect, USDA enrich)."""
    fail_open = settings.APP_ENV == "local"
    # Cost-abuse protection for the paid pipeline (fail-closed in
    # preview/production; fail-open in local).
    _analyze_limiter.check(
        str(patient_id), "nutrition_burst", limit=10,
        window_seconds=60, fail_open=fail_open,
    )
    _analyze_limiter.check(
        str(patient_id), "nutrition_hourly", limit=30,
        window_seconds=3600, fail_open=fail_open,
    )

    try:
        _validate_photo(photo)
    except HTTPException as exc:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/nutrition/analyze",
            status=exc.status_code,
            patient_id=str(patient_id),
            message=exc.detail,
        )
        raise

    # Content-Length fast-reject (cheap, before any reads).
    content_length = photo.size
    if content_length is not None and content_length > _MAX_PHOTO_BYTES:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/nutrition/analyze",
            status=400,
            patient_id=str(patient_id),
            message="upload exceeds size cap",
        )
        raise HTTPException(status_code=400, detail="Photo exceeds the 10 MB size limit.")

    raw = photo.file.read()
    if len(raw) > _MAX_PHOTO_BYTES:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/nutrition/analyze",
            status=400,
            patient_id=str(patient_id),
            message="upload exceeds size cap",
        )
        raise HTTPException(status_code=400, detail="Photo exceeds the 10 MB size limit.")
    if not raw:
        raise HTTPException(status_code=400, detail="Empty photo upload.")

    try:
        vlm_items = vlm.estimate_items(raw)
    except NutritionError:
        # Safe message only — never leaks the gateway key or internals.
        logger.warning("nutrition analysis unavailable for patient=%s", patient_id)
        log_security_event(
            "nutrition_unavailable",
            endpoint="/api/v1/nutrition/analyze",
            status=503,
            patient_id=str(patient_id),
            message="vision gateway failure",
        )
        raise HTTPException(
            status_code=503,
            detail="Nutrition analysis unavailable. Please retry shortly.",
        )

    items, fallback_used = _merge_items(vlm_items)
    total_kcal = int(round(sum(item.kcal for item in items)))
    confidence = _overall_confidence(items, fallback_used)
    if not items:
        note = "No foods detected; try a clearer photo."
    else:
        note = "Estimated from photo; values are approximate."
        if fallback_used:
            note += " Some items had no nutrient-database match; kcal estimated."

    return AnalyzeResponse(
        items=items,
        total_kcal=total_kcal,
        confidence=confidence,
        note=note,
    )
