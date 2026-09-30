import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from core.config import settings
from core.db import get_db
from core.rate_limiter import RateLimiter
from core.security_events import log_security_event
from app.api.dependencies import get_authenticated_patient_id
from models.events import Document
from models.identity import Patient
from storage.save_doc import StorageService, DocumentTooLargeError
from schemas.events import DocumentResponse
from workers.ingestion_tasks import process_document_pipeline
from logger import logger


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])

_ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}
_ALLOWED_MAGIC_BYTES = {
    ".pdf": (b"%PDF-",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
}
_ALLOWED_CONTENT_TYPES = {"application/pdf", "image/png", "image/jpeg"}
_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MiB — matches storage/save_doc.py

# Upload feeds the expensive OCR/extraction pipeline. 5/min burst + 10/hour
# per patient. fail_open only in LOCAL so a dev box without Redis works;
# preview/production fail closed (503) so abuse protection never silently
# disables.
_upload_limiter = RateLimiter()


def _validate_upload(file: UploadFile) -> None:
    """Validate extension, content-type, and magic bytes. 400 on mismatch."""
    filename = file.filename or ""
    file_ext = os.path.splitext(filename)[1].lower()
    if file_ext not in _ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    content_type = (file.content_type or "").lower()
    if content_type and content_type not in _ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported content type.")

    # Magic-byte sniff (first 8 bytes; seek back afterwards). Prevents a
    # renamed/abused file from entering the OCR pipeline.
    head = file.file.read(8)
    file.file.seek(0)
    if not any(head.startswith(magic) for magic in _ALLOWED_MAGIC_BYTES[file_ext]):
        raise HTTPException(
            status_code=400, detail="File content does not match its extension."
        )


@router.get("", response_model=List[DocumentResponse])
def list_documents(
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """List all documents for the authenticated patient, newest first."""
    from typing import List
    from sqlalchemy import desc

    docs = (
        db.query(Document)
        .filter(Document.patient_id == patient_id)
        .order_by(desc(Document.created_at))
        .limit(50)
        .all()
    )
    return docs


@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Get a single document by ID, verifying patient ownership."""
    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.get("/{document_id}/extraction")
def get_document_extraction(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Return the raw extraction data for a document (for review/detail)."""
    from sqlalchemy import select
    from models.events import RawExtractionData

    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    raw = db.scalars(
        select(RawExtractionData).where(RawExtractionData.document_id == document_id)
    ).first()

    if not raw:
        return {"document_id": str(document_id), "status": doc.status, "extraction": None}

    return {
        "document_id": str(document_id),
        "status": doc.status,
        "gateway_json": raw.gateway_json,
        "raw_ade_json": raw.raw_ade_json,
        "markdown_text": raw.markdown_text,
        "extraction": raw.extraction,
        "deidentified_markdown": raw.deidentified_markdown,
    }


@router.post("/{document_id}/prescription-meds")
def extract_prescription_medicines(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Per-medicine rows for a scanned prescription, aligned to the Add
    Medication form (name/dose/route/frequency/times/... + confidence +
    needs_review per row) so review is confirm-or-tweak, not retyping.

    Runs the dedicated prescription schema over the stored scan text —
    never the generic lab-report schema. Computed on demand; nothing is
    persisted. 422 while the scan text is not ready yet.
    """
    from models.events import RawExtractionData
    from services.ocr.prescription_extract import extract_prescription_meds

    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    raw = db.scalars(
        select(RawExtractionData).where(RawExtractionData.document_id == document_id)
    ).first()
    if not raw or not (raw.markdown_text or "").strip():
        raise HTTPException(status_code=422, detail="Scan text is not ready yet. Try again shortly.")

    gateway = raw.gateway_json if isinstance(raw.gateway_json, dict) else {}
    doc_type = str(gateway.get("document_type") or "").upper()
    if doc_type and doc_type != "PRESCRIPTION":
        raise HTTPException(status_code=400, detail="This document is not a prescription.")

    try:
        result = extract_prescription_meds(raw.markdown_text)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"document_id": str(document_id), **result}


@router.post("/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    fail_open = settings.APP_ENV == "local"
    # P0 consent-withdrawal enforcement for NEW processing: an explicit
    # withdrawal blocks uploads; no receipt yet allows (grandfathering) but
    # is audit-logged as consent_unknown for policy follow-up.
    from app.api.v1.privacy import assert_processing_allowed
    assert_processing_allowed(db, patient_id)
    # Cost-abuse protection for the extraction pipeline (fail-closed in
    # preview/production; fail-open in local).
    _upload_limiter.check(
        str(patient_id), "upload_burst", limit=5,
        window_seconds=60, fail_open=fail_open,
    )
    _upload_limiter.check(
        str(patient_id), "upload_hourly", limit=10,
        window_seconds=3600, fail_open=fail_open,
    )

    try:
        _validate_upload(file)
    except HTTPException as exc:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/documents/upload",
            status=exc.status_code,
            patient_id=str(patient_id),
            message=exc.detail,
        )
        raise

    # Content-Length fast-reject (cheap, before any reads).
    content_length = file.size
    if content_length is not None and content_length > _MAX_UPLOAD_BYTES:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/documents/upload",
            status=400,
            patient_id=str(patient_id),
            message="upload exceeds size cap",
        )
        raise HTTPException(status_code=400, detail="File exceeds the 20 MB size limit.")

    try:
        file_hash = StorageService.calculate_file_hash(
            file.file, max_size_bytes=_MAX_UPLOAD_BYTES
        )
    except DocumentTooLargeError:
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/documents/upload",
            status=400,
            patient_id=str(patient_id),
            message="upload exceeds size cap",
        )
        raise HTTPException(status_code=400, detail="File exceeds the 20 MB size limit.")

    existing_doc = db.scalar(
        select(Document).where(
            Document.file_hash == file_hash,
            Document.patient_id == patient_id,
            # P7: a DELETED row must not shadow a re-upload of the same file.
            Document.status != "DELETED",
        )
    )
    if existing_doc:
        return existing_doc

    document_id = uuid.uuid4()

    new_document = Document(
        document_id=document_id,
        patient_id=patient_id,
        file_hash=file_hash,
        storage_url="",  # set below after the durable blob is queued
        status="UPLOADED",
    )
    db.add(new_document)
    # Persist the documents row first so the document_blobs FK holds.
    try:
        db.flush()
        storage_url = StorageService.save_document(
            db, file, patient_id, document_id,
            max_size_bytes=_MAX_UPLOAD_BYTES,
        )
        new_document.storage_url = storage_url
        db.commit()
    except DocumentTooLargeError:
        db.rollback()
        log_security_event(
            "upload_rejected",
            endpoint="/api/v1/documents/upload",
            status=400,
            patient_id=str(patient_id),
            message="upload exceeds size cap",
        )
        raise HTTPException(status_code=400, detail="File exceeds the 20 MB size limit.")
    except IntegrityError:
        # P7: concurrent same-hash upload (or legacy global-unique row)
        # races the dedup check above. Roll back and return the winner
        # instead of 500ing — upload stays idempotent under races.
        db.rollback()
        winner = db.scalar(
            select(Document).where(
                Document.file_hash == file_hash,
                Document.patient_id == patient_id,
                Document.status != "DELETED",
            )
        )
        if winner is not None:
            log_security_event(
                "upload_dedup_race",
                endpoint="/api/v1/documents/upload",
                status=200,
                patient_id=str(patient_id),
                message="concurrent duplicate upload coalesced",
            )
            return winner
        logger.error(
            "Document persistence failed for patient=%s type=%s",
            patient_id, "IntegrityError",
        )
        raise HTTPException(status_code=500, detail="Unable to persist the document.")
    except Exception as e:
        db.rollback()
        # Never leak internal/DB details to the client.
        logger.error(
            "Document persistence failed for patient=%s type=%s",
            patient_id, type(e).__name__,
        )
        raise HTTPException(status_code=500, detail="Unable to persist the document.")

    db.refresh(new_document)

    try:
        process_document_pipeline.delay(str(new_document.document_id))
    except Exception as e:
        # Broker (Redis) unavailable. The document row + blob are already
        # durably committed as UPLOADED, so the upload itself succeeded and
        # is viewable. Signal 503 (not 500); a recovery sweep can re-enqueue.
        log_security_event(
            "processing_enqueue_failed",
            endpoint="/api/v1/documents/upload",
            status=503,
            patient_id=str(patient_id),
            message="document persisted but enqueue failed",
        )
        # P15 / D3: category only. Broker exception text can embed the
        # connection URL (which carries credentials).
        logger.warning(
            "Enqueue failed (broker unavailable?) for document=%s (%s).",
            new_document.document_id, type(e).__name__,
        )
        raise HTTPException(status_code=503, detail="Document saved; processing queue unavailable. Please retry.")

    return new_document


@router.delete("/{document_id}", status_code=status.HTTP_200_OK)
def delete_document(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Delete a document and its derivatives (P0 data-lifecycle).

    Cascade (patient-scoped, this session):
    - document blob bytes (PG) + storage_url cleared, status=DELETED
      (row kept for referential integrity: medications.source_document_id)
    - raw extraction rows (gateway JSON, markdown, de-identified text)
    - evidence links (exact quotes) for events derived from this document
    - verbatim source text derived from this document is cleared (P15 / D1):
      clinical_events.source_snippet for events sourced from it, and
      anatomical_observations.source_snippet. Without this the hydrator's
      `(evidence.extracted_text) or event.source_snippet` fallback kept
      emitting the deleted document's exact text as a citation quote.
    - observation.document_id links nulled (observation history preserved;
      full observation erasure is a P1 erasure-orchestrator item)
    - Qdrant vectors for this document (best-effort)
    - Neo4j :Document node + its edges via DETACH DELETE (best-effort;
      observations/timeline nodes stay — they are patient history)

    ClinicalEvents derived from the document are preserved (patient history);
    their evidence quotes are removed. This split is intentional in P0 and
    must be confirmed by policy/legal for erasure-request fulfillment.
    """
    from models.anatomy import AnatomicalObservation
    from models.events import (
        ClinicalEvent,
        DocumentBlob,
        EvidenceLink,
        RawExtractionData,
    )
    from models.privacy import log_audit

    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    # 1. PG derivatives.
    #
    # P15 / D1: resolve the events sourced from this document FIRST. Once the
    # EvidenceLink rows are deleted there is no join left to find them, and
    # ClinicalEvent.source_snippet would keep serving the deleted document's
    # verbatim text through the hydrator's fallback. EvidenceLink.event_id is
    # unique, so each event has at most one source document.
    sourced_event_ids = [
        row[0]
        for row in db.query(EvidenceLink.event_id)
        .filter(EvidenceLink.document_id == document_id)
        .all()
    ]

    db.query(DocumentBlob).filter(DocumentBlob.document_id == document_id).delete()
    db.query(RawExtractionData).filter(RawExtractionData.document_id == document_id).delete()
    db.query(EvidenceLink).filter(EvidenceLink.document_id == document_id).delete()

    # P15 / D1: remove verbatim source text that came from this document.
    # The clinical events/observations themselves are patient history and stay
    # (documented lifecycle contract); only the document-derived evidence text
    # is erased. patient_id is re-asserted so a cross-patient row can never be
    # touched even if an id were somehow shared.
    if sourced_event_ids:
        db.query(ClinicalEvent).filter(
            ClinicalEvent.patient_id == patient_id,
            ClinicalEvent.event_id.in_(sourced_event_ids),
        ).update({ClinicalEvent.source_snippet: None}, synchronize_session=False)

    db.query(AnatomicalObservation).filter(
        AnatomicalObservation.document_id == document_id,
        AnatomicalObservation.patient_id == patient_id,
    ).update(
        {
            AnatomicalObservation.source_snippet: None,
            AnatomicalObservation.document_id: None,
        },
        synchronize_session=False,
    )
    doc.storage_url = ""
    doc.status = "DELETED"
    log_audit(db, action="document_deleted", patient_id=patient_id, entity_type="document",
              entity_id=str(document_id), meta={"cascade": "blob+extraction+evidence+qdrant+graph"})
    db.commit()

    # 2. Qdrant vectors (best-effort; never fail the request over the index).
    try:
        from qdrant_client.http import models as _qm
        from services.vectorization.qdrant_client import vector_db

        vector_db.client.delete(
            collection_name=vector_db.collection_name,
            points_selector=_qm.FilterSelector(
                filter=_qm.Filter(
                    must=[
                        _qm.FieldCondition(key="patient_id", match=_qm.MatchValue(value=str(patient_id))),
                        _qm.FieldCondition(key="document_id", match=_qm.MatchValue(value=str(document_id))),
                    ]
                )
            ),
        )
    except Exception as e:
        logger.warning("Qdrant cascade delete skipped for document=%s: %s", document_id, type(e).__name__)

    # 3. Neo4j :Document node (best-effort; ownership re-checked in Cypher).
    # P5: the guard covers EVERY DOCUMENTED_IN/SOURCE_DOCUMENT producer
    # path (observation, timeline event, condition, medication request,
    # measurement) — the previous guard only matched observation links,
    # leaving orphan :Document nodes for condition/request/measurement docs.
    try:
        from core.neo4j_client import neo4j_driver

        with neo4j_driver.session() as session:
            session.run(
                "MATCH (d:Document {id: $document_id}) "
                "WHERE EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(:Observation)-[:SOURCE_DOCUMENT]->(d) } "
                "OR EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_OBSERVATION]->(:Observation)-[:DOCUMENTED_IN]->(d) } "
                "OR EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_TIMELINE_EVENT]->(:TimelineEvent)-[:DOCUMENTED_IN]->(d) } "
                "OR EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_CONDITION]->(:ConditionOccurrence)-[:DOCUMENTED_IN]->(d) } "
                "OR EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_MEDICATION_REQUEST]->(:MedicationRequest)-[:DOCUMENTED_IN]->(d) } "
                "OR EXISTS { MATCH (p:Patient {id: $patient_id})-[:HAS_MEASUREMENT]->(:Measurement)-[:DOCUMENTED_IN]->(d) } "
                "DETACH DELETE d",
                document_id=str(document_id),
                patient_id=str(patient_id),
            )
            # A document left the graph: invalidate cached graph payloads.
            from core.neo4j_client import bump_patient_graph_rev
            with neo4j_driver.session() as rev_session:
                rev_session.execute_write(bump_patient_graph_rev, str(patient_id))
    except Exception as e:
        logger.warning("Neo4j cascade delete skipped for document=%s: %s", document_id, type(e).__name__)

    return {"document_id": str(document_id), "status": "DELETED"}


@router.get("/{document_id}/file")
def get_document_file(
    document_id: uuid.UUID,
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Stream the original uploaded document bytes to the authenticated patient.

    The binary is served from durable PostgreSQL storage; the container
    filesystem is never trusted to hold documents.
    """
    from models.events import DocumentBlob
    from storage.save_doc import StorageService

    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    blob = db.get(DocumentBlob, document_id)
    if blob is None:
        raise HTTPException(status_code=404, detail="Document file not found.")

    # Fetch through StorageService so the single, authenticated at-rest
    # decryption path (AES-256-GCM, AAD bound to document_id) owns this read.
    filename = blob.filename or f"{document_id}"
    return Response(
        content=StorageService.get_document_bytes(db, document_id),
        media_type=blob.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )