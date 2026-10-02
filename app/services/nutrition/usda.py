"""USDA FoodData Central nutrient lookup (api.nal.usda.gov/fdc/v1).

Searches each VLM label, takes the first SR Legacy/Foundation result,
fetches nutrients, and returns kcal/protein/carbs/fat per 100 g scaled
by portion_g. Labels with no hit return None so the caller keeps the
item with VLM-estimated kcal and a penalized confidence.

Hits are cached in-memory (dict, 1000 entries). The API key travels
only as a query param — never logged.
"""

from __future__ import annotations

from collections import OrderedDict

import httpx
from pydantic import BaseModel, Field

from core.config import settings
from logger import logger

_USDA_BASE = "https://api.nal.usda.gov/fdc/v1"
_PREFERRED_TYPES = {"SR LEGACY", "FOUNDATION"}

_CACHE_MAX = 1000
_cache: OrderedDict[str, "NutrientsPer100g"] = OrderedDict()


class NutrientsPer100g(BaseModel):
    kcal: float = Field(ge=0)
    protein_g: float = Field(ge=0)
    carbs_g: float = Field(ge=0)
    fat_g: float = Field(ge=0)
    # Display-only micros, USDA-sourced: None when the matched row lacks
    # them (never estimated — the caller keeps fallback items at None).
    fiber_g: float | None = Field(default=None, ge=0)
    sugar_g: float | None = Field(default=None, ge=0)
    sodium_mg: float | None = Field(default=None, ge=0)


def _cache_get(label: str) -> NutrientsPer100g | None:
    hit = _cache.get(label)
    if hit is not None:
        _cache.move_to_end(label)
    return hit


def _cache_set(label: str, value: NutrientsPer100g) -> None:
    _cache[label] = value
    _cache.move_to_end(label)
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)


def _nutrients_from_list(nutrients: list[dict]) -> NutrientsPer100g | None:
    kcal = protein = carbs = fat = None
    fiber_g = sugar_g = sodium_mg = None
    for n in nutrients:
        name = str(n.get("nutrientName", "")).lower()
        unit = str(n.get("unitName", "")).lower()
        value = n.get("value")
        if value is None:
            continue
        try:
            value = float(value)
        except (TypeError, ValueError):
            continue
        if "energy" in name and ("kcal" in name or "calorie" in name or unit == "kcal"):
            # Prefer kcal entries; skip kJ-only rows. SR Legacy carries the
            # unit in unitName ("Energy" + "KCAL"), not in the name.
            if kcal is None:
                kcal = value
        elif "protein" in name:
            if protein is None:
                protein = value
        elif "carbohydrate" in name:
            if carbs is None:
                carbs = value
        elif "total lipid" in name or name.strip() == "fat" or "fat" in name:
            if fat is None:
                fat = value
        elif "fiber" in name or "fibre" in name:
            if fiber_g is None:
                fiber_g = value / 1000.0 if unit == "mg" else value
        elif "sugar" in name and "added" not in name:
            if sugar_g is None:
                sugar_g = value / 1000.0 if unit == "mg" else value
        elif "sodium" in name:
            if sodium_mg is None:
                sodium_mg = value * 1000.0 if unit == "g" else value
    if kcal is None:
        return None
    return NutrientsPer100g(
        kcal=max(0.0, kcal),
        protein_g=max(0.0, protein or 0.0),
        carbs_g=max(0.0, carbs or 0.0),
        fat_g=max(0.0, fat or 0.0),
        fiber_g=max(0.0, fiber_g) if fiber_g is not None else None,
        sugar_g=max(0.0, sugar_g) if sugar_g is not None else None,
        sodium_mg=max(0.0, sodium_mg) if sodium_mg is not None else None,
    )


def lookup_per_100g(label: str) -> NutrientsPer100g | None:
    """Return nutrients per 100 g for a label, or None on no hit/failure."""
    key = (label or "").strip().lower()
    if not key:
        return None
    cached = _cache_get(key)
    if cached is not None:
        return cached
    api_key = (settings.USDA_API_KEY or "").strip()
    if not api_key:
        return None
    try:
        with httpx.Client(base_url=_USDA_BASE, timeout=10.0) as client:
            search = client.get(
                "/foods/search",
                params={
                    "api_key": api_key,
                    "query": label.strip(),
                    "pageSize": 10,
                    "dataType": ["SR Legacy", "Foundation"],
                },
            )
            if search.status_code != 200:
                logger.warning(
                    "USDA search failed: label_len=%d status=%d",
                    len(label),
                    search.status_code,
                )
                return None
            foods = (search.json() or {}).get("foods") or []
            if not foods:
                return None
            # Take the first SR Legacy/Foundation result; fall back to
            # the first result of any type when none match.
            target = next(
                (
                    f
                    for f in foods
                    if str(f.get("dataType", "")).upper() in _PREFERRED_TYPES
                ),
                foods[0],
            )
            embedded = target.get("foodNutrients") or []
            parsed = _nutrients_from_list(embedded) if embedded else None
            if parsed is not None:
                _cache_set(key, parsed)
                return parsed
            fdc_id = target.get("fdcId")
            if not fdc_id:
                return None
            detail = client.get(f"/food/{fdc_id}", params={"api_key": api_key})
            if detail.status_code != 200:
                logger.warning(
                    "USDA detail failed: status=%d", detail.status_code
                )
                return None
            detail_json = detail.json() or {}
            candidates = (
                detail_json.get("foodNutrients")
                or detail_json.get("labelNutrients")
                or []
            )
            if isinstance(candidates, dict):
                # labelNutrients shape: {"fat": {"value": ...}, ...}
                flat = [
                    {"nutrientName": k, "value": v.get("value")}
                    for k, v in candidates.items()
                    if isinstance(v, dict)
                ]
                parsed = _nutrients_from_list(flat)
            else:
                parsed = _nutrients_from_list(candidates)
            if parsed is None:
                return None
            _cache_set(key, parsed)
            return parsed
    except Exception as exc:
        # No key/URL/query values in logs.
        logger.warning("USDA lookup failure: type=%s", type(exc).__name__)
        return None
    return None


def scale_to_portion(per_100g: NutrientsPer100g, portion_g: float) -> NutrientsPer100g:
    """Scale per-100-g nutrients to the photographed portion."""
    factor = max(0.0, float(portion_g)) / 100.0

    def scaled(value: float | None) -> float | None:
        return value * factor if value is not None else None

    return NutrientsPer100g(
        kcal=per_100g.kcal * factor,
        protein_g=per_100g.protein_g * factor,
        carbs_g=per_100g.carbs_g * factor,
        fat_g=per_100g.fat_g * factor,
        fiber_g=scaled(per_100g.fiber_g),
        sugar_g=scaled(per_100g.sugar_g),
        sodium_mg=scaled(per_100g.sodium_mg),
    )
