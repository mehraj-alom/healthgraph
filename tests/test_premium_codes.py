"""
Premium codes + admin + checkout tests.

Pure tests, no database required: redeem logic and the admin guard run
against stubbed sessions; Stripe paths are verified in degraded mode
(no keys configured) so they never touch the network.
"""

import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from app.api.v1 import admin as admin_api
from app.api.v1 import checkout as checkout_api
from app.api.v1 import premium as premium_api
from core.config import settings


def _code(**over):
    base = {
        "id": uuid.uuid4(),
        "code": "ABCD1234",
        "tier": "general",
        "status": "issued",
        "valid_days": 30,
        "max_uses": 1,
        "uses": 0,
        "issued_to_email": None,
        "issued_by": "admin",
        "note": None,
        "redeemed_by": None,
        "redeemed_at": None,
        "expires_at": None,
        "created_at": datetime(2026, 10, 9),
    }
    base.update(over)
    return SimpleNamespace(**base)


def _db_for_redeem(code_row=None, prior_grant=None):
    """Stub session: first scalar_one_or_none -> code row,scalars -> grant."""
    db = MagicMock()

    def _execute(stmt):
        text = str(stmt)
        m = MagicMock()
        if "premium_codes" in text:
            m.scalar_one_or_none.return_value = code_row
            s = MagicMock()
            s.first.return_value = prior_grant
            m.scalars.return_value = s
        else:
            m.scalar_one_or_none.return_value = prior_grant
            s = MagicMock()
            s.first.return_value = prior_grant
            s.all.return_value = []
            m.scalars.return_value = s
        return m

    db.execute.side_effect = _execute
    return db


class TestRedeemValidation:
    def test_normalizes_display_format(self):
        r = premium_api.RedeemRequest(code="hg-abcd-1234")
        assert r.code == "ABCD1234"

    def test_rejects_short_code(self):
        with pytest.raises(Exception):
            premium_api.RedeemRequest(code="ABC")


class TestRedeem:
    def test_unknown_code_404(self):
        db = _db_for_redeem(code_row=None)
        with pytest.raises(HTTPException) as e:
            premium_api.redeem_code(
                premium_api.RedeemRequest(code="HG-ZZZZ-9999"), uuid.uuid4(), db
            )
        assert e.value.status_code == 404

    def test_revoked_code_410(self):
        db = _db_for_redeem(code_row=_code(status="revoked"))
        with pytest.raises(HTTPException) as e:
            premium_api.redeem_code(
                premium_api.RedeemRequest(code="HG-ABCD-1234"), uuid.uuid4(), db
            )
        assert e.value.status_code == 410

    def test_live_code_grants_tier_and_mirrors_ledger(self):
        row = _code()
        db = _db_for_redeem(code_row=row)
        out = premium_api.redeem_code(
            premium_api.RedeemRequest(code="HG-ABCD-1234"), uuid.uuid4(), db
        )
        assert out.tier == "general"
        assert out.expires_at is not None
        assert row.uses == 1
        assert row.status == "redeemed"
        db.add.assert_called_once()  # the mirrored premium_purchases row
        db.commit.assert_called_once()

    def test_same_patient_resubmit_reads_as_success(self):
        pid = uuid.uuid4()
        row = _code(status="redeemed", uses=1, redeemed_by=pid)
        grant = SimpleNamespace(expires_at=datetime(2026, 11, 8))
        db = _db_for_redeem(code_row=row, prior_grant=grant)
        out = premium_api.redeem_code(
            premium_api.RedeemRequest(code="HG-ABCD-1234"), pid, db
        )
        assert out.already_redeemed is True
        assert out.tier == "general"

    def test_other_patient_on_spent_code_410(self):
        row = _code(status="redeemed", uses=1, redeemed_by=uuid.uuid4())
        db = _db_for_redeem(code_row=row)
        with pytest.raises(HTTPException) as e:
            premium_api.redeem_code(
                premium_api.RedeemRequest(code="HG-ABCD-1234"), uuid.uuid4(), db
            )
        assert e.value.status_code == 410


class TestAdminGuard:
    def test_no_token_configured_hides_routes(self):
        old = settings.ADMIN_API_TOKEN
        settings.ADMIN_API_TOKEN = ""
        try:
            req = SimpleNamespace(headers={})
            with pytest.raises(HTTPException) as e:
                import asyncio

                asyncio.run(admin_api.require_admin(req))
            assert e.value.status_code == 404
        finally:
            settings.ADMIN_API_TOKEN = old

    def test_wrong_token_forbidden(self):
        old = settings.ADMIN_API_TOKEN
        settings.ADMIN_API_TOKEN = "correct-token"
        try:
            req = SimpleNamespace(headers={"x-admin-token": "wrong"})
            with pytest.raises(HTTPException) as e:
                import asyncio

                asyncio.run(admin_api.require_admin(req))
            assert e.value.status_code == 403
        finally:
            settings.ADMIN_API_TOKEN = old


class TestCheckoutDegraded:
    def test_session_without_keys_503(self):
        old = settings.STRIPE_SECRET_KEY
        settings.STRIPE_SECRET_KEY = ""
        try:
            with pytest.raises(HTTPException) as e:
                checkout_api.create_session(
                    checkout_api.SessionRequest(tier="general")
                )
            assert e.value.status_code == 503
        finally:
            settings.STRIPE_SECRET_KEY = old

    def test_rejects_unknown_tier(self):
        with pytest.raises(Exception):
            checkout_api.SessionRequest(tier="platinum")
