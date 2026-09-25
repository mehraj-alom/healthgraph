from uuid import UUID
from datetime import datetime, timedelta, timezone
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
from storage.save_doc import StorageService
from dotenv import load_dotenv
load_dotenv()  # Load environment variables from .env file
import os


def _log(level: str, msg: str, doc_id: str = None):
    """Send to both standard logger and the in-memory log collector."""
    getattr(logger, level.lower(), logger.info)(msg)
    pipeline_logs.append(level, msg, doc_id)


def _known_person_names(db, patient_id, extraction: dict) -> list[str]:
    """Collect patient-specific known identifiers for de-id (P8.1).

    Sources: PG patients.full_name + the extraction's own person
    strings (patient/requester/authorisation names). Only names — never
    clinical text — so matching can never damage terminology. Values
    are never logged; the list is capped downstream.
    """
    names: list[str] = []
    try:
        patient = db.query(Patient).filter(Patient.patient_id == patient_id).first()
        if patient is not None and getattr(patient, "full_name", None):
            names.append(patient.full_name)
    except Exception:
        pass
    doc = (extraction or {}).get("document", {}) if isinstance(extraction, dict) else {}
    patient_block = doc.get("patient") or {}
    for key in ("name",):
        if patient_block.get(key):
            names.append(patient_block[key])
    requester = doc.get("requester") or {}
    for key in ("name",):
        if requester.get(key):
            names.append(requester[key])
    auth = doc.get("authorisation") or {}
    for key in ("reported_by", "verified_by"):
        if auth.get(key):
            names.append(auth[key])
    return [n for n in names if isinstance(n, str) and n.strip()]

def _document_deleted_or_gone(db, document_id) -> bool:
    """True when the document row is missing or marked DELETED.

    Re-read from the database (never trust the held ORM object): a delete
    or erasure landing mid-pipeline must stop further writes. Expired
    session state is refreshed by the query itself.
    """
    try:
        row = (
            db.query(Document.status)
            .filter(Document.document_id == document_id)
            .first()
        )
    except Exception:
        # On read failure, keep going: the phase commits below will surface
        # real DB problems, and a transient error must not fake a delete.
        return False
    if row is None:
        return True
    return row[0] == "DELETED"


