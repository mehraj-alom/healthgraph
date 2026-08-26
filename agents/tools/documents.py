"""Tool to list patient's uploaded documents."""
import uuid
from typing import List, Dict
from langchain_core.tools import tool
from langchain_core.runnables import RunnableConfig
from sqlalchemy import select
from sqlalchemy.orm import Session

from core.db import SessionLocal
from models.events import Document

@tool
async def get_patient_documents(config: RunnableConfig = None) -> List[Dict]:
    """
    Lists all medical documents uploaded by the patient.
    Returns document IDs, status, and metadata for use with other tools.
    """
    patient_id_str = config.get("configurable", {}).get("session_patient_id") if config else None
    if not patient_id_str:
        raise ValueError("CRITICAL: session_patient_id missing from execution config.")
        
    patient_id = uuid.UUID(str(patient_id_str))
    
    db: Session = SessionLocal()
    try:
        stmt = select(Document).where(Document.patient_id == patient_id).order_by(Document.created_at.desc())
        docs = db.execute(stmt).scalars().all()
        
        return [
            {
                "document_id": str(doc.document_id),
                "status": doc.status,
                "created_at": doc.created_at.isoformat() if doc.created_at else None,
                "file_hash": doc.file_hash[:16] + "..." if doc.file_hash else None,
            }
            for doc in docs
        ]
    finally:
        db.close()