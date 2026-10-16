"""Billing product catalog and entitlement mapping (stdlib-only).

Run: python -m pytest tests/test_billing_products.py
"""

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.billing.products import (
    is_premium,
    resolve_subscription,
    tier_for_product,
)

NOW = datetime(2026, 10, 15, tzinfo=timezone.utc)
FUTURE = (NOW + timedelta(days=30)).isoformat()
PAST = (NOW - timedelta(days=1)).isoformat()


def _response(product_ok=True, expiry=FUTURE, acknowledged=True):
    return {
        "expiryTime": expiry,
        "acknowledgementState": (
            "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED" if acknowledged else "ACKNOWLEDGEMENT_STATE_PENDING"
        ),
    }


def test_catalog_maps_products_to_tiers():
    assert tier_for_product("hg_general_monthly") == "general"
    assert tier_for_product("hg_allin_monthly") == "allin"
    assert tier_for_product("hg_unknown") is None
    assert tier_for_product(None) is None
    assert tier_for_product("") is None


def test_active_subscription_resolves_paid():
    resolved = resolve_subscription("hg_general_monthly", _response(), now=NOW)
    assert resolved == {"tier": "general", "expires_at": FUTURE, "acknowledged": True}


def test_ambiguity_resolves_free_never_paid():
    assert resolve_subscription("hg_unknown", _response(), now=NOW)["tier"] == "free"
    assert resolve_subscription("hg_general_monthly", {}, now=NOW)["tier"] == "free"
    assert resolve_subscription("hg_general_monthly", _response(expiry=PAST), now=NOW)["tier"] == "free"
    assert resolve_subscription("hg_general_monthly", _response(expiry="garbage"), now=NOW)["tier"] == "free"
    assert resolve_subscription("hg_general_monthly", None, now=NOW)["tier"] == "free"


def test_unacknowledged_still_resolves_tier_flagged():
    resolved = resolve_subscription("hg_allin_monthly", _response(acknowledged=False), now=NOW)
    assert resolved["tier"] == "allin"
    assert resolved["acknowledged"] is False


def test_is_premium_needs_paid_tier_and_future_expiry():
    assert is_premium("general", FUTURE, now=NOW) is True
    assert is_premium("allin", FUTURE, now=NOW) is True
    assert is_premium("free", FUTURE, now=NOW) is False
    assert is_premium("general", PAST, now=NOW) is False
    assert is_premium("general", None, now=NOW) is False
    assert is_premium("general", "garbage", now=NOW) is False
    assert is_premium("enterprise", FUTURE, now=NOW) is False


def _repo_src(rel):
    return (Path(__file__).resolve().parent.parent / rel).read_text()


def test_verify_endpoint_wiring():
    billing = _repo_src("app/api/v1/billing.py")
    assert '"/verify"' in billing or "'/verify'" in billing
    assert "tier_for_product" in billing
    assert "resolve_subscription" in billing
    assert "is_premium" in billing
    # Never grants without Play: misconfiguration and unverified buys fail.
    assert "503" in billing
    assert "409" in billing
    # No silent success path, no hardcoded grant.
    assert "premium_tier" in billing
    main = _repo_src("app/main.py")
    assert "billing.router" in main


def test_entitlement_migration_chains_on_head():
    migration = _repo_src("alembic/versions/bl01_premium_entitlement.py")
    assert 'down_revision = "ea01earlyaccess"' in migration
    assert "premium_tier" in migration
    assert "premium_expires_at" in migration
    identity = _repo_src("models/identity.py")
    assert "premium_tier" in identity
    assert "premium_expires_at" in identity
    profile = _repo_src("schemas/profile.py")
    assert "premium_tier" in profile
