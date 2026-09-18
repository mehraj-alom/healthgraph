"""AICredits VLM food detection (OpenAI-compatible gateway).

Sends the photo as an image_url data URI (downscaled via pillow to
max 1024px, EXIF stripped) with a system prompt demanding JSON
[{label, portion_g, volume_ml, confidence}] using plate-reference
portion reasoning. temperature 0.2, response_format json_object.

The API key is only passed to the SDK constructor — never logged.
"""

from __future__ import annotations

import base64
import io
import json

from pydantic import BaseModel, Field

from core.config import settings
from logger import logger

from app.services.nutrition.portions import PLATE_DIAMETER_CM, clamp_portion

class NutritionError(Exception):
    """Typed failure for the nutrition pipeline (maps to safe 503)."""


class VlmItem(BaseModel):
    label: str
    portion_g: float = Field(ge=0)
    volume_ml: float | None = Field(None, ge=0)
    confidence: float = Field(ge=0, le=1)
    estimated_kcal: float | None = Field(None, ge=0)


_SYSTEM_PROMPT = (
    "You are a food-recognition assistant. Identify each distinct food or drink "
    "visible in the photo. Use the standard dinner plate in the image as a size "
    f"reference (a standard plate is {PLATE_DIAMETER_CM:.0f} cm in diameter; "
    "a full plate holds roughly 1000-1200 ml). Reason about each portion from "
    "its fraction of the plate and its apparent depth/volume. "
    "Respond with a JSON object {\"items\": [...]} where each item has: "
    "\"label\" (short food name), \"portion_g\" (estimated mass in grams), "
    "\"volume_ml\" (estimated volume in millilitres), \"confidence\" "
    "(0-1 detection confidence), and optionally \"estimated_kcal\" "
    "(rough kcal for the portion, used only when no nutrient database hit "
    "exists). Keep estimates conservative when the view is unclear."
)

_MAX_IMAGE_PX = 1024


def prepare_image_data_uri(image_bytes: bytes) -> str:
    """Downscale to max 1024px, strip EXIF, return JPEG data URI."""
    from PIL import Image, ImageOps

    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception as exc:
        raise NutritionError("unreadable image") from exc
    try:
        # EXIF strip: transpose to correct orientation, then drop metadata
        # by re-encoding (no exif= passed) as baseline JPEG.
        img = ImageOps.exif_transpose(img)
        if img.mode not in ("RGB",):
            img = img.convert("RGB")
        img.thumbnail((_MAX_IMAGE_PX, _MAX_IMAGE_PX), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=82)
    except Exception as exc:
        raise NutritionError("image processing failed") from exc
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _get_client():
    """Build the AICredits OpenAI-compatible client. Never logs the key."""
    api_key = (settings.AICREDITS_API_KEY or "").strip()
    if not api_key:
        raise NutritionError("nutrition service not configured")
    from openai import OpenAI

    return OpenAI(base_url=settings.AICREDITS_BASE_URL, api_key=api_key)


def _parse_items(raw: str) -> list[VlmItem]:
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError) as exc:
        raise NutritionError("vision gateway returned invalid JSON") from exc
    entries = payload.get("items") if isinstance(payload, dict) else None
    if entries is None and isinstance(payload, list):
        entries = payload
    if not isinstance(entries, list):
        raise NutritionError("vision gateway returned unexpected shape")
    items: list[VlmItem] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        try:
            item = VlmItem(
                label=str(entry.get("label", "")).strip()[:120],
                portion_g=max(0.0, float(entry.get("portion_g", 0) or 0)),
                volume_ml=(
                    max(0.0, float(entry.get("volume_ml")))
                    if entry.get("volume_ml") not in (None, "")
                    else None
                ),
                confidence=min(1.0, max(0.0, float(entry.get("confidence", 0.5) or 0.5))),
                estimated_kcal=(
                    max(0.0, float(entry.get("estimated_kcal")))
                    if entry.get("estimated_kcal") not in (None, "")
                    else None
                ),
            )
        except (TypeError, ValueError):
            continue
        if not item.label:
            continue
        item.portion_g = clamp_portion(item.label, item.portion_g, item.volume_ml)
        items.append(item)
    return items


def estimate_items(image_bytes: bytes) -> list[VlmItem]:
    """Detect foods + portions via the AICredits VLM gateway (blocking)."""
    data_uri = prepare_image_data_uri(image_bytes)
    try:
        client = _get_client()
    except NutritionError:
        logger.warning("nutrition VLM unavailable: missing API key")
        raise
    try:
        response = client.chat.completions.create(
            model=settings.AICREDITS_MODEL,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {"url": data_uri},
                        },
                        {
                            "type": "text",
                            "text": "List the foods in this photo as JSON.",
                        },
                    ],
                },
            ],
        )
    except Exception as exc:
        # Never include the key, URL, or image bytes in logs.
        logger.warning("nutrition VLM gateway failure: type=%s", type(exc).__name__)
        raise NutritionError("vision gateway failure") from exc
    try:
        content = response.choices[0].message.content or ""
    except (AttributeError, IndexError, KeyError) as exc:
        raise NutritionError("vision gateway returned no content") from exc
    return _parse_items(content)
