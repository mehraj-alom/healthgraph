import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
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


@router.post("/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    fail_open = settings.APP_ENV == "local"
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
        logger.warning(
            "Enqueue failed (broker unavailable?) for document=%s type=%s: %s",
            new_document.document_id, type(e).__name__, e,
        )
        raise HTTPException(status_code=503, detail="Document saved; processing queue unavailable. Please retry.")

    return new_document


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