@celery_app.task(name="ingestion_tasks.process_document", bind=True, max_retries=0)
def process_document_pipeline(self, document_id_str: str):
    db = SessionLocal()
    document_id = None
    temp_doc_path = None
    try:
        document_id = UUID(document_id_str)
        document = db.query(Document).filter(Document.document_id == document_id).first()
        
        if not document or document.status != "UPLOADED":
            _log("warning", f"Document {document_id_str} not found or already processed.", document_id_str)
            return

        _log("info", f"Processing document with ID {document_id}...", document_id_str)
        document.status = "PROCESSING"
        db.commit()

        # Materialize the durable document bytes (stored in PostgreSQL) to a
        # TEMPORARY file so OCR/extraction (LandingAI ADE) can
        # read them. The container filesystem is ephemeral and not shared
        # between the web service and this worker, so the bytes must come from
        # the database, never from document.storage_url on disk.
        temp_doc_path = StorageService.materialize_document(db, document.document_id)
        # P15 / D5: never log filesystem paths (security_events.py policy).
        _log("info", f"[Worker] Materialized document {document_id_str} to a temporary file.", document_id_str)

        # Triage Phase
        _log("info", f"Starting OCR triage for Document {document_id_str}...", document_id_str)
        ocr_gateway = OCRGateway()
        ocr_gateway_result = ocr_gateway.classify_document(temp_doc_path)
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
        extraction_result = Extraction.parse_and_extract(temp_doc_path, schema=EXTRACTION_SCHEMA)
        
        # Database Persistence
        # P0 pipeline versioning: record which models produced this
        # extraction so results stay reproducible across model upgrades.
        # P15: re-check the delete gate — a delete landing after task entry
        # must not be undone by the writes below.
        if _document_deleted_or_gone(db, document.document_id):
            db.rollback()
            _log("warning", f"Document {document_id_str} deleted mid-pipeline; aborting before persistence.", document_id_str)
            return
        ocr_record = RawExtractionData(
            document_id=document.document_id,
            gateway_json=ocr_gateway_result,
            raw_ade_json=extraction_result["structured_json"],
            markdown_text=extraction_result["markdown"],
            extraction=extraction_result["extraction"],
            extraction_model=os.getenv("ADE_EXTRACTION_MODEL", "dpt-3-pro-latest")
            + "+"
            + os.getenv("ADE_CLASSIFY_MODEL", "classify-latest"),
            extraction_prompt_hash=os.getenv("EXTRACTION_PROMPT_HASH"),
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
        # P8.1: patient-specific known identifiers. The NER analyzer
        # misses non-Western/all-caps names in tables (P8-live), so feed
        # the extraction's own person strings + the PG full_name as an
        # explicit deny-list. Values are never logged.
        known_names = _known_person_names(
            db, document.patient_id, ocr_record.extraction or {}
        )
        deidentified_markdown = deidentifier.deidentify(
            ocr_record.markdown_text, extra_names=known_names
        )
        if not deidentified_markdown.validation_passed:
            _log("warning", f"De-identification validation flagged PII for Document {document_id_str}: {deidentified_markdown.validation_errors}. Continuing in dev mode.", document_id_str)
        safe_markdown = deidentified_markdown.text
        ocr_record.deidentified_markdown = safe_markdown
        db.commit()

        # QDRANT VECTOR INDEXING
        _log("info", f"Starting Qdrant Vector Indexing for Document {document_id_str}...", document_id_str)
        if _document_deleted_or_gone(db, document.document_id):
            db.rollback()
            _log("warning", f"Document {document_id_str} deleted mid-pipeline; skipping vector indexing.", document_id_str)
            return
        try :
            indexer = VectorIndexer()
            asyncio.run(indexer.index_markdown_file(document.patient_id, document.document_id, safe_markdown))
        except Exception as e:
            # P15 / D3: failure category only — provider/exception text can
            # echo document content.
            _log("warning", f"Vector Indexing skipped for Document {document_id_str} ({type(e).__name__}).", document_id_str)


       # Timeline Mapping 
        _log("info", f"Starting Timeline Mapping for Document {document_id_str}...", document_id_str)
        if _document_deleted_or_gone(db, document.document_id):
            db.rollback()
            _log("warning", f"Document {document_id_str} deleted mid-pipeline; skipping timeline mapping.", document_id_str)
            return
        events_created, observations_created = ExtractionMapper.map_to_timeline(db, document.document_id)

        # Record anatomical observations to populate 3D body state and Neo4j outbox
        for obs in observations_created:
            try:
                record_anatomical_observation(db, obs, auto_commit=False)
                _log("info", f"Recorded anatomical observation {obs.observation_id} for document {document_id_str}.", document_id_str)
            except Exception as e:
                _log("error", f"Failed to record anatomical observation {obs.observation_id} ({type(e).__name__}).", document_id_str)

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
                    "Failed to mark document %s as FAILED after pipeline error (%s).",
                    document_id_str,
                    type(mark_failed_error).__name__,
                )
            
        _log("error", f"Pipeline failed for Document {document_id_str} ({type(e).__name__}).", document_id_str)
        raise
        
    finally:
        if temp_doc_path and os.path.exists(temp_doc_path):
            try:
                os.unlink(temp_doc_path)
                _log("info", f"[Worker] Cleaned up temporary file for document {document_id_str}.", document_id_str)
            except Exception as e:
                # P15 / D5: no path, no exception text.
                logger.warning("Temporary file cleanup failed (%s).", type(e).__name__)
        db.close()


# P7: recovery sweeper for crash-stalled documents. The pipeline task runs
# with max_retries=0 and the UPLOADED status gate blocks re-entry, so a
# worker crash between status commits stalls the document forever.
# Documents stuck in PROCESSING/EXTRACTED longer than the lease are reset
# to UPLOADED for reprocessing (extraction is deterministic; downstream
# projections are MERGE-idempotent). FAILED/FAILED_TRIAGE/DELETED rows are
# never touched.
STUCK_DOCUMENT_LEASE_MINUTES = 15


@celery_app.task(name="ingestion_tasks.sweep_stuck_documents")
def sweep_stuck_documents():
    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=STUCK_DOCUMENT_LEASE_MINUTES)
        stuck = (
            db.query(Document)
            .filter(
                Document.status.in_(["PROCESSING", "EXTRACTED"]),
                Document.updated_at < cutoff,
            )
            .all()
        )
        for document in stuck:
            document.status = "UPLOADED"
            _log("warning", f"Releasing stuck document {document.document_id} to UPLOADED.", str(document.document_id))
        db.commit()
        return {"released": len(stuck)}
    finally:
        db.close()