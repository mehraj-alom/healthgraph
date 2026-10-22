"""
Premium purchase tracking tests.

Pure tests, no database required: endpoint logic runs against a stubbed
session. The store (Play / RevenueCat) stays the source of truth for
access — these endpoints only keep the business record straight.
"""

import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.api.v1.premium import (
    PurchaseReport,
    premium_status,
    purchase_history,
    report_purchase,
)


def _row(**over):
    base = {
        "id": uuid.uuid4(),
        "patient_id": uuid.uuid4(),
        "tier": "general",
        "status": "active",
        "provider": "google_play",
        "product_id": "hg_general_monthly",
        "entitlement": "general",
        "purchase_token": None,
        "order_id": None,
        "environment": "production",
        "auto_renewing": True,
        "started_at": None,
        "expires_at": None,
        "created_at": datetime(2026, 10, 1),
    }
    base.update(over)
    return SimpleNamespace(**base)


def _scalars(rows):
    m = MagicMock()
    m.all.return_value = rows
    return m


def _db(select_rows=None, get_row=None):
    db = MagicMock()
    scalars = MagicMock()
    if select_rows is not None:
        scalars.all.return_value = select_rows
    if get_row is not None:
        scalars.all.return_value = [get_row]
    executed = MagicMock()
    executed.scalars.return_value = scalars
    # scalar_one_or_none() is used for the token upsert lookup.
    executed.scalar_one_or_none.return_value = get_row
    db.execute.return_value = executed
    return db


def _pid():
    return uuid.uuid4()


class TestReportValidation:
    def test_rejects_unknown_tier(self):
        with pytest.raises(Exception):
            PurchaseReport(tier="platinum")

    def test_rejects_unknown_status(self):
        with pytest.raises(Exception):
            PurchaseReport(tier="general", status="bogus")

    def test_normalizes_tier_case(self):
        assert PurchaseReport(tier="AllIn").tier == "allin"


class TestReportPurchase:
    def test_creates_row_and_returns_201_shape(self):
        db = _db()
        out = report_purchase(PurchaseReport(tier="general"), _pid(), db)
        assert out.tier == "general"
        assert out.status == "active"
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_token_report_refreshes_existing_row(self):
        existing = _row(tier="general", purchase_token="tok-1", status="active")
        db = _db(get_row=existing)
        out = report_purchase(
            PurchaseReport(tier="allin", purchase_token="tok-1"), _pid(), db
        )
        assert existing.tier == "allin"
        assert out.tier == "allin"
        db.add.assert_not_called()
        db.commit.assert_called_once()


class TestPremiumStatus:
    def test_free_when_no_purchases(self):
        db = _db(select_rows=[])
        # select() path returns .scalars().all(); make sure both shapes work.
        db.execute.return_value.scalars.return_value.all.return_value = []
        out = premium_status(_pid(), db)
        assert out.tier == "free"
        assert out.purchase is None
        assert out.purchase_count == 0

    def test_active_purchase_sets_tier(self):
        rows = [_row(tier="general")]
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = rows
        out = premium_status(_pid(), db)
        assert out.tier == "general"
        assert out.purchase is not None
        assert out.purchase.tier == "general"
        assert out.purchase_count == 1

    def test_expired_purchase_falls_back_to_free(self):
        rows = [_row(tier="allin", expires_at=datetime(2020, 1, 1))]
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = rows
        out = premium_status(_pid(), db)
        assert out.tier == "free"
        assert out.purchase is None

    def test_highest_live_tier_wins(self):
        rows = [
            _row(tier="general"),
            _row(tier="allin"),
        ]
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = rows
        out = premium_status(_pid(), db)
        assert out.tier == "allin"
        assert out.purchase_count == 2

    def test_future_expiry_stays_live(self):
        rows = [
            _row(
                tier="allin",
                expires_at=datetime.now() + timedelta(days=20),
            )
        ]
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = rows
        out = premium_status(_pid(), db)
        assert out.tier == "allin"


class TestPurchaseHistory:
    def test_newest_first_shapes(self):
        rows = [_row(tier="allin"), _row(tier="general")]
        db = MagicMock()
        db.execute.return_value.scalars.return_value.all.return_value = rows
        out = purchase_history(_pid(), db)
        assert [p.tier for p in out.purchases] == ["allin", "general"]
