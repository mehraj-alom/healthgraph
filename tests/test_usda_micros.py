"""USDA fiber/sugar/sodium enrichment (display-only, USDA-sourced).

Micros come only from matched USDA rows — VLM fallback items carry None
(never hallucinated values). Same HTTP call as the macro path: the parser
reads more fields from the already-fetched nutrient list, so enrichment
adds zero requests and zero load.
"""

from app.api.v1 import nutrition as nutrition_api
from app.services.nutrition import usda


def row(name, value, unit):
    return {"nutrientName": name, "value": value, "unitName": unit}


FULL = [
    row("Energy", 100, "KCAL"),
    row("Protein", 10, "G"),
    row("Carbohydrate, by difference", 20, "G"),
    row("Total lipid (fat)", 5, "G"),
    row("Fiber, total dietary", 2.5, "G"),
    row("Sugars, total including NLEA", 12.0, "G"),
    row("Sodium, Na", 300, "MG"),
]


def test_parser_reads_fiber_sugar_sodium():
    out = usda._nutrients_from_list(FULL)
    assert out is not None
    assert out.fiber_g == 2.5
    assert out.sugar_g == 12.0
    assert out.sodium_mg == 300.0


def test_parser_units_case_insensitive_and_missing_is_none():
    out = usda._nutrients_from_list(
        [
            row("Energy", 100, "KCAL"),
            row("Protein", 10, "G"),
            row("Carbohydrate, by difference", 20, "G"),
            row("Total lipid (fat)", 5, "G"),
            row("Sodium, Na", 1.2, "mg"),
        ]
    )
    assert out is not None
    assert out.fiber_g is None
    assert out.sugar_g is None
    assert out.sodium_mg == 1.2


def test_parser_skips_garbage_values():
    out = usda._nutrients_from_list(
        [
            row("Energy", 100, "KCAL"),
            row("Protein", 10, "G"),
            row("Carbohydrate, by difference", 20, "G"),
            row("Total lipid (fat)", 5, "G"),
            row("Fiber, total dietary", "n/a", "G"),
            row("Sodium, Na", None, "MG"),
        ]
    )
    assert out is not None
    assert out.fiber_g is None
    assert out.sodium_mg is None


def test_scale_to_portion_scales_micros_and_keeps_none():
    base = usda.NutrientsPer100g(
        kcal=100, protein_g=10, carbs_g=20, fat_g=5,
        fiber_g=2.5, sugar_g=12.0, sodium_mg=300.0,
    )
    scaled = usda.scale_to_portion(base, 50.0)
    assert scaled.fiber_g == 1.25
    assert scaled.sugar_g == 6.0
    assert scaled.sodium_mg == 150.0
    bare = usda.NutrientsPer100g(kcal=100, protein_g=10, carbs_g=20, fat_g=5)
    assert usda.scale_to_portion(bare, 50.0).fiber_g is None


def test_merge_maps_usda_micros_and_never_invents_fallback_micros(monkeypatch):
    hit = usda.NutrientsPer100g(
        kcal=100, protein_g=10, carbs_g=20, fat_g=5,
        fiber_g=2.5, sugar_g=12.0, sodium_mg=300.0,
    )
    monkeypatch.setattr(nutrition_api.usda, "lookup_per_100g", lambda label: hit)
    items, fallback_used = nutrition_api._merge_items(
        [nutrition_api.VlmItem(label="Oats", portion_g=200.0, confidence=0.9, estimated_kcal=None)]
    )
    assert fallback_used is False
    assert items[0].fiber_g == 5.0
    assert items[0].sugar_g == 24.0
    assert items[0].sodium_mg == 600.0

    monkeypatch.setattr(nutrition_api.usda, "lookup_per_100g", lambda label: None)
    items, fallback_used = nutrition_api._merge_items(
        [nutrition_api.VlmItem(label="Mystery stew", portion_g=200.0, confidence=0.9, estimated_kcal=300.0)]
    )
    assert fallback_used is True
    assert items[0].fiber_g is None
    assert items[0].sugar_g is None
    assert items[0].sodium_mg is None
