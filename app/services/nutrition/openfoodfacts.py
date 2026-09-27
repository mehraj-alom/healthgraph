"""Open Food Facts barcode lookup (world.openfoodfacts.org, no API key).

Free and unlimited: resolves a validated EAN-8 / UPC-A / EAN-13 (or EAN-14)
to product name/brand plus kcal/protein/carbs/fat per 100 g. Hits are cached
in-memory (LRU, 1000 entries) like the USDA path. Nothing sensitive travels:
no key, no patient data — only the barcode digits. Failures return None so
callers can answer 404/503 honestly.
"""

from __future__ import annotations

from collections import OrderedDict

import httpx
from pydantic import BaseModel, Field

from logger import logger

_OFF_BASE = "https://world.openfoodfacts.org"
# Open Food Facts requires a descriptive User-Agent for API use.
_OFF_USER_AGENT = "HealthGraph/1.0 (nutrition barcode lookup; https://healthgraph.shop)"
_TIMEOUT_S = 10.0

_CACHE_MAX = 1000
_cache: OrderedDict[str, "BarcodeProduct"] = OrderedDict()


class BarcodeNutrients(BaseModel):
    kcal_per_100g: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)


class BarcodeProduct(BaseModel):
    barcode: str
    name: str = Field(min_length=1, max_length=255)
    brand: str = Field(default="", max_length=255)
    nutrients: BarcodeNutrients
    serving_size: str = Field(default="", max_length=128)
    image_url: str = Field(default="", max_length=512)
    source: str = "openfoodfacts"


def _cache_get(code: str) -> BarcodeProduct | None:
    hit = _cache.get(code)
    if hit is not None:
        _cache.move_to_end(code)
    return hit


def _cache_set(code: str, value: BarcodeProduct) -> None:
    _cache[code] = value
    _cache.move_to_end(code)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


def _ean_checksum_valid(digits: str) -> bool:
    """GS1 check digit over the leading digits (EAN-8/13, UPC-A as EAN-13)."""
    total = 0
    for i, ch in enumerate(digits[:-1]):
        d = ord(ch) - 48
        # From the right, odd positions ×3 (excluding the check digit).
        pos_from_right = len(digits) - 1 - i
        total += d * (3 if pos_from_right % 2 == 1 else 1)
    return (10 - (total % 10)) % 10 == (ord(digits[-1]) - 48)


def normalize_barcode(raw: str) -> str | None:
    """Strip spaces/dashes; accept EAN-8, UPC-A (12), EAN-13, EAN-14 with a
    valid GS1 check digit. Returns the digit string, else None."""
    digits = "".join(c for c in (raw or "") if c.isdigit())
    if len(digits) == 12:
        digits = "0" + digits  # UPC-A → EAN-13 numbering
    if len(digits) == 14:
        if not digits.startswith("0"):
            return None
        digits = digits[1:]  # EAN-14 logistic → EAN-13 trunk
    if len(digits) not in (8, 13):
        return None
    if not _ean_checksum_valid(digits):
        return None
    return digits


def _to_float(value: object) -> float:
    try:
        out = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0
    return out if out > 0 else 0.0


def _nutrients_from_product(product: dict) -> BarcodeNutrients | None:
    nutr = product.get("nutriments") or {}
    kcal = _to_float(nutr.get("energy-kcal_100g"))
    if kcal <= 0:
        # Fall back to kilojoules when kcal is absent.
        kj = _to_float(nutr.get("energy_100g"))
        kcal = kj / 4.184 if kj > 0 else 0.0
    if kcal <= 0:
        return None
    return BarcodeNutrients(
        kcal_per_100g=kcal,
        protein_g=_to_float(nutr.get("proteins_100g")),
        carbs_g=_to_float(nutr.get("carbohydrates_100g")),
        fat_g=_to_float(nutr.get("fat_100g")),
    )


def lookup_by_barcode(code: str) -> BarcodeProduct | None:
    """Resolve a validated barcode to a product. None = unknown/unreachable."""
    normalized = normalize_barcode(code)
    if normalized is None:
        return None
    hit = _cache_get(normalized)
    if hit is not None:
        return hit
    try:
        resp = httpx.get(
            f"{_OFF_BASE}/api/v2/product/{normalized}.json",
            headers={"User-Agent": _OFF_USER_AGENT},
            timeout=_TIMEOUT_S,
        )
    except Exception as exc:  # network down, DNS, timeout — all map to None
        logger.info("Open Food Facts lookup failed: %s.", type(exc).__name__)
        return None
    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        logger.info("Open Food Facts lookup HTTP %s.", resp.status_code)
        return None
    try:
        payload = resp.json()
    except Exception:
        return None
    if not isinstance(payload, dict) or payload.get("status") != 1:
        return None
    product = payload.get("product") or {}
    name = str(product.get("product_name") or "").strip()
    if not name:
        return None
    nutrients = _nutrients_from_product(product)
    if nutrients is None:
        return None
    result = BarcodeProduct(
        barcode=normalized,
        name=name[:255],
        brand=str(product.get("brands") or "")[:255],
        nutrients=nutrients,
        serving_size=str(product.get("serving_size") or "")[:128],
        image_url=str(product.get("image_url") or "")[:512],
    )
    _cache_set(normalized, result)
    return result
