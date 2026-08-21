from uuid import UUID
from core.celery_app import celery_app
from core.db import SessionLocal
from models.events import Document
from logger import logger
from services.ocr.gateway import OCRGateway
from services.ocr.extraction_schema import EXTRACTION_SCHEMA
from services.ocr.extraction import Extraction
from models.events import RawExtractionData

@celery_app.task(name="ingestion_tasks.process_document", bind=True,max_retries=3, default_retry_delay=30)
def process_document_pipeline(self, document_id_str: str):
    """
    Celery task to process a document through the ingestion pipeline.

    Args:
        document_id_str (str): The UUID of the document to be processed, as a string.

    Raises:
        Exception: If any error occurs during processing, the task will retry up to 3 times.
    """
    db = SessionLocal()
    try:
        #Convert the string representation of the UUID to a UUID object
        document_id = UUID(document_id_str)
        # Retrieve the document from the database
        document = db.query(Document).filter(Document.document_id == document_id).first()
        if not document or document.status != "UPLOADED":
            logger.warning(f"Document {document_id_str} not found or already processed.")
            return

        # Process the document (this is a placeholder for actual processing logic)
        logger.info(f"Processing document with ID {document_id}...")
        document.status = "PROCESSING"
        db.commit()

        """TODO: Procesing pipeline to update"""
        logger.info(f"Starting OCR processing for Document {document_id_str}...")
        ocr_gateway = OCRGateway()
        ocr_gateway_result = ocr_gateway.classify_document(document.storage_url)
        if not ocr_gateway_result["is_medical"] or not ocr_gateway_result["document_type"]=="JUNK" or ocr_gateway_result["document_type"]=="UNKNOWN":
            logger.warning(f"Document {document_id_str} is not a valid medical document or type is unknown.")
            document.status = "FAILED"
            db.commit()

        #unload the model to free up memory
        ocr_gateway.unload_model()
        extraction_result = Extraction.parse_and_extract(document.storage_url, schema=EXTRACTION_SCHEMA)
        ocr_record = RawExtractionData(
            document_id=document.document_id,
            gateway_json=ocr_gateway_result,
            raw_ade_json=extraction_result["structured_json"],
            markdown_text=extraction_result["markdown"]
        )
        db.add(ocr_record)
        db.commit()
        db.refresh(ocr_record)
        # TODO: Landingai ADE extraction
        
        document.status = "COMPLETED"
        db.commit()
        logger.info(f"Successfully completed pipeline for Document {document_id_str}")

    except Exception as e:
        db.rollback()
        # Mark as failed in DB, but let Celery retry mechanism handle transient errors
        document = db.query(Document).filter(Document.document_id == document_id).first()
        if document:
            document.status = "FAILED"
            db.commit()
            
        logger.error(f"Pipeline failed for Document {document_id_str}: {str(e)}")
        raise self.retry(exc=e, countdown=2 ** self.request.retries)
    finally:
        db.close()