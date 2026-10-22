"""
mr admin panel API — buyers, codes, stats.

Guard: every route requires the X-Admin-Token header matching
settings.ADMIN_API_TOKEN (constant-time compare). When no token is
configured, all routes answer 404 so there is no probing surface.
"""

import logging
import secrets
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import desc, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.v1.premium import format_code, mint_code
from core.config import settings
from core.db import get_db
from models.premium import (
    ALLOWED_TIERS,
    CODE_REVOKED,
    PremiumCode,
    PremiumPurchase,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


async def require_admin(request: Request) -> None:
    expected = (settings.ADMIN_API_TOKEN or "").strip()
    if not expected:
        raise HTTPException(status_code=404, detail="Not found")
    given = request.headers.get("x-admin-token", "")
    if not given or not secrets.compare_digest(given, expected):
        raise HTTPException(status_code=403, detail="Forbidden")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class CodeIssue(BaseModel):
    tier: str = Field(min_length=1, max_length=16)
    count: int = Field(default=1, ge=1, le=100)
    valid_days: int = Field(default=30, ge=1, le=3650)
    max_uses: int = Field(default=1, ge=1, le=100)
    issued_to_email: str | None = Field(default=None, max_length=255)
    note: str | None = Field(default=None, max_length=255)
    expires_at: datetime | None = None

    @field_validator("tier")
    @classmethod
    def _tier(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ALLOWED_TIERS:
            raise ValueError(f"tier must be one of {ALLOWED_TIERS}")
        return v


class IssuedCode(BaseModel):
    id: str
    code: str
    tier: str
    status: str
    valid_days: int
    expires_at: datetime | None = None


class CodeListItem(IssuedCode):
    uses: int
    max_uses: int
    issued_to_email: str | None = None
    issued_by: str
    note: str | None = None
    created_at: datetime | None = None


class BuyerItem(BaseModel):
    id: str
    patient_id: str
    tier: str
    status: str
    provider: str
    product_id: str | None = None
    order_id: str | None = None
    auto_renewing: bool | None = None
    started_at: datetime | None = None
    expires_at: datetime | None = None
    created_at: datetime | None = None


class StatsResponse(BaseModel):
    buyers_by_tier: dict[str, int]
    buyers_by_status: dict[str, int]
    codes_issued: int
    codes_redeemed: int
    active_codes: int


@router.post(
    "/codes", response_model=list[IssuedCode], dependencies=[Depends(require_admin)]
)
def issue_codes(
    payload: CodeIssue, db: Session = Depends(get_db)
) -> list[IssuedCode]:
    """Mint `count` redeemable codes (plaintext returned once — save them)."""
    out: list[IssuedCode] = []
    try:
        for _ in range(payload.count):
            row = mint_code(
                db,
                tier=payload.tier,
                valid_days=payload.valid_days,
                issued_by="admin",
                issued_to_email=payload.issued_to_email,
                note=payload.note,
                max_uses=payload.max_uses,
                expires_at=payload.expires_at,
            )
            out.append(
                IssuedCode(
                    id=str(row.id),
                    code=format_code(row.code),
                    tier=row.tier,
                    status=row.status,
                    valid_days=row.valid_days,
                    expires_at=row.expires_at,
                )
            )
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        logger.exception("admin code issue failed")
        raise HTTPException(status_code=500, detail="Could not issue codes")
    logger.info("admin issued %d %s codes", len(out), payload.tier)
    return out


@router.get(
    "/codes", response_model=list[CodeListItem], dependencies=[Depends(require_admin)]
)
def list_codes(
    status: str | None = Query(default=None, max_length=16),
    tier: str | None = Query(default=None, max_length=16),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[CodeListItem]:
    stmt = select(PremiumCode).order_by(desc(PremiumCode.created_at)).limit(limit)
    if status:
        stmt = stmt.where(PremiumCode.status == status.strip().lower())
    if tier:
        stmt = stmt.where(PremiumCode.tier == tier.strip().lower())
    rows = db.execute(stmt).scalars().all()
    return [
        CodeListItem(
            id=str(r.id),
            code=format_code(r.code),
            tier=r.tier,
            status=r.status,
            valid_days=r.valid_days,
            expires_at=r.expires_at,
            uses=r.uses,
            max_uses=r.max_uses,
            issued_to_email=r.issued_to_email,
            issued_by=r.issued_by,
            note=r.note,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post(
    "/codes/{code_id}/revoke", dependencies=[Depends(require_admin)]
)
def revoke_code(code_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    try:
        row_id = uuid.UUID(code_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Code not found")
    row = db.get(PremiumCode, row_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Code not found")
    row.status = CODE_REVOKED
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise HTTPException(status_code=500, detail="Could not revoke code")
    return {"id": code_id, "status": CODE_REVOKED}


@router.get(
    "/purchases",
    response_model=list[BuyerItem],
    dependencies=[Depends(require_admin)],
)
def list_buyers(
    tier: str | None = Query(default=None, max_length=16),
    status: str | None = Query(default=None, max_length=16),
    provider: str | None = Query(default=None, max_length=32),
    q: str | None = Query(default=None, max_length=128),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[BuyerItem]:
    """Buyer table: who bought premium, which tier, which state."""
    stmt = (
        select(PremiumPurchase)
        .order_by(desc(PremiumPurchase.created_at))
        .limit(limit)
    )
    if tier:
        stmt = stmt.where(PremiumPurchase.tier == tier.strip().lower())
    if status:
        stmt = stmt.where(PremiumPurchase.status == status.strip().lower())
    if provider:
        stmt = stmt.where(PremiumPurchase.provider == provider.strip().lower())
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(
            or_(
                PremiumPurchase.order_id.ilike(like),
                PremiumPurchase.product_id.ilike(like),
            )
        )
    rows = db.execute(stmt).scalars().all()
    return [
        BuyerItem(
            id=str(r.id),
            patient_id=str(r.patient_id),
            tier=r.tier,
            status=r.status,
            provider=r.provider,
            product_id=r.product_id,
            order_id=r.order_id,
            auto_renewing=r.auto_renewing,
            started_at=r.started_at,
            expires_at=r.expires_at,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.get(
    "/stats", response_model=StatsResponse, dependencies=[Depends(require_admin)]
)
def admin_stats(db: Session = Depends(get_db)) -> StatsResponse:
    by_tier = dict(
        db.execute(
            select(PremiumPurchase.tier, func.count()).group_by(PremiumPurchase.tier)
        ).all()
    )
    by_status = dict(
        db.execute(
            select(PremiumPurchase.status, func.count()).group_by(
                PremiumPurchase.status
            )
        ).all()
    )
    codes_issued = (
        db.execute(select(func.count()).select_from(PremiumCode)).scalar() or 0
    )
    codes_redeemed = (
        db.execute(
            select(func.count())
            .select_from(PremiumCode)
            .where(PremiumCode.uses > 0)
        ).scalar()
        or 0
    )
    active_codes = (
        db.execute(
            select(func.count())
            .select_from(PremiumCode)
            .where(PremiumCode.status == "issued")
        ).scalar()
        or 0
    )
    return StatsResponse(
        buyers_by_tier={str(k): int(v) for k, v in by_tier.items()},
        buyers_by_status={str(k): int(v) for k, v in by_status.items()},
        codes_issued=int(codes_issued),
        codes_redeemed=int(codes_redeemed),
        active_codes=int(active_codes),
    )
