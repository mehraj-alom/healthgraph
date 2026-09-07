import hashlib
import os
import tempfile
from typing import BinaryIO
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy.orm import Session
from logger import logger

from core.config import Settings
from models.events import DocumentBlob

# Workspace used ONLY to materialize a document temporarily while OCR /
# extraction runs. Nothing durable may live here: on Voroa (and other
# container PaaS platforms) this filesystem is wiped on every deploy and is
# not shared between the web service and the Celery worker. Durable bytes
# live in the document_blobs table (managed PostgreSQL).
STORAGE_DIR = Settings().STORAGE_DIR


class StorageService:
    """Durable document storage.

    Binaries are stored in the ``document_blobs`` PostgreSQL table (the same
    durable, backed-up managed database), NOT on the container filesystem.
    This guarantees health documents survive deploys/restarts and are readable
    by both the API and the Celery worker even though they run in separate
    containers with no shared disk.

    ``storage_url`` stored on the ``documents`` row is the authenticated
    download endpoint path ``/api/v1/documents/{document_id}/file``.
    """

    @staticmethod
    def calculate_file_hash(file: BinaryIO) -> str:
        """Calculate the SHA256 hash of a file."""
        sha256 = hashlib.sha256()
        file.seek(0)  # Ensure at the start of the file
        while chunk := file.read(65536):  # 65536 bytes at a time
            sha256.update(chunk)
        file.seek(0)  # Reset file pointer to the start after reading
        return sha256.hexdigest()

    @staticmethod
    def save_document(
        db: Session,
        file: UploadFile,
        patient_id: UUID,
        document_id: UUID,
    ) -> str:
        """Persist an uploaded document's bytes to PostgreSQL.

        The caller is responsible for committing the transaction (the owning
        ``documents`` row must already be flushed so the FK holds). Returns the
        storage_url (authenticated download path) to store on the Document row.
        """
        # Read from the underlying spooled file. On modern Starlette,
        # UploadFile.seek() is async, so operate on file.file (the raw buffer).
        file.file.seek(0)
        data = file.file.read()

        extension = os.path.splitext(file.filename or "")[-1]
        filename = f"{patient_id}_{document_id}{extension}"
        content_type = file.content_type

        blob = DocumentBlob(
            document_id=document_id,
            filename=filename,
            content_type=content_type,
            data=data,
        )
        db.add(blob)

        logger.info(
            "[Storage] Queued document %s in PostgreSQL (%d bytes).",
            document_id,
            len(data),
        )

        return f"/api/v1/documents/{document_id}/file"

    @staticmethod
    def get_document_bytes(db: Session, document_id: UUID) -> bytes:
        """Fetch a document's stored bytes from PostgreSQL."""
        blob = db.get(DocumentBlob, document_id)
        if blob is None:
            raise FileNotFoundError(
                f"Document bytes not found for document_id={document_id}"
            )
        return blob.data

    @staticmethod
    def materialize_document(db: Session, document_id: UUID) -> str:
        """Write a document's stored bytes to a TEMPORARY file for OCR.

        OCR and extraction (pdf2image, PIL, LandingAI ADE) require a real file
        path. This returns a temp file path the caller MUST delete in a finally
        block. Nothing durable should ever be relied on at this path.
        """
        data = StorageService.get_document_bytes(db, document_id)

        blob_suffix = ".bin"
        # Best-effort filename/suffix from the stored blob so pdf2image/PIL can
        # decide how to decode it.
        blob_meta = db.get(DocumentBlob, document_id)
        if blob_meta is not None and blob_meta.filename:
            _, ext = os.path.splitext(blob_meta.filename)
            if ext:
                blob_suffix = ext

        prefix = f"medgraph_{document_id}_"
        try:
            os.makedirs(STORAGE_DIR, exist_ok=True)
            fd, path = tempfile.mkstemp(prefix=prefix, suffix=blob_suffix, dir=STORAGE_DIR)
        except OSError:
            # Fall back to the system temp dir if the configured scratch dir
            # is unwritable (e.g. read-only container filesystem).
            fd, path = tempfile.mkstemp(prefix=prefix, suffix=blob_suffix)
        try:
            with os.fdopen(fd, "wb") as buffer:
                buffer.write(data)
        except Exception:
            try:
                os.unlink(path)
            except OSError:
                pass
            raise

        return path

    @staticmethod
    def delete_document_blob(db: Session, document_id: UUID) -> None:
        """Delete a document's stored bytes (used with document deletion)."""
        blob = db.get(DocumentBlob, document_id)
        if blob is not None:
            db.delete(blob)
            db.commit()