"""
Phase 0 / Increment 5 — upload hardening regression tests (pure, CI-safe).

Covers the document-upload protection added to app/api/v1/documents.py and
storage/save_doc.py: extension/content-type/magic-byte validation and the
20 MiB size cap. No database, Redis, or external services required.
"""

import hashlib
import io

import pytest
from fastapi import HTTPException, UploadFile

from app.api.v1.documents import _validate_upload
from storage.save_doc import (
    DEFAULT_MAX_UPLOAD_BYTES,
    DocumentTooLargeError,
    StorageService,
)


def _upload(filename, content, content_type=None):
    headers = {"content-type": content_type} if content_type is not None else {}
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers=headers,
    )


class TestUploadValidation:
    def test_accepts_valid_pdf(self):
        _validate_upload(_upload("rec.pdf", b"%PDF-1.4 fake pdf", "application/pdf"))

    def test_accepts_valid_png(self):
        _validate_upload(_upload("scan.png", b"\x89PNG\r\n\x1a\npayload", "image/png"))

    def test_accepts_valid_jpeg(self):
        _validate_upload(_upload("photo.jpg", b"\xff\xd8\xff\xe0jpeg", "image/jpeg"))

    def test_accepts_valid_jpeg_extension_with_missing_content_type(self):
        # Mobile clients sometimes omit content-type; magic bytes still carry
        # the validation.
        _validate_upload(_upload("mri.jpg", b"\xff\xd8\xff\xdbdata", None))

    def test_rejects_unsupported_extension(self):
        with pytest.raises(HTTPException) as exc:
            _validate_upload(
                _upload("notes.docx", b"PK....", "application/vnd.openxmlformats")
            )
        assert exc.value.status_code == 400

    def test_rejects_content_type_mismatch(self):
        with pytest.raises(HTTPException) as exc:
            _validate_upload(_upload("fake.pdf", b"%PDF-", "text/html"))
        assert exc.value.status_code == 400

    def test_rejects_magic_byte_mismatch(self):
        # Extension says PDF but bytes are a PNG.
        with pytest.raises(HTTPException) as exc:
            _validate_upload(_upload("fake.pdf", b"\x89PNG\r\n\x1a\n", "application/pdf"))
        assert exc.value.status_code == 400

    def test_rejects_plain_text_disguised_as_pdf(self):
        with pytest.raises(HTTPException) as exc:
            _validate_upload(_upload("notes.pdf", b"just some text, not a pdf", "application/pdf"))
        assert exc.value.status_code == 400


class TestUploadSizeCap:
    def test_oversize_hash_rejected_before_hashing_completes(self):
        big = io.BytesIO(b"\0" * (DEFAULT_MAX_UPLOAD_BYTES + 1))
        with pytest.raises(DocumentTooLargeError):
            StorageService.calculate_file_hash(big)

    def test_hash_matches_standard_sha256_within_cap(self):
        data = b"%PDF-1.4 " + b"x" * 1000
        upload = _upload("rec.pdf", data, "application/pdf")
        digest = StorageService.calculate_file_hash(upload.file)
        assert digest == hashlib.sha256(data).hexdigest()

    def test_save_document_rejects_oversize(self):
        upload = _upload(
            "big.pdf",
            b"\0" * (DEFAULT_MAX_UPLOAD_BYTES + 1),
            "application/pdf",
        )
        with pytest.raises(DocumentTooLargeError):
            StorageService.save_document(
                db=None, file=upload, patient_id=None, document_id=None
            )

    def test_boundary_exactly_at_cap_is_allowed(self):
        data = b"\0" * DEFAULT_MAX_UPLOAD_BYTES
        upload = _upload("big.pdf", data, "application/pdf")
        # Exactly the cap passes (only strictly-larger is rejected).
        digest = StorageService.calculate_file_hash(upload.file)
        assert digest is not None