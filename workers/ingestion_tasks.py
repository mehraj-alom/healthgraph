from uuid import UUID
from core.celery_app import celery_app
from core.db import SessionLocal
from models.events import Document
from models.identity import Patient  # Ensure patients table is registered in worker metadata.
from logger import logger
from core.log_collector import pipeline_logs
import asyncio
from services.ocr.gateway import OCRGateway
from services.ocr.extraction_schema import EXTRACTION_SCHEMA
from services.ocr.extraction import Extraction
from models.events import RawExtractionData
from services.ocr.extraction_mapper import ExtractionMapper
from services.deidentification.deidentifier import DeIdentificationService
from services.vectorization.vector_indexing import VectorIndexingService as VectorIndexer
from services.anatomy.body_state_service import record_anatomical_observation
from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file
import os


def _log(level: str, msg: str, doc_id: str = None):
    """Send to both standard logger and the in-memory log collector."""
    getattr(logger, level.lower(), logger.info)(msg)
    pipeline_logs.append(level, msg, doc_id)

@celery_app.task(name="ingestion_tasks.process_document", bind=True, max_retries=3, default_retry_delay=30)
def process_document_pipeline(self, document_id_str: str):
    db = SessionLocal()
    document_id = None
    try:
        document_id = UUID(document_id_str)
        document = db.query(Document).filter(Document.document_id == document_id).first()
        
        if not document or document.status != "UPLOADED":
            _log("warning", f"Document {document_id_str} not found or already processed.", document_id_str)
            return

        _log("info", f"Processing document with ID {document_id}...", document_id_str)
        document.status = "PROCESSING"
        db.commit()

        #sTriage Phase
        _log("info", f"Starting OCR triage for Document {document_id_str}...", document_id_str)
        ocr_gateway = OCRGateway()
        ocr_gateway_result = ocr_gateway.classify_document(document.storage_url)
        _log("info", f"Triage result: type={ocr_gateway_result.get('document_type')}, medical={ocr_gateway_result.get('is_medical')}", document_id_str)
        
        # Unload immediately to free up RAM before API calls
        ocr_gateway.unload_model()
        
        # FIXED LOGIC: Fails ONLY if it's explicitly junk, unknown, or non-medical
        # Accept if is_medical=true OR if a valid medical document type was identified
        medical_types = {"LAB_REPORT", "PRESCRIPTION", "DISCHARGE", "IMAGING"}
        if (not ocr_gateway_result.get("is_medical") 
            and ocr_gateway_result.get("document_type") not in medical_types):
            _log("warning", f"Document {document_id_str} rejected by triage.", document_id_str)
            document.status = "FAILED_TRIAGE" # Use a specific status so you know why it failed
            db.commit()
            return

        #LandingAI Extraction Phase
        _log("info", f"Starting LandingAI ADE for Document {document_id_str}...", document_id_str)
        extraction_result = Extraction.parse_and_extract(document.storage_url, schema=EXTRACTION_SCHEMA)
        
        # Database Persistence
        ocr_record = RawExtractionData(
            document_id=document.document_id,
            gateway_json=ocr_gateway_result,
            raw_ade_json=extraction_result["structured_json"],
            markdown_text=extraction_result["markdown"],
            extraction=extraction_result["extraction"]
        )
        db.add(ocr_record)
        document.status = "EXTRACTED" 
        db.commit()
        db.refresh(ocr_record)

        # DEIDENTIFICATION Phase
        logger.info(f"Starting De-identification for Document {document_id_str}...")
        SECRET_KEY = os.getenv("secret_key", "")
        secret_bytes = SECRET_KEY.encode() if isinstance(SECRET_KEY, str) else SECRET_KEY
        deidentifier = DeIdentificationService(secret_bytes)
        deidentified_markdown = deidentifier.deidentify(ocr_record.markdown_text)
        if not deidentified_markdown.validation_passed:
            _log("warning", f"De-identification validation flagged PII for Document {document_id_str}: {deidentified_markdown.validation_errors}. Continuing in dev mode.", document_id_str)
        safe_markdown = deidentified_markdown.text
        ocr_record.deidentified_markdown = safe_markdown
        db.commit()

        # QDRANT VECTOR INDEXING
        _log("info", f"Starting Qdrant Vector Indexing for Document {document_id_str}...", document_id_str)
        try :
            indexer = VectorIndexer()
            asyncio.run(indexer.index_markdown_file(document.patient_id, document.document_id, safe_markdown))
        except Exception as e:
            _log("warning", f"Vector Indexing skipped for Document {document_id_str}: {str(e)}", document_id_str)


       # Timeline Mapping 
        _log("info", f"Starting Timeline Mapping for Document {document_id_str}...", document_id_str)
        events_created, observations_created = ExtractionMapper.map_to_timeline(db, document.document_id)

        # Record anatomical observations to populate 3D body state and Neo4j outbox
        for obs in observations_created:
            try:
                record_anatomical_observation(db, obs, auto_commit=False)
                _log("info", f"Recorded anatomical observation {obs.observation_id} for document {document_id_str}.", document_id_str)
            except Exception as e:
                _log("error", f"Failed to record anatomical observation {obs.observation_id}: {str(e)}", document_id_str)

        document.status = "COMPLETED"
        db.commit()
        _log("info", f"Successfully completed pipeline for Document {document_id_str}", document_id_str)

    except Exception as e:
        db.rollback()
        if document_id is not None:
            try:
                document = db.query(Document).filter(Document.document_id == document_id).first()
                if document:
                    document.status = "FAILED"
                    db.commit()
            except Exception as mark_failed_error:
                logger.error(
                    f"Failed to mark document {document_id_str} as FAILED after pipeline error: {mark_failed_error}"
                )
            
        _log("error", f"Pipeline failed for Document {document_id_str}: {str(e)}", document_id_str)
        raise self.retry(exc=e, countdown=2 ** self.request.retries)
        
    finally:
        db.close()