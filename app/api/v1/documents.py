import os
import uuid
from typing import List

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import get_db
from app.api.dependencies import get_authenticated_patient_id
from models.events import Document
from models.identity import Patient
from storage.save_doc import StorageService
from schemas.events import DocumentResponse
from workers.ingestion_tasks import process_document_pipeline


router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


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
    allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    file_hash = StorageService.calculate_file_hash(file.file)

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
        storage_url = StorageService.save_document(db, file, patient_id, document_id)
        new_document.storage_url = storage_url
        db.commit()
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"File persistence failed: {str(e)}")

    db.refresh(new_document)

    process_document_pipeline.delay(str(new_document.document_id))

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

    doc = db.query(Document).filter(
        Document.document_id == document_id,
        Document.patient_id == patient_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    blob = db.get(DocumentBlob, document_id)
    if blob is None:
        raise HTTPException(status_code=404, detail="Document file not found.")

    filename = blob.filename or f"{document_id}"
    return Response(
        content=blob.data,
        media_type=blob.content_type or "application/octet-stream",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )