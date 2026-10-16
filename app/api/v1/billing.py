"""Play billing verification (server truth for premium entitlement).

Flow: the app completes a Play purchase, sends {product_id,
purchase_token} here, and this endpoint verifies the purchase against
the Google Play Developer API before writing entitlement. The client
NEVER sets entitlement by itself — the local flag is a cache of what
GET /api/v1/profile reports.

Without Play service-account credentials or the google client library
the endpoint answers 503 (billing not configured), never success.
"""

import os
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.db import get_db
from core.security_events import log_security_event
from app.api.dependencies import get_authenticated_patient_id
from models.identity import Patient
from services.billing.products import is_premium, resolve_subscription, tier_for_product


router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


class VerifyPurchaseRequest(BaseModel):
    product_id: str = Field(..., max_length=128)
    purchase_token: str = Field(..., max_length=512)


class VerifyPurchaseResponse(BaseModel):
    tier: str
    expires_at: str | None = None
    premium: bool = False


def _play_subscription(package_name: str, purchase_token: str) -> dict:
    """Fetch a subscription purchase from the Play Developer API.

    Raises RuntimeError when billing is not configured here, ImportError
    when the Google client library is missing. Callers translate both to
    503 — billing misconfiguration is never the client's fault.
    """
    creds_json = os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "")
    if not creds_json:
        raise RuntimeError("play-service-account-missing")
    try:
        from google.oauth2 import service_account  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except ImportError as exc:
        raise ImportError("google-client-missing") from exc
    import json as _json

    info = _json.loads(creds_json)
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/androidpublisher"]
    )
    service = build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)
    request = (
        service.purchases()
        .subscriptionsv2()
        .get(packageName=package_name, purchaseToken=purchase_token)
    )
    response = request.execute()
    return response if isinstance(response, dict) else {}


def _acknowledge_subscription(package_name: str, subscription_id: str, purchase_token: str) -> None:
    """Acknowledge an unacknowledged subscription (best-effort)."""
    creds_json = os.getenv("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON", "")
    if not creds_json:
        return
    try:
        import json as _json

        from google.oauth2 import service_account  # type: ignore
        from googleapiclient.discovery import build  # type: ignore
    except ImportError:
        return
    try:
        info = _json.loads(creds_json)
        credentials = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/androidpublisher"]
        )
        service = build("androidpublisher", "v3", credentials=credentials, cache_discovery=False)
        service.purchases().subscriptions().acknowledge(
            packageName=package_name,
            subscriptionId=subscription_id,
            token=purchase_token,
            body={},
        ).execute()
    except Exception:
        # Acknowledgement is best-effort: Play auto-handles unacknowledged
        # purchases by refunding; entitlement below already required a
        # verified paid state, so a failed ack must not revoke it.
        return


@router.post("/verify", response_model=VerifyPurchaseResponse)
def verify_purchase(
    payload: VerifyPurchaseRequest,
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Verify a Play purchase and record entitlement.

    400 unknown product · 404 patient · 409 Play says unpaid/lapsed ·
    503 billing not configured here.
    """
    tier = tier_for_product(payload.product_id)
    if tier is None or tier == "free":
        raise HTTPException(status_code=400, detail="Unknown product.")

    package_name = os.getenv("ANDROID_PACKAGE_NAME", "")
    if not package_name:
        log_security_event("billing_misconfigured", patient_id=str(patient_id))
        raise HTTPException(status_code=503, detail="Billing is not configured.")

    try:
        response = _play_subscription(package_name, payload.purchase_token)
    except RuntimeError:
        log_security_event("billing_misconfigured", patient_id=str(patient_id))
        raise HTTPException(status_code=503, detail="Billing is not configured.")
    except ImportError:
        log_security_event("billing_misconfigured", patient_id=str(patient_id))
        raise HTTPException(status_code=503, detail="Billing is not configured.")
    except Exception:
        log_security_event("billing_verify_failed", patient_id=str(patient_id))
        raise HTTPException(status_code=409, detail="Purchase could not be verified.")

    resolved = resolve_subscription(payload.product_id, response)
    if not resolved["acknowledged"]:
        _acknowledge_subscription(package_name, payload.product_id, payload.purchase_token)
    if not is_premium(resolved["tier"], resolved["expires_at"]):
        log_security_event("billing_verify_rejected", patient_id=str(patient_id))
        raise HTTPException(status_code=409, detail="Purchase is not active.")

    patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found.")
    patient.premium_tier = resolved["tier"]
    patient.premium_expires_at = datetime.fromisoformat(resolved["expires_at"])
    db.commit()

    return VerifyPurchaseResponse(
        tier=resolved["tier"],
        expires_at=resolved["expires_at"],
        premium=True,
    )
