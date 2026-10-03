"""
Public early-access signup endpoint.

Called by the healthgraph.shop landing page form (no auth: it is a public
waitlist). Duplicate emails answer success with already_registered=True so
the landing page never shows a spurious error for a repeat click.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from core.db import get_db
from models.early_access import EarlyAccessSignup

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/early-access", tags=["early-access"])

EMAIL_MAX = 255
NAME_MAX = 120
CITY_MAX = 120


class EarlyAccessRequest(BaseModel):
    name: str = Field(min_length=1, max_length=NAME_MAX)
    email: str = Field(min_length=5, max_length=EMAIL_MAX)
    city: str = Field(min_length=1, max_length=CITY_MAX)
    # Honeypot: bots fill it, humans never see it. Any content -> pretend success.
    company: str = Field(default="", max_length=200)

    @field_validator("name", "city")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        import re

        v = v.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", v):
            raise ValueError("invalid email")
        return v


class EarlyAccessResponse(BaseModel):
    status: str = "ok"
    already_registered: bool = False


@router.post("", response_model=EarlyAccessResponse, status_code=201)
def create_early_access_signup(
    payload: EarlyAccessRequest,
    db: Session = Depends(get_db),
) -> EarlyAccessResponse:
    # Honeypot tripped: act like success, store nothing.
    if payload.company:
        return EarlyAccessResponse()

    existing = db.execute(
        select(EarlyAccessSignup).where(EarlyAccessSignup.email == payload.email)
    ).scalar_one_or_none()
    if existing is not None:
        return EarlyAccessResponse(already_registered=True)

    signup = EarlyAccessSignup(
        id=uuid.uuid4(),
        name=payload.name,
        email=payload.email,
        city=payload.city,
        source="landing_page",
    )
    db.add(signup)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race with a duplicate submit; that is still a success.
        db.rollback()
        return EarlyAccessResponse(already_registered=True)
    except SQLAlchemyError:
        db.rollback()
        logger.exception("early-access signup commit failed")
        raise HTTPException(status_code=500, detail="Could not save your request")

    logger.info("early-access signup stored", extra={"signup_id": str(signup.id)})
    return EarlyAccessResponse()
