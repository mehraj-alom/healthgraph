import os
import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.api.dependencies import get_authenticated_patient_id
from app.services.nutrition import usda, vlm
from app.services.nutrition.vlm import NutritionError, VlmItem
from core.config import settings
from core.db import get_db
from core.rate_limiter import RateLimiter
from core.security_events import log_security_event
from logger import logger
from models.food import FoodEntry, FoodScan, FoodScanStatus
from models.outbox import enqueue_food_scan
from models.privacy import log_audit
from models.visits import VisitType
from schemas.nutrition import (
    AnalyzeResponse,
    FoodCorrectIn,
    FoodScanLog,
    FoodScanOut,
    FoodEntryOut,
    ScanItem,
)
from services.clinical.occurrences import get_or_create_visit
from sqlalchemy.orm import Session

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


def _scan_out(scan: FoodScan) -> FoodScanOut:
    return FoodScanOut(
        scan_id=scan.scan_id,
        status=scan.status,
        total_kcal=scan.total_kcal,
        entries=[
            FoodEntryOut(
                entry_id=e.entry_id,
                label=e.label,
                portion_g=e.portion_g,
                kcal=e.kcal,
                protein_g=e.protein_g,
                carbs_g=e.carbs_g,
                fat_g=e.fat_g,
                confidence=e.confidence,
                corrected=e.corrected,
                corrected_label=e.corrected_label,
            )
            for e in (scan.entries or [])
        ],
    )


def _enqueue_scan(db: Session, scan: FoodScan, visit_id) -> None:
    enqueue_food_scan(
        db,
        scan_id=scan.scan_id,
        patient_id=scan.patient_id,
        entries=[
            {
                "entry_id": str(e.entry_id),
                "label": e.label,
                "portion_g": e.portion_g,
                "volume_ml": e.volume_ml,
                "kcal": e.kcal,
                "protein_g": e.protein_g,
                "carbs_g": e.carbs_g,
                "fat_g": e.fat_g,
                "confidence": e.confidence,
                "corrected": e.corrected,
                "corrected_label": e.corrected_label,
            }
            for e in (scan.entries or [])
        ],
        total_kcal=scan.total_kcal,
        overall_confidence=scan.overall_confidence,
        status=scan.status,
        model=scan.model,
        model_version=scan.model_version,
        meal_type=scan.meal_type,
        recorded_at=scan.recorded_at.isoformat() if scan.recorded_at else None,
        visit_id=visit_id,
    )


@router.post("/log", response_model=FoodScanOut, status_code=201)
def log_food_scan(
    body: FoodScanLog,
    patient_id: PatientIdDep,
    db: Session = Depends(get_db),
):
    """Persist a food scan's identified items (scan result or manual entry).

    Photo bytes are never accepted here — only structured item metadata plus
    an optional photo hash reference. Per-item AI estimates stay labeled as
    such until the user confirms/corrects (see /correct, /confirm).
    """
    from datetime import datetime, timezone as _tz

    scan = FoodScan(
        patient_id=patient_id,
        log_date=body.log_date,
        meal_type=body.meal_type,
        photo_hash=body.photo_hash,
        model=body.model,
        model_version=body.model_version,
        overall_confidence=body.overall_confidence,
        total_kcal=body.total_kcal,
        status=body.status,
    )
    db.add(scan)
    db.flush()
    for item in body.items:
        db.add(FoodEntry(
            scan_id=scan.scan_id,
            label=item.label.strip(),
            portion_g=item.portion_g,
            volume_ml=item.volume_ml,
            kcal=item.kcal,
            protein_g=item.protein_g,
            carbs_g=item.carbs_g,
            fat_g=item.fat_g,
            confidence=item.confidence,
            fdc_id=item.fdc_id,
        ))
    db.flush()
    db.refresh(scan, attribute_names=["entries"])
    visit = get_or_create_visit(
        db, patient_id,
        body.log_date or datetime.now(_tz.utc).date(),
        VisitType.DAILY_CHECKIN, source="food-scan",
    )
    _enqueue_scan(db, scan, visit.visit_id)
    log_audit(db, action="food_scan_logged", patient_id=patient_id,
              entity_type="food_scan", entity_id=str(scan.scan_id),
              meta={"items": len(body.items), "status": scan.status})
    db.commit()
    db.refresh(scan, attribute_names=["entries"])
    return _scan_out(scan)


@router.post("/scans/{scan_id}/correct", response_model=FoodScanOut)
def correct_food_entry(
    scan_id: uuid.UUID,
    body: FoodCorrectIn,
    patient_id: PatientIdDep,
    db: Session = Depends(get_db),
):
    """Correct one AI-identified entry. The original label is preserved
    (corrected=true + corrected_label); the AI estimate is never overwritten."""
    from sqlalchemy import select

    scan = db.scalar(select(FoodScan).where(
        FoodScan.scan_id == scan_id, FoodScan.patient_id == patient_id,
    ))
    if scan is None:
        raise HTTPException(status_code=404, detail="Food scan not found.")
    entry = db.scalar(select(FoodEntry).where(
        FoodEntry.entry_id == body.entry_id, FoodEntry.scan_id == scan_id,
    ))
    if entry is None:
        raise HTTPException(status_code=404, detail="Food entry not found.")
    entry.corrected = True
    entry.corrected_label = body.corrected_label.strip()
    scan.status = FoodScanStatus.USER_CORRECTED
    db.flush()
    db.refresh(scan, attribute_names=["entries"])
    visit = get_or_create_visit(
        db, patient_id, scan.recorded_at, VisitType.DAILY_CHECKIN, source="food-scan",
    )
    _enqueue_scan(db, scan, visit.visit_id)
    log_audit(db, action="food_entry_corrected", patient_id=patient_id,
              entity_type="food_entry", entity_id=str(entry.entry_id))
    db.commit()
    db.refresh(scan, attribute_names=["entries"])
    return _scan_out(scan)


@router.post("/scans/{scan_id}/confirm", response_model=FoodScanOut)
def confirm_food_scan(
    scan_id: uuid.UUID,
    patient_id: PatientIdDep,
    db: Session = Depends(get_db),
):
    """Mark a scan user-confirmed (estimates accepted as logged)."""
    from sqlalchemy import select

    scan = db.scalar(select(FoodScan).where(
        FoodScan.scan_id == scan_id, FoodScan.patient_id == patient_id,
    ))
    if scan is None:
        raise HTTPException(status_code=404, detail="Food scan not found.")
    scan.status = FoodScanStatus.USER_CONFIRMED
    db.flush()
    db.refresh(scan, attribute_names=["entries"])
    visit = get_or_create_visit(
        db, patient_id, scan.recorded_at, VisitType.DAILY_CHECKIN, source="food-scan",
    )
    _enqueue_scan(db, scan, visit.visit_id)
    log_audit(db, action="food_scan_confirmed", patient_id=patient_id,
              entity_type="food_scan", entity_id=str(scan.scan_id))
    db.commit()
    db.refresh(scan, attribute_names=["entries"])
    return _scan_out(scan)
