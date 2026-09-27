"""Barcode lookup: validation, Open Food Facts proxy, endpoint contract."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.dependencies import get_authenticated_patient_id
from app.services.nutrition import openfoodfacts
from app.services.nutrition.openfoodfacts import BarcodeProduct, BarcodeNutrients

PID = uuid.uuid4()

NUTELLA = "3017620422003"  # GS1-documented valid EAN-13
COKE_UPC = "049000028904"  # valid UPC-A (normalized with leading 0)
GS1_EXAMPLE = "5901234123457"  # GS1-documented valid EAN-13


def _client():
    was_ready = bool(getattr(app.state, "ready", False))
    app.state.ready = True
    return TestClient(app, raise_server_exceptions=False), was_ready


def test_normalize_accepts_ean13_upca_ean8():
    assert openfoodfacts.normalize_barcode(NUTELLA) == NUTELLA
    assert openfoodfacts.normalize_barcode(COKE_UPC) == "0" + COKE_UPC
    assert openfoodfacts.normalize_barcode(GS1_EXAMPLE) == GS1_EXAMPLE
    assert openfoodfacts.normalize_barcode(" 3017620422003 ") == NUTELLA
    assert openfoodfacts.normalize_barcode("301-7620422003") == NUTELLA


def test_normalize_rejects_bad_digits_and_lengths():
    assert openfoodfacts.normalize_barcode("3017620422004") is None  # bad check
    assert openfoodfacts.normalize_barcode("12345") is None
    assert openfoodfacts.normalize_barcode("abcdefghijklm") is None
    assert openfoodfacts.normalize_barcode("") is None
    assert openfoodfacts.normalize_barcode("12345678901234") is None  # EAN-14 w/o leading 0


def test_lookup_caches_and_maps_nutrients(monkeypatch):
    openfoodfacts._cache.clear()
    calls = []

    class FakeResp:
        status_code = 200

        def json(self):
            return {
                "status": 1,
                "product": {
                    "product_name": "Nutella",
                    "brands": "Ferrero",
                    "serving_size": "15g",
                    "image_url": "https://example.com/n.jpg",
                    "nutriments": {
                        "energy-kcal_100g": 539,
                        "proteins_100g": 6.3,
                        "carbohydrates_100g": 57.5,
                        "fat_100g": 30.9,
                    },
                },
            }

    def fake_get(url, headers=None, timeout=None):
        calls.append(url)
        assert "healthgraph" in (headers or {}).get("User-Agent", "").lower()
        return FakeResp()

    monkeypatch.setattr(openfoodfacts.httpx, "get", fake_get)
    first = openfoodfacts.lookup_by_barcode(NUTELLA)
    assert first is not None and first.name == "Nutella"
    assert first.nutrients.kcal_per_100g == 539
    assert first.source == "openfoodfacts"
    second = openfoodfacts.lookup_by_barcode(NUTELLA)
    assert second is first
    assert len(calls) == 1, "second lookup served from cache"


def test_lookup_unknown_and_unreachable_is_none(monkeypatch):
    openfoodfacts._cache.clear()

    class Missing:
        status_code = 404

    monkeypatch.setattr(
        openfoodfacts.httpx, "get", lambda *a, **k: Missing()
    )
    assert openfoodfacts.lookup_by_barcode(GS1_EXAMPLE) is None

    def boom(*a, **k):
        raise TimeoutError("down")

    monkeypatch.setattr(openfoodfacts.httpx, "get", boom)
    assert openfoodfacts.lookup_by_barcode(GS1_EXAMPLE) is None


def test_endpoint_rejects_invalid_barcode():
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        resp = client.get("/api/v1/nutrition/barcode/12345")
        assert resp.status_code == 400, resp.status_code
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready


def test_endpoint_404_unknown_and_200_known(monkeypatch):
    import app.api.v1.nutrition as nutrition

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(nutrition.openfoodfacts, "lookup_by_barcode", lambda code: None)
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        resp = client.get(f"/api/v1/nutrition/barcode/{NUTELLA}")
        assert resp.status_code == 404, resp.status_code

        monkeypatch.setattr(
            nutrition.openfoodfacts,
            "lookup_by_barcode",
            lambda code: BarcodeProduct(
                barcode=code,
                name="Nutella",
                brand="Ferrero",
                nutrients=BarcodeNutrients(kcal_per_100g=539, protein_g=6.3, carbs_g=57.5, fat_g=30.9),
                serving_size="15g",
            ),
        )
        resp = client.get(f"/api/v1/nutrition/barcode/{NUTELLA}")
        assert resp.status_code == 200, resp.status_code
        body = resp.json()
        assert body["name"] == "Nutella" and body["nutrients"]["kcal_per_100g"] == 539
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready


def test_endpoint_requires_auth_not_404():
    client, was_ready = _client()
    try:
        resp = client.get(f"/api/v1/nutrition/barcode/{NUTELLA}")
        assert resp.status_code in (401, 403), resp.status_code
    finally:
        app.state.ready = was_ready
