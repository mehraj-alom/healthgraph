from uuid import UUID
from core.celery_app import celery_app
from core.db import SessionLocal
from models.events import Document
from models.deidentification import DeIdentificationResult, DeIdentificationEntity
from logger import logger
import asyncio
from services.ocr.gateway import OCRGateway
from services.ocr.extraction_schema import EXTRACTION_SCHEMA
from services.ocr.extraction import Extraction
from models.events import RawExtractionData
from services.ocr.extraction_mapper import ExtractionMapper
from services.deidentification.deidentifier import DeIdentificationService
from services.vectorization.vector_indexing import VectorIndexingService as VectorIndexer
from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file
import os

@celery_app.task(name="ingestion_tasks.process_document", bind=True, max_retries=3, default_retry_delay=30)
def process_document_pipeline(self, document_id_str: str):
    db = SessionLocal()
    try:
        document_id = UUID(document_id_str)
        document = db.query(Document).filter(Document.document_id == document_id).first()
        
        if not document or document.status != "UPLOADED":
            logger.warning(f"Document {document_id_str} not found or already processed.")
            return

        logger.info(f"Processing document with ID {document_id}...")
        document.status = "PROCESSING"
        db.commit()

        #sTriage Phase
        logger.info(f"Starting OCR triage for Document {document_id_str}...")
        ocr_gateway = OCRGateway()
        ocr_gateway_result = ocr_gateway.classify_document(document.storage_url)
        
        # Unload immediately to free up RAM before API calls
        ocr_gateway.unload_model()
        
        # FIXED LOGIC: Fails ONLY if it's explicitly junk, unknown, or non-medical
        if not ocr_gateway_result.get("is_medical") or ocr_gateway_result.get("document_type") in ["JUNK", "UNKNOWN"]:
            logger.warning(f"Document {document_id_str} rejected by triage.")
            document.status = "FAILED_TRIAGE" # Use a specific status so you know why it failed
            db.commit()
            return

        #LandingAI Extraction Phase
        logger.info(f"Starting LandingAI ADE for Document {document_id_str}...")
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
        SECRET_KEY = os.getenv("secret_key")
        deidentifier = DeIdentificationService(SECRET_KEY)
        deidentified_markdown = deidentifier.deidentify(ocr_record.markdown_text)
        if not deidentified_markdown.validation_passed:
            logger.warning(f"De-identification failed for Document {document_id_str}.")
            document.status = "FAILED_DEIDENTIFICATION"
            db.commit()
            return
        safe_markdown = deidentified_markdown.text
        ocr_record.deidentified_markdown = safe_markdown
        db.commit()

        # QDRANT VECTOR INDEXING
        logger.info(f"Starting Qdrant Vector Indexing for Document {document_id_str}...")
        try :
            indexer = VectorIndexer()
            asyncio.run(indexer.index_markdown_file(document.patient_id, document.document_id, safe_markdown))
        except Exception as e:
            logger.error(f"Vector Indexing failed for Document {document_id_str}: {str(e)}")
            document.status = "FAILED_INDEXING"
            db.commit()
            return


       # Timeline Mapping 
        logger.info(f"Starting Timeline Mapping for Document {document_id_str}...")
        events_created = ExtractionMapper.map_to_timeline(db, document.document_id)
         # TODO: ********************
        document.status = "COMPLETED"
        db.commit()
        logger.info(f"Successfully completed pipeline for Document {document_id_str}")

    except Exception as e:
        db.rollback()
        document = db.query(Document).filter(Document.document_id == document_id).first()
        if document:
            document.status = "FAILED"
            db.commit()
            
        logger.error(f"Pipeline failed for Document {document_id_str}: {str(e)}")
        raise self.retry(exc=e, countdown=2 ** self.request.retries)
        
    finally:
        db.close()