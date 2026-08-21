from uuid import UUID
from core.celery_app import celery_app
from core.db import SessionLocal
from models.events import Document
from logger import logger

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