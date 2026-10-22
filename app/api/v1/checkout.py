"""
Web checkout for 30-day premium codes (health.healthgraph.shop/buy).

One-time Stripe Checkout payments (General €11 / All-in €18) that mint a
redeemable code on success — the buyer enters it in the app
(Settings → Redeem code) and gets the tier for 30 days.

All Stripe calls go through httpx (no extra dependency). When keys are
absent, session creation answers 503 and the site falls back to
admin-issued codes. Webhook verification is HMAC-SHA256 per Stripe's
signing spec, using only the standard library.
"""

import hashlib
import hmac
import json
import logging
import time
import urllib.parse

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.v1.premium import format_code, mint_code
from core.config import settings
from core.db import get_db
from models.premium import ALLOWED_TIERS, PremiumCode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/checkout", tags=["checkout"])

TIER_PRICE = {"general": 1100, "allin": 1800}  # cents, display fallback
TIER_LABEL = {"general": "HealthGraph General — 30 days", "allin": "HealthGraph All-in — 30 days"}


def _stripe_key() -> str:
    return (settings.STRIPE_SECRET_KEY or "").strip()


def _price_for(tier: str) -> str:
    return (
        settings.STRIPE_PRICE_ALLIN.strip()
        if tier == "allin"
        else settings.STRIPE_PRICE_GENERAL.strip()
    )


