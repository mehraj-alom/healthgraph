import uuid
from fastapi import APIRouter, Depends, HTTPException,UploadFile, File ]
from sqlalchemy.orm import Session
from sqlalchemy import select
from core.db import get_db
from core.security import get_current_user
from core.identity import Patient, Provider, Facility
from models.events import Document
from storage.save_doc import StorageService
from schemas.events import DocumentResponse
import os
from logger import auth_logger as logger
from workers.ingestion_tasks import process_document_pipeline


router = APIRouter(api_version="1", prefix="/v1/documents", tags=["documents"])


@router.post("/upload", response_model=DocumentResponse, status_code=status.HTTP_201_CREATED)
def upload_document(
    file: File(UploadFile),
    db: Session = Depends(get_db),
    current_patient_uid: str = Depends(get_current_user)
):
    # Resolve Firebase UID to internal PostgreSQL Patient record
    patient = db.scalar(select(Patient).where(Patient.firebase_uid == current_patient_uid))
    if not patient:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
        
    # 2. Validate file type format extensions
    allowed_extensions = {".pdf", ".png", ".jpg", ".jpeg"}
    file_ext = os.path.splitext(file.filename)[1].lower()
    if file_ext not in allowed_extensions:
        raise HTTPException(status_code=400, detail="Unsupported file format.")

    # Securely calculate hash using chunked streaming
    file_hash = StorageService.calculate_file_hash(file.file)

    # Check for patient-isolated duplicate tracking
    existing_doc = db.scalar(
        select(Document).where(
            Document.file_hash == file_hash, 
            Document.patient_id == patient.patient_id
        )
    )
    if existing_doc:
        # Return early to guarantee strict idempotency
        return existing_doc

    # Initialize tracking IDs and save file to physical disk layout
    document_id = uuid.uuid4()
    try:
        storage_url = StorageService.save_document(file, patient.patient_id, document_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"File persistence failed: {str(e)}")

    #Commit the metadata record to the authority database
    new_document = Document(
        document_id=document_id,
        patient_id=patient.patient_id,
        file_hash=file_hash,
        storage_url=storage_url,
        status="UPLOADED"
    )
    db.add(new_document)
    db.commit()
    db.refresh(new_document)

    # Trigger the ingestion pipeline asynchronously
    process_document_pipeline.delay(str(new_document.document_id))
    
    return new_document