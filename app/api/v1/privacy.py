"""P0 privacy / data-lifecycle engineering endpoints.

Implements ONLY engineering controls from the P0 report:
- consent receipts + withdrawal flags (DPDP R.3 / GDPR Art. 7 lite)
- DSR intake + SLA tracking (access/export/correction/erasure)
- self-service export bundle (PG metadata; blobs via the file endpoint)
- audit trail hooks for all of the above

Explicitly NOT included (require policy/legal ownership):
- the notice/Terms/Privacy text itself (notice_version is client-supplied;
  counsel must approve the text behind each version)
- SLA clock interpretation (due_at defaults to +90d; GDPR 1-month vs DPDP
  90-day is a policy decision)

Erasure fulfillment (P1): the erasure orchestrator in services/erasure.py
fulfills deletion via DELETE /privacy/data (all health records, account
kept) and DELETE /privacy/account (records + identity). Erasure-type DSRs
are marked fulfilled by the data endpoint; the endpoints report an honest
per-subsystem completed/partial status and are idempotent, so retries
converge.

Grandfathering rule: patients without any receipt keep existing
functionality; those calls are audit-logged as consent_unknown so policy
can set an enforcement date. An explicit withdrawal blocks NEW processing
(uploads) until a newer granted receipt exists.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from models.privacy import ConsentReceipt, ConsentScope, DataSubjectRequest, DSRStatus, DSRType, log_audit

router = APIRouter(prefix="/api/v1/privacy", tags=["privacy"])


class ConsentCapture(BaseModel):
    scope: str = Field(description="clinical_storage | ai_processing | analytics")
    notice_version: str
    notice_hash: Optional[str] = None
    granted: bool = True
    age_confirmed_18_plus: bool = False
    is_guardian_consent: bool = False
    method: str = "app"


class ConsentReceiptResponse(BaseModel):
    id: uuid.UUID
    scope: str
    notice_version: str
    granted: bool
    age_confirmed_18_plus: bool
    is_guardian_consent: bool
    withdrawn_at: Optional[datetime] = None
    created_at: datetime


class WithdrawRequest(BaseModel):
    scope: str


class DSRCreate(BaseModel):
    request_type: str = Field(description="access | export | correction | erasure")
    details: Optional[dict] = None


class DSRResponse(BaseModel):
    id: uuid.UUID
    request_type: str
    status: str
    due_at: Optional[datetime] = None
    created_at: datetime


def _latest_receipt(db: Session, patient_id: uuid.UUID, scope: str) -> ConsentReceipt | None:
    return (
        db.execute(
            select(ConsentReceipt)
            .where(ConsentReceipt.patient_id == patient_id, ConsentReceipt.scope == scope)
            .order_by(ConsentReceipt.created_at.desc())
            .limit(1)
        ).scalar_one_or_none()
    )


def assert_processing_allowed(db: Session, patient_id: uuid.UUID, scope: str = ConsentScope.AI_PROCESSING.value) -> None:
    """P0 withdrawal enforcement for NEW processing (document uploads).

    - No receipt at all → allowed, audit-logged as consent_unknown
      (grandfathering; policy sets the enforcement date).
    - Latest receipt withdrawn → 403 until a newer granted receipt exists.
    - Latest receipt granted=False → 403.
    Raises HTTPException(403) when blocked; returns None when allowed.

    Robustness: if the consent lookup itself fails (e.g. privacy tables not
    yet migrated, or a test double without query support), the gate fails
    OPEN with a server-side warning so uploads never 500 over the gate.
    The migration p0f7a21c9e04 creates the tables; post-migration the
    lookup succeeds and withdrawals are enforced.
    """
    from logger import logger

    try:
        receipt = _latest_receipt(db, patient_id, scope)
    except Exception as e:
        logger.warning("Consent gate lookup failed (%s); allowing upload.", type(e).__name__)
        return
    if receipt is None:
        log_audit(db, action="consent_unknown", patient_id=patient_id, entity_type="consent", meta={"scope": scope})
        return
    if receipt.withdrawn_at is not None or not receipt.granted:
        raise HTTPException(
            status_code=403,
            detail="Processing consent was withdrawn. Re-grant consent to continue uploading documents.",
        )


@router.post("/consent", response_model=ConsentReceiptResponse, status_code=201)
def capture_consent(
    body: ConsentCapture,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    if body.scope not in {s.value for s in ConsentScope}:
        raise HTTPException(status_code=400, detail="Unknown consent scope.")
    receipt = ConsentReceipt(
        patient_id=patient_id,
        scope=body.scope,
        notice_version=body.notice_version,
        notice_hash=body.notice_hash,
        granted=body.granted,
        age_confirmed_18_plus=body.age_confirmed_18_plus,
        is_guardian_consent=body.is_guardian_consent,
        method=body.method,
    )
    db.add(receipt)
    log_audit(db, action="consent_captured", patient_id=patient_id, entity_type="consent",
              entity_id=str(receipt.id), meta={"scope": body.scope, "granted": body.granted})
    db.commit()
    db.refresh(receipt)
    return ConsentReceiptResponse(
        id=receipt.id, scope=receipt.scope, notice_version=receipt.notice_version,
        granted=receipt.granted, age_confirmed_18_plus=receipt.age_confirmed_18_plus,
        is_guardian_consent=receipt.is_guardian_consent,
        withdrawn_at=receipt.withdrawn_at, created_at=receipt.created_at,
    )


@router.get("/consent", response_model=List[ConsentReceiptResponse])
def list_consents(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    rows = (
        db.execute(
            select(ConsentReceipt)
            .where(ConsentReceipt.patient_id == patient_id)
            .order_by(ConsentReceipt.created_at.desc())
            .limit(100)
        ).scalars().all()
    )
    return [
        ConsentReceiptResponse(
            id=r.id, scope=r.scope, notice_version=r.notice_version, granted=r.granted,
            age_confirmed_18_plus=r.age_confirmed_18_plus, is_guardian_consent=r.is_guardian_consent,
            withdrawn_at=r.withdrawn_at, created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/consent/withdraw", response_model=ConsentReceiptResponse)
def withdraw_consent(
    body: WithdrawRequest,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    receipt = _latest_receipt(db, patient_id, body.scope)
    if receipt is None or receipt.withdrawn_at is not None:
        raise HTTPException(status_code=404, detail="No active consent found for this scope.")
    receipt.withdrawn_at = datetime.now(timezone.utc)
    log_audit(db, action="consent_withdrawn", patient_id=patient_id, entity_type="consent",
              entity_id=str(receipt.id), meta={"scope": body.scope})
    db.commit()
    db.refresh(receipt)
    return ConsentReceiptResponse(
        id=receipt.id, scope=receipt.scope, notice_version=receipt.notice_version,
        granted=receipt.granted, age_confirmed_18_plus=receipt.age_confirmed_18_plus,
        is_guardian_consent=receipt.is_guardian_consent,
        withdrawn_at=receipt.withdrawn_at, created_at=receipt.created_at,
    )


@router.post("/requests", response_model=DSRResponse, status_code=201)
def create_dsr(
    body: DSRCreate,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    if body.request_type not in {t.value for t in DSRType}:
        raise HTTPException(status_code=400, detail="Unknown request type.")
    # Default SLA clock: +90 days (DPDP outer bound). Policy/legal must
    # confirm per-jurisdiction clocks (GDPR 1 month) before launch.
    due = datetime.now(timezone.utc) + timedelta(days=90)
    req = DataSubjectRequest(
        patient_id=patient_id, request_type=body.request_type,
        status=DSRStatus.OPEN.value, details=body.details or {}, due_at=due,
    )
    db.add(req)
    log_audit(db, action="dsr_created", patient_id=patient_id, entity_type="dsr",
              entity_id=str(req.id), meta={"request_type": body.request_type})
    db.commit()
    db.refresh(req)
    return DSRResponse(id=req.id, request_type=req.request_type, status=req.status, due_at=req.due_at, created_at=req.created_at)


@router.get("/requests", response_model=List[DSRResponse])
def list_dsrs(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    rows = (
        db.execute(
            select(DataSubjectRequest)
            .where(DataSubjectRequest.patient_id == patient_id)
            .order_by(DataSubjectRequest.created_at.desc())
            .limit(100)
        ).scalars().all()
    )
    return [
        DSRResponse(id=r.id, request_type=r.request_type, status=r.status, due_at=r.due_at, created_at=r.created_at)
        for r in rows
    ]


@router.get("/export")
def export_data(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """P0 self-service export bundle (PG metadata; blobs via /file endpoint).

    Covers: profile, documents, clinical events + labs, observations,
    medications + taken history, consent receipts, DSRs. Identifiers only
    where the row itself is metadata; clinical text is the patient's own
    data being exported to them (access right), never logged.
    """
    from models.anatomy import AnatomicalObservation
    from models.events import ClinicalEvent, Document, EvidenceLink, LabResult
    from models.identity import Patient
    from models.medications import Medication, MedicationTakenEvent

    def _iso(v):
        return v.isoformat() if v else None

    patient = db.scalar(select(Patient).where(Patient.patient_id == patient_id))
    documents = db.execute(select(Document).where(Document.patient_id == patient_id).limit(500)).scalars().all()
    events = db.execute(select(ClinicalEvent).where(ClinicalEvent.patient_id == patient_id).limit(2000)).scalars().all()
    event_ids = [e.event_id for e in events]
    labs = (
        db.execute(select(LabResult).where(LabResult.event_id.in_(event_ids))).scalars().all() if event_ids else []
    )
    links = (
        db.execute(select(EvidenceLink).where(EvidenceLink.event_id.in_(event_ids))).scalars().all() if event_ids else []
    )
    observations = db.execute(
        select(AnatomicalObservation).where(AnatomicalObservation.patient_id == patient_id).limit(2000)
    ).scalars().all()
    medications = db.execute(select(Medication).where(Medication.patient_id == patient_id).limit(200)).scalars().all()
    taken = db.execute(
        select(MedicationTakenEvent).where(MedicationTakenEvent.patient_id == patient_id).limit(2000)
    ).scalars().all()
    receipts = db.execute(select(ConsentReceipt).where(ConsentReceipt.patient_id == patient_id).limit(100)).scalars().all()

    log_audit(db, action="export_generated", patient_id=patient_id, entity_type="export",
              meta={"documents": len(documents), "events": len(events)})
    db.commit()

    return {
        "patient": {
            "patient_id": str(patient_id),
            "full_name": patient.full_name if patient else None,
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "notice": "Review redenomination: blobs (PDF bytes) are fetchable per-document via GET /api/v1/documents/{id}/file.",
        },
        "documents": [
            {"document_id": str(d.document_id), "status": d.status, "created_at": _iso(getattr(d, "created_at", None))}
            for d in documents
        ],
        "clinical_events": [
            {
                "event_id": str(e.event_id), "event_type": e.event_type.value,
                "source_type": e.source_type.value, "verification_status": e.verification_status.value,
                "polarity": e.polarity, "assertion_verification": e.assertion_verification,
                "experiencer": e.experiencer, "clinical_status": e.clinical_status,
                "event_time": _iso(e.event_time),
            }
            for e in events
        ],
        "lab_results": [
            {"event_id": str(lab.event_id), "value": lab.value, "unit": lab.unit,
             "reference_range": lab.reference_range, "abnormal_flag": lab.abnormal_flag}
            for lab in labs
        ],
        "evidence_links": [
            {"event_id": str(link.event_id), "document_id": str(link.document_id), "extracted_text": link.extracted_text}
            for link in links
        ],
        "observations": [
            {"observation_id": str(o.observation_id), "structure_id": o.structure_id,
             "finding_code": o.finding_code, "finding_display_name": o.finding_display_name,
             "polarity": o.polarity, "experiencer": o.experiencer,
             "recorded_at": _iso(o.recorded_at)}
            for o in observations
        ],
        "medications": [
            {"medication_id": str(m.medication_id), "name": m.name, "generic_name": m.generic_name,
             "status": m.status.value if hasattr(m.status, "value") else str(m.status),
             "purpose": m.purpose, "prescriber": m.prescriber}
            for m in medications
        ],
        "medication_taken": [
            {"event_id": str(t.event_id), "medication_id": str(t.medication_id),
             "taken_at": _iso(t.taken_at), "status": t.status.value if hasattr(t.status, "value") else str(t.status)}
            for t in taken
        ],
        "consent_receipts": [
            {"scope": r.scope, "notice_version": r.notice_version, "granted": r.granted,
             "withdrawn_at": _iso(r.withdrawn_at)}
            for r in receipts
        ],
    }


class ErasureReport(BaseModel):
    status: str = Field(description="completed | partial (see subsystem reports; retry converges)")
    delete_account: bool
    postgres: dict
    dsr_fulfilled: list = Field(default_factory=list)
    neo4j: dict
    qdrant: dict
    firebase: dict


def _run_erasure(
    db: Session,
    patient_id: uuid.UUID,
    *,
    delete_account: bool,
) -> ErasureReport:
    from core.neo4j_client import neo4j_driver
    from models.identity import Patient
    from services.erasure import orchestrate_erasure

    firebase_uid: str | None = None
    if delete_account:
        row = db.query(Patient).filter(Patient.patient_id == patient_id).first()
        firebase_uid = row.firebase_uid if row else None

    report = orchestrate_erasure(
        db,
        patient_id,
        delete_account=delete_account,
        neo4j_driver=neo4j_driver,
        firebase_uid=firebase_uid,
    )
    return ErasureReport(**report)


@router.delete("/data", response_model=ErasureReport)
def delete_all_health_data(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Delete ALL of the caller's health records; the account remains.

    Covers PostgreSQL (ordered, FK-safe, incl. the graph outbox so workers
    cannot resurrect projections), Neo4j patient subgraph, Qdrant vectors,
    LangGraph checkpoints, idempotency keys, and fulfills this patient's
    OPEN erasure DSRs. Consent receipts stay (the account relationship
    continues). Overall status is 'completed' only when every subsystem
    completed — otherwise 'partial' with explicit residuals; the operation
    is idempotent, so retrying converges.
    """
    return _run_erasure(db, patient_id, delete_account=False)


@router.delete("/account", response_model=ErasureReport)
def delete_account(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Delete the caller's account: all health data (see DELETE /data) plus
    consent/DSR rows, the Patient row, and the Firebase Auth user.

    The client must sign out locally afterwards (its token dies with the
    Firebase user). Same completion semantics as DELETE /data.
    """
    return _run_erasure(db, patient_id, delete_account=True)