class SessionRequest(BaseModel):
    tier: str = Field(min_length=1, max_length=16)
    email: str | None = Field(default=None, max_length=255)

    @field_validator("tier")
    @classmethod
    def _tier(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALLOWED_TIERS:
            raise ValueError(f"tier must be one of {ALLOWED_TIERS}")
        return v


class SessionResponse(BaseModel):
    url: str


def _stripe_post(path: str, data: dict[str, str]) -> dict:
    import httpx

    key = _stripe_key()
    if not key:
        raise HTTPException(status_code=503, detail="Checkout is not configured yet")
    try:
        resp = httpx.post(
            f"https://api.stripe.com/v1/{path}",
            data=data,
            headers={
                "Authorization": f"Bearer {key}",
                "Stripe-Version": "2025-12-15.preview",
            },
            timeout=20.0,
        )
    except Exception:
        logger.exception("stripe request failed")
        raise HTTPException(status_code=502, detail="Payment provider unreachable")
    if resp.status_code >= 400:
        logger.warning("stripe error %s: %s", resp.status_code, resp.text[:300])
        raise HTTPException(status_code=502, detail="Payment provider error")
    try:
        return resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Payment provider error")


def _stripe_get(path: str, session_id: str) -> dict:
    import httpx

    key = _stripe_key()
    if not key:
        raise HTTPException(status_code=503, detail="Checkout is not configured yet")
    try:
        resp = httpx.get(
            f"https://api.stripe.com/v1/{path}/{urllib.parse.quote(session_id, safe='')}",
            headers={
                "Authorization": f"Bearer {key}",
                "Stripe-Version": "2025-12-15.preview",
            },
            timeout=20.0,
        )
    except Exception:
        logger.exception("stripe retrieve failed")
        raise HTTPException(status_code=502, detail="Payment provider unreachable")
    if resp.status_code >= 400:
        raise HTTPException(status_code=404, detail="Order not found")
    return resp.json()


@router.post("/session", response_model=SessionResponse)
def create_session(payload: SessionRequest) -> SessionResponse:
    """Create a one-time Stripe Checkout session for a 30-day tier."""
    price = _price_for(payload.tier)
    data: dict[str, str] = {
        "mode": "payment",
        "success_url": f"{settings.PUBLIC_WEB_URL.rstrip('/')}/buy/success.html?session_id={{CHECKOUT_SESSION_ID}}",
        "cancel_url": f"{settings.PUBLIC_WEB_URL.rstrip('/')}/buy/",
        "metadata[tier]": payload.tier,
    }
    if price:
        data["line_items[0][price]"] = price
        data["line_items[0][quantity]"] = "1"
    else:
        data["line_items[0][price_data][currency]"] = "eur"
        data["line_items[0][price_data][unit_amount]"] = str(TIER_PRICE[payload.tier])
        data["line_items[0][price_data][product_data][name]"] = TIER_LABEL[payload.tier]
        data["line_items[0][quantity]"] = "1"
    if payload.email:
        data["customer_email"] = payload.email.strip()
    session = _stripe_post("checkout/sessions", data)
    url = session.get("url")
    if not url:
        raise HTTPException(status_code=502, detail="Payment provider error")
    return SessionResponse(url=url)


def _mint_for_session(
    db: Session, session_id: str, tier: str, email: str | None
) -> PremiumCode:
    """Idempotent: one code per paid Stripe session (tracked via note)."""
    marker = f"stripe:{session_id}"
    existing = db.execute(
        select(PremiumCode).where(PremiumCode.note == marker)
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    row = mint_code(
        db,
        tier=tier,
        valid_days=settings.CODE_DEFAULT_DAYS or 30,
        issued_by="stripe",
        issued_to_email=email,
        note=marker,
    )
    db.commit()
    db.refresh(row)
    return row


@router.get("/order")
def order_status(
    session_id: str = Query(min_length=4, max_length=255),
    db: Session = Depends(get_db),
) -> dict:
    """Success-page lookup: paid? if so, the code (shown once, saved by buyer)."""
    session = _stripe_get("checkout/sessions", session_id)
    paid = session.get("payment_status") == "paid"
    if not paid:
        return {"paid": False}
    tier = str((session.get("metadata") or {}).get("tier", "")).lower()
    if tier not in ALLOWED_TIERS:
        raise HTTPException(status_code=404, detail="Order not found")
    email = session.get("customer_details", {}).get("email") if isinstance(
        session.get("customer_details"), dict
    ) else None
    try:
        row = _mint_for_session(db, session_id, tier, email)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("stripe code mint failed")
        raise HTTPException(status_code=500, detail="Could not issue code")
    return {"paid": True, "tier": tier, "code": format_code(row.code)}


@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)) -> Response:
    """Stripe event webhook (idempotent code mint on session completion)."""
    secret = (settings.STRIPE_WEBHOOK_SECRET or "").strip()
    raw = await request.body()
    if secret:
        header = request.headers.get("stripe-signature", "")
        timestamp: str | None = None
        signatures: list[str] = []
        for part in header.split(","):
            k, _, v = part.partition("=")
            if k.strip() == "t":
                timestamp = v.strip()
            elif k.strip() == "v1":
                signatures.append(v.strip())
        valid = False
        if timestamp and signatures:
            try:
                age = abs(time.time() - int(timestamp))
            except ValueError:
                age = 10**9
            if age < 300:
                expected = hmac.new(
                    secret.encode(), f"{timestamp}.".encode() + raw, hashlib.sha256
                ).hexdigest()
                valid = any(hmac.compare_digest(expected, s) for s in signatures)
        if not valid:
            return Response(status_code=400, content="bad signature")
    try:
        event = json.loads(raw.decode("utf-8"))
    except ValueError:
        return Response(status_code=400, content="bad payload")
    if event.get("type") == "checkout.session.completed":
        obj = event.get("data", {}).get("object", {}) or {}
        if obj.get("payment_status") == "paid":
            tier = str((obj.get("metadata") or {}).get("tier", "")).lower()
            session_id = str(obj.get("id", ""))
            details = obj.get("customer_details") or {}
            email = details.get("email") if isinstance(details, dict) else None
            if tier in ALLOWED_TIERS and session_id:
                try:
                    _mint_for_session(db, session_id, tier, email)
                except SQLAlchemyError:
                    db.rollback()
                    logger.exception("stripe webhook mint failed")
    return Response(status_code=200, content="ok")
