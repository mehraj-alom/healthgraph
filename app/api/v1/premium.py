"""
Premium purchase tracking.

The app reports each verified store purchase here so the backend keeps a
business record of who bought which paid tier: support lookups ("which
plan is this user on?"), status for the in-app plan screen, and purchase
history. The Play Store / RevenueCat entitlement stays the source of
truth for access — this table never grants access by itself.

Endpoints (all authenticated):
  POST /api/v1/premium/purchases  — record (or refresh) a purchase
  GET  /api/v1/premium/status      — effective tier + current purchase
  GET  /api/v1/premium/purchases   — own purchase history, newest first
"""

import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.premium import (
    ALLOWED_STATUSES,
    ALLOWED_TIERS,
    CODE_EXPIRED,
    CODE_ISSUED,
    CODE_REDEEMED,
    CODE_REVOKED,
    STATUS_ACTIVE,
    PremiumCode,
    PremiumPurchase,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/premium", tags=["premium"])


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PurchaseReport(BaseModel):
    tier: str = Field(min_length=1, max_length=16)
    status: str = Field(default=STATUS_ACTIVE, max_length=16)
    provider: str = Field(default="google_play", max_length=32)
    product_id: str | None = Field(default=None, max_length=128)
    entitlement: str | None = Field(default=None, max_length=64)
    purchase_token: str | None = Field(default=None, max_length=255)
    order_id: str | None = Field(default=None, max_length=128)
    environment: str | None = Field(default=None, max_length=16)
    auto_renewing: bool | None = None
    started_at: datetime | None = None
    expires_at: datetime | None = None

    @field_validator("tier")
    @classmethod
    def _tier(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALLOWED_TIERS:
            raise ValueError(f"tier must be one of {ALLOWED_TIERS}")
        return v

    @field_validator("status")
    @classmethod
    def _status(cls, v: str) -> str:
        v = (v or STATUS_ACTIVE).strip().lower()
        if v not in ALLOWED_STATUSES:
            raise ValueError(f"status must be one of {ALLOWED_STATUSES}")
        return v


class PurchaseResponse(BaseModel):
    id: str
    tier: str
    status: str
    product_id: str | None = None
    order_id: str | None = None
    environment: str | None = None
    auto_renewing: bool | None = None
    started_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None


class PremiumStatus(BaseModel):
    tier: str
    status: str = "free"
    purchase: PurchaseResponse | None = None
    purchase_count: int = 0


class PurchaseHistory(BaseModel):
    purchases: list[PurchaseResponse]


def _to_response(row: PremiumPurchase) -> PurchaseResponse:
    return PurchaseResponse(
        id=str(row.id),
        tier=row.tier,
        status=row.status,
        product_id=row.product_id,
        order_id=row.order_id,
        environment=row.environment,
        auto_renewing=row.auto_renewing,
        started_at=row.started_at,
        expires_at=row.expires_at,
        created_at=row.created_at,
    )


def _is_live(row: PremiumPurchase, now: datetime) -> bool:
    if row.status != STATUS_ACTIVE:
        return False
    if row.expires_at is not None and row.expires_at <= now:
        return False
    return True


# ─── Redeemable codes ────────────────────────────────────────────────────

# Unambiguous alphabet (no 0/O, 1/I/L): shown as HG-XXXX-XXXX, stored bare.
_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def normalize_code(raw: str) -> str:
    return "".join(ch for ch in raw.strip().upper() if ch.isalnum())


def format_code(stored: str) -> str:
    return f"HG-{stored[:4]}-{stored[4:8]}" if len(stored) == 8 else stored


def generate_code_value() -> str:
    rng = secrets.SystemRandom()
    return "".join(rng.choice(_CODE_ALPHABET) for _ in range(8))


def mint_code(
    db: Session,
    *,
    tier: str,
    valid_days: int,
    issued_by: str,
    issued_to_email: str | None = None,
    note: str | None = None,
    max_uses: int = 1,
    expires_at: datetime | None = None,
) -> PremiumCode:
    """Create a code row, retrying on the (astronomically rare) collision."""
    for _ in range(5):
        row = PremiumCode(
            id=uuid.uuid4(),
            code=generate_code_value(),
            tier=tier,
            status=CODE_ISSUED,
            valid_days=valid_days,
            max_uses=max_uses,
            uses=0,
            issued_to_email=issued_to_email,
            issued_by=issued_by,
            note=note,
            expires_at=expires_at,
        )
        db.add(row)
        try:
            db.flush()
            return row
        except IntegrityError:
            db.rollback()
            continue
    raise HTTPException(status_code=500, detail="Could not issue code")


class RedeemRequest(BaseModel):
    code: str = Field(min_length=4, max_length=32)

    @field_validator("code")
    @classmethod
    def _code(cls, v: str) -> str:
        v = normalize_code(v)
        # Accept the displayed HG- prefix or the bare value.
        if v.startswith("HG"):
            v = v[2:]
        if len(v) != 8:
            raise ValueError("invalid code")
        return v


class RedeemResponse(BaseModel):
    tier: str
    expires_at: datetime | None = None
    already_redeemed: bool = False


@router.post("/redeem", response_model=RedeemResponse)
def redeem_code(
    payload: RedeemRequest,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
) -> RedeemResponse:
    """Redeem a premium code: grants `tier` for `valid_days` from now.

    The grant is mirrored into premium_purchases (provider `promo_code`),
    so status/history and the app's ledger read stay consistent.
    """
    now = _utcnow()
    row = db.execute(
        select(PremiumCode).where(PremiumCode.code == payload.code)
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Code not found")
    if row.status == CODE_REVOKED:
        raise HTTPException(status_code=410, detail="Code revoked")
    if row.status == CODE_EXPIRED or (
        row.expires_at is not None and row.expires_at <= now
    ):
        if row.status != CODE_EXPIRED:
            row.status = CODE_EXPIRED
            db.commit()
        raise HTTPException(status_code=410, detail="Code expired")
    if row.uses >= row.max_uses:
        # Same patient re-submitting their own code reads as success.
        if row.redeemed_by == patient_id:
            grant = (
                db.execute(
                    select(PremiumPurchase)
                    .where(
                        PremiumPurchase.patient_id == patient_id,
                        PremiumPurchase.order_id == f"code:{row.code}",
                    )
                    .order_by(desc(PremiumPurchase.created_at))
                )
                .scalars()
                .first()
            )
            return RedeemResponse(
                tier=row.tier,
                expires_at=grant.expires_at if grant else None,
                already_redeemed=True,
            )
        raise HTTPException(status_code=410, detail="Code already used")

    row.uses += 1
    row.redeemed_by = patient_id
    row.redeemed_at = now
    if row.uses >= row.max_uses:
        row.status = CODE_REDEEMED
    grant = PremiumPurchase(
        id=uuid.uuid4(),
        patient_id=patient_id,
        tier=row.tier,
        status=STATUS_ACTIVE,
        provider="promo_code",
        entitlement=row.tier,
        order_id=f"code:{row.code}",
        started_at=now,
        expires_at=now + timedelta(days=row.valid_days),
    )
    db.add(grant)
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("premium code redeem failed")
        raise HTTPException(status_code=500, detail="Could not redeem code")
    db.refresh(grant)
    logger.info(
        "premium code redeemed",
        extra={"code_id": str(row.id), "tier": row.tier},
    )
    return RedeemResponse(tier=row.tier, expires_at=grant.expires_at)


@router.post("/purchases", response_model=PurchaseResponse, status_code=201)
def report_purchase(
    payload: PurchaseReport,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
) -> PurchaseResponse:
    """Record a verified store purchase (idempotent on purchase_token)."""
    now = _utcnow()

    if payload.purchase_token:
        existing = db.execute(
            select(PremiumPurchase).where(
                PremiumPurchase.patient_id == patient_id,
                PremiumPurchase.purchase_token == payload.purchase_token,
            )
        ).scalar_one_or_none()
        if existing is not None:
            existing.tier = payload.tier
            existing.status = payload.status
            existing.provider = payload.provider or existing.provider
            existing.product_id = payload.product_id or existing.product_id
            existing.entitlement = payload.entitlement or existing.entitlement
            existing.order_id = payload.order_id or existing.order_id
            existing.environment = payload.environment or existing.environment
            if payload.auto_renewing is not None:
                existing.auto_renewing = payload.auto_renewing
            if payload.started_at is not None:
                existing.started_at = payload.started_at
            if payload.expires_at is not None:
                existing.expires_at = payload.expires_at
            try:
                db.commit()
            except SQLAlchemyError:
                db.rollback()
                logger.exception("premium purchase refresh failed")
                raise HTTPException(status_code=500, detail="Could not save purchase")
            db.refresh(existing)
            return _to_response(existing)

    row = PremiumPurchase(
        id=uuid.uuid4(),
        patient_id=patient_id,
        tier=payload.tier,
        status=payload.status,
        provider=payload.provider or "google_play",
        product_id=payload.product_id,
        entitlement=payload.entitlement,
        purchase_token=payload.purchase_token,
        order_id=payload.order_id,
        environment=payload.environment,
        auto_renewing=payload.auto_renewing,
        started_at=payload.started_at,
        expires_at=payload.expires_at,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race on the same token: return the stored row instead.
        db.rollback()
        if payload.purchase_token:
            existing = db.execute(
                select(PremiumPurchase).where(
                    PremiumPurchase.patient_id == patient_id,
                    PremiumPurchase.purchase_token == payload.purchase_token,
                )
            ).scalar_one_or_none()
            if existing is not None:
                return _to_response(existing)
        raise HTTPException(status_code=500, detail="Could not save purchase")
    except SQLAlchemyError:
        db.rollback()
        logger.exception("premium purchase commit failed")
        raise HTTPException(status_code=500, detail="Could not save purchase")
    db.refresh(row)
    logger.info(
        "premium purchase stored",
        extra={"purchase_id": str(row.id), "tier": row.tier},
    )
    return _to_response(row)


@router.get("/status", response_model=PremiumStatus)
def premium_status(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
) -> PremiumStatus:
    """Effective tier from the newest live purchase (free when none)."""
    rows = (
        db.execute(
            select(PremiumPurchase)
            .where(PremiumPurchase.patient_id == patient_id)
            .order_by(desc(PremiumPurchase.created_at))
        )
        .scalars()
        .all()
    )
    now = _utcnow()
    # Highest live tier wins, so an older All-in outranks a newer General
    # while both are active; newest-first keeps history deterministic.
    live = [r for r in rows if _is_live(r, now)]
    rank = {"general": 1, "allin": 2}
    best = max(live, key=lambda r: rank.get(r.tier, 0), default=None)
    if best is None:
        return PremiumStatus(tier="free", purchase=None, purchase_count=len(rows))
    return PremiumStatus(
        tier=best.tier,
        status=best.status,
        purchase=_to_response(best),
        purchase_count=len(rows),
    )


@router.get("/purchases", response_model=PurchaseHistory)
def purchase_history(
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
) -> PurchaseHistory:
    """Own purchase history, newest first (support + plan screen)."""
    rows = (
        db.execute(
            select(PremiumPurchase)
            .where(PremiumPurchase.patient_id == patient_id)
            .order_by(desc(PremiumPurchase.created_at))
        )
        .scalars()
        .all()
    )
    return PurchaseHistory(purchases=[_to_response(r) for r in rows])
