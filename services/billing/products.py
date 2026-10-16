"""Play product catalog and purchase-state mapping (pure stdlib).

The single source of truth for which Play product unlocks which tier and
how a verified Play subscription response resolves to entitlement. Both
the verify endpoint and the unit tests share this module — no network,
no database, no Google client here.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

#: Play product id → app tier. These ids must exist as subscription
#: products in the Play Console before any purchase can succeed.
PRODUCT_TO_TIER = {
    "hg_general_monthly": "general",
    "hg_allin_monthly": "allin",
}

#: Tiers the app understands (superset: unknown server values fail closed).
KNOWN_TIERS = {"free", "general", "allin"}

#: Google Play Developer API acknowledgement states (subscriptionsv2).
ACKNOWLEDGED = "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"


def tier_for_product(product_id: Any) -> Optional[str]:
    """App tier for a Play product id, or None when unknown."""
    if not isinstance(product_id, str):
        return None
    return PRODUCT_TO_TIER.get(product_id.strip() or product_id)


def _expiry_of(response: Any) -> Optional[datetime]:
    """Best expiry instant from a subscriptionsv2.get response."""
    if not isinstance(response, dict):
        return None
    raw = response.get("expiryTime")
    if not isinstance(raw, str) or not raw.strip():
        return None
    try:
        parsed = datetime.fromisoformat(raw.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def resolve_subscription(
    product_id: Any, response: Any, now: Optional[datetime] = None
) -> dict[str, Any]:
    """Resolve a verified Play response to entitlement.

    Returns {"tier", "expires_at" (ISO|None), "acknowledged" (bool)}.
    Unknown products, unparseable expiries, and already-lapsed
    subscriptions resolve to Free — never to paid on ambiguity.
    """
    moment = now or datetime.now(timezone.utc)
    tier = tier_for_product(product_id)
    expires_at = _expiry_of(response)
    acknowledged = (
        isinstance(response, dict)
        and response.get("acknowledgementState") == ACKNOWLEDGED
    )
    if tier is None or tier not in KNOWN_TIERS or tier == "free":
        return {"tier": "free", "expires_at": None, "acknowledged": acknowledged}
    if expires_at is None or expires_at <= moment:
        return {"tier": "free", "expires_at": None, "acknowledged": acknowledged}
    return {"tier": tier, "expires_at": expires_at.isoformat(), "acknowledged": acknowledged}


def is_premium(tier: Any, expires_at: Any, now: Optional[datetime] = None) -> bool:
    """Server-side premium check: paid tier with a future expiry."""
    if not isinstance(tier, str) or tier not in KNOWN_TIERS or tier == "free":
        return False
    if isinstance(expires_at, str):
        try:
            parsed = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            return False
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        expires_at = parsed
    if not isinstance(expires_at, datetime):
        return False
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return expires_at > moment
