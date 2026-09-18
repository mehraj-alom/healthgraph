"""Plate-reference portion helpers + per-food density table.

The VLM estimates portions from a photo; these helpers sanity-clamp
absurd values before they reach the USDA scaling step.
"""

from __future__ import annotations

# Standard dinner-plate reference used in the VLM prompt and here.
PLATE_DIAMETER_CM: float = 26.0

# Approximate bulk density in grams per millilitre for common foods.
# Used to cross-check VLM portion_g against VLM volume_ml.
# Default covers mixed/unknown dishes.
DEFAULT_DENSITY_G_PER_ML: float = 0.6

DENSITY_G_PER_ML: dict[str, float] = {
    "rice": 0.75,
    "cooked rice": 0.75,
    "pasta": 0.70,
    "noodles": 0.70,
    "bread": 0.30,
    "potato": 0.75,
    "mashed potato": 0.85,
    "chicken": 0.95,
    "chicken breast": 0.95,
    "beef": 1.0,
    "pork": 0.95,
    "fish": 0.95,
    "salmon": 0.95,
    "egg": 0.95,
    "salad": 0.35,
    "lettuce": 0.25,
    "vegetables": 0.50,
    "broccoli": 0.45,
    "fruit": 0.60,
    "apple": 0.70,
    "banana": 0.75,
    "soup": 0.95,
    "yogurt": 1.0,
    "oatmeal": 0.65,
    "porridge": 0.65,
    "cheese": 0.95,
    "pizza": 0.55,
    "burger": 0.60,
    "fries": 0.45,
    "french fries": 0.45,
    "cake": 0.45,
    "ice cream": 0.55,
}

# Per-item sanity bounds (grams). A single photographed item outside
# these is almost certainly a VLM hallucination.
_MIN_PORTION_G: float = 5.0
_MAX_PORTION_G: float = 1500.0


def density_for(label: str) -> float:
    """Return g/ml density for a label (substring match, default 0.6)."""
    name = (label or "").strip().lower()
    if not name:
        return DEFAULT_DENSITY_G_PER_ML
    # Longest-key-first so "chicken breast" wins over "chicken".
    for key in sorted(DENSITY_G_PER_ML, key=len, reverse=True):
        if key in name:
            return DENSITY_G_PER_ML[key]
    return DEFAULT_DENSITY_G_PER_ML


def clamp_portion(label: str, portion_g: float, volume_ml: float | None) -> float:
    """Clamp an absurd VLM portion to a plausible range.

    Uses the standard 26 cm plate reference implicitly: a full plate
    holds roughly 1000-1200 ml, so any single item above 1500 g is
    clamped, as is anything below 5 g. When volume_ml is provided,
    cross-checks mass against density and pulls wild outliers toward
    the density-implied mass.
    """
    try:
        mass = float(portion_g)
    except (TypeError, ValueError):
        mass = 0.0
    if mass != mass or mass == float("inf") or mass == float("-inf"):
        mass = 0.0

    if volume_ml:
        try:
            vol = float(volume_ml)
        except (TypeError, ValueError):
            vol = 0.0
        if vol > 0 and vol < 5000:
            implied = vol * density_for(label)
            # If mass disagrees with the density-implied mass by more
            # than 3x, trust a blend weighted toward the implied mass.
            if mass <= 0:
                mass = implied
            elif implied > 0 and (mass > implied * 3 or implied > mass * 3):
                mass = (mass + implied * 2) / 3

    if mass < _MIN_PORTION_G:
        return _MIN_PORTION_G
    if mass > _MAX_PORTION_G:
        return _MAX_PORTION_G
    return mass
