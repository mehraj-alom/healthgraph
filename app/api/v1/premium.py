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
import uuid
from datetime import datetime, timezone

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
    STATUS_ACTIVE,
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
