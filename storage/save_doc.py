import hashlib
import os
import tempfile
from typing import BinaryIO
from uuid import UUID

from fastapi import UploadFile
from sqlalchemy.orm import Session
from logger import logger

from core.at_rest_crypto import decrypt_bytes, encrypt_bytes, _aad_for
from core.config import Settings
from models.events import DocumentBlob

# Workspace used ONLY to materialize a document temporarily while OCR /
# extraction runs. Nothing durable may live here: on Voroa (and other
# container PaaS platforms) this filesystem is wiped on every deploy and is
# not shared between the web service and the Celery worker. Durable bytes
# live in the document_blobs table (managed PostgreSQL).
STORAGE_DIR = Settings().STORAGE_DIR


class DocumentTooLargeError(Exception):
    """Raised when an uploaded document exceeds the size cap."""


# Document uploads feed the OCR/extraction pipeline. 20 MiB gives production
# headroom for multi-page PDFs and high-resolution imaging while bounding
# memory, storage, and extraction cost.
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024


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
    def calculate_file_hash(
        file: BinaryIO,
        max_size_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ) -> str:
        """Calculate the SHA256 hash of a file, rejecting oversized files.

        Reads chunked (64 KiB) so memory stays bounded even for a hostile,
        mislabeled "file". Raises DocumentTooLargeError once the size cap is
        crossed instead of hashing unbounded bytes.
        """
        sha256 = hashlib.sha256()
        file.seek(0)  # Ensure at the start of the file
        size = 0
        while chunk := file.read(65536):  # 65536 bytes at a time
            size += len(chunk)
            if size > max_size_bytes:
                raise DocumentTooLargeError(
                    f"Upload exceeds the {max_size_bytes} byte size limit"
                )
            sha256.update(chunk)
        file.seek(0)  # Reset file pointer to the start after reading
        return sha256.hexdigest()

    @staticmethod
    def save_document(
        db: Session,
        file: UploadFile,
        patient_id: UUID,
        document_id: UUID,
        max_size_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
    ) -> str:
        """Persist an uploaded document's bytes to PostgreSQL.

        The caller is responsible for committing the transaction (the owning
        ``documents`` row must already be flushed so the FK holds). Returns the
        storage_url (authenticated download path) to store on the Document row.

        Enforces a hard size cap by reading at most ``max_size_bytes + 1``
        bytes, so an oversized upload never loads unbounded data into memory.
        """
        # Read from the underlying spooled file. On modern Starlette,
        # UploadFile.seek() is async, so operate on file.file (the raw buffer).
        file.file.seek(0)
        data = file.file.read(max_size_bytes + 1)

        if len(data) > max_size_bytes:
            raise DocumentTooLargeError(
                f"Upload exceeds the {max_size_bytes} byte size limit"
            )

        extension = os.path.splitext(file.filename or "")[-1]
        filename = f"{patient_id}_{document_id}{extension}"
        content_type = file.content_type

        # Encrypt at rest (AES-256-GCM, authenticated; AAD bound to the
        # document_id so ciphertext cannot be swapped between rows). Read
        # paths decrypt transparently — legacy plaintext rows still work.
        data = encrypt_bytes(data, aad=_aad_for(document_id))

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
        """Fetch a document's stored bytes from PostgreSQL, decrypted."""
        blob = db.get(DocumentBlob, document_id)
        if blob is None:
            raise FileNotFoundError(
                f"Document bytes not found for document_id={document_id}"
            )
        return decrypt_bytes(blob.data, aad=_aad_for(document_id))

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