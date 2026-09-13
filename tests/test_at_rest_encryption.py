"""
Phase 0 / Increment 6 — at-rest document encryption regression tests
(pure, CI-safe; no DB/Redis).

Covers the AES-256-GCM authenticated at-rest encryption in
core/at_rest_crypto.py and its wiring in storage/save_doc.py:
  - writes are encrypted: stored bytes are an envelope, not plaintext
  - reads decrypt transparently (round-trip integrity)
  - unique nonce per write (indistinguishable ciphertexts for equal content)
  - AAD binding to document_id (row/ciphertext swap is detected)
  - legacy plaintext rows and empty payloads pass through unchanged
  - explicit DOC_ENCRYPTION_KEY keying + derived-key fallback + rotation
    detection (decryption failure surfaces clearly)
"""

import io

import pytest
from fastapi import UploadFile

from core.at_rest_crypto import (
    AtRestDecryptionError,
    _MAGIC,
    decode_key,
    decrypt_bytes,
    encrypt_bytes,
    new_key_display,
    _aad_for,
)
from storage.save_doc import StorageService


def _upload(filename, content, content_type="application/pdf"):
    return UploadFile(
        file=io.BytesIO(content),
        filename=filename,
        headers={"content-type": content_type},
    )


class FakeSession:
    """Minimal stand-in for the SQLAlchemy Session used by StorageService."""

    def __init__(self):
        self._rows = {}

    def add(self, obj):
        self._rows[obj.document_id] = obj

    def add_all(self, objs):
        for obj in objs:
            self.add(obj)

    def get(self, model, document_id):
        return self._rows.get(document_id)

    def delete(self, obj):
        self._rows.pop(obj.document_id, None)


UPLOAD = b"%PDF-1.4 health record 0x01 0x02 0x03" * 8


def _save_and_return_blob(db):
    doc_id = db.fake_document_id
    StorageService.save_document(
        db=db,
        file=_upload("rec.pdf", UPLOAD, "application/pdf"),
        patient_id="0f12a5c8-0000-0000-0000-000000000001",
        document_id=doc_id,
    )
    return db._rows[doc_id]


@pytest.fixture
def db():
    fake = FakeSession()
    return fake


class TestWriteEncrypts:
    def test_stored_bytes_are_an_encryption_envelope(self, db):
        db.fake_document_id = "a1111111-1111-1111-1111-111111111111"
        blob = _save_and_return_blob(db)
        assert blob.data != UPLOAD
        assert blob.data.startswith(_MAGIC)

    def test_equal_content_encrypts_to_different_ciphertext(self):
        db_a = FakeSession()
        db_a.fake_document_id = "a2222222-2222-2222-2222-222222222222"
        db_b = FakeSession()
        db_b.fake_document_id = "b2222222-2222-2222-2222-222222222222"
        assert _save_and_return_blob(db_a).data != _save_and_return_blob(db_b).data


class TestReadDecrypts:
    def test_round_trip_returns_original_bytes(self, db):
        db.fake_document_id = "a3333333-3333-3333-3333-333333333333"
        _save_and_return_blob(db)
        assert StorageService.get_document_bytes(db, db.fake_document_id) == UPLOAD

    def test_missing_blob_raises(self, db):
        with pytest.raises(FileNotFoundError):
            StorageService.get_document_bytes(
                db, "deadbeef-dead-dead-dead-deadbeefdead"
            )

    def test_download_uses_decrypting_read(self, monkeypatch):
        # The public download endpoint must fetch through StorageService
        # (single decrypting read) rather than raw `blob.data`.
        import inspect

        from app.api.v1.documents import get_document_file

        source = inspect.getsource(get_document_file)
        assert "StorageService.get_document_bytes" in source
        assert "content=blob.data" not in source


class TestKeyManagement:
    def test_explicit_key_round_trip(self, monkeypatch):
        from core.config import settings

        monkeypatch.setattr(settings, "DOC_ENCRYPTION_KEY", new_key_display().decode())
        sealed = encrypt_bytes(UPLOAD, aad=_aad_for("x"))
        assert sealed.startswith(_MAGIC)
        assert decrypt_bytes(sealed, aad=_aad_for("x")) == UPLOAD

    def test_derived_key_default_round_trip(self, monkeypatch):
        from core.config import settings

        monkeypatch.setattr(settings, "DOC_ENCRYPTION_KEY", "")
        monkeypatch.setattr(settings, "secret_key", "stable-test-secret-key")
        sealed = encrypt_bytes(UPLOAD, aad=_aad_for("x"))
        assert decrypt_bytes(sealed, aad=_aad_for("x")) == UPLOAD

    def test_key_rotation_is_detected_not_silent(self, monkeypatch):
        from core.config import settings

        monkeypatch.setattr(settings, "DOC_ENCRYPTION_KEY", new_key_display().decode())
        sealed = encrypt_bytes(UPLOAD, aad=_aad_for("x"))
        monkeypatch.setattr(settings, "DOC_ENCRYPTION_KEY", new_key_display().decode())
        with pytest.raises(AtRestDecryptionError):
            decrypt_bytes(sealed, aad=_aad_for("x"))

    def test_aad_binds_ciphertext_to_document(self, monkeypatch):
        from core.config import settings

        monkeypatch.setattr(settings, "DOC_ENCRYPTION_KEY", new_key_display().decode())
        sealed = encrypt_bytes(UPLOAD, aad=_aad_for("doc-a"))
        with pytest.raises(AtRestDecryptionError):
            decrypt_bytes(sealed, aad=_aad_for("doc-b"))

    def test_decode_key_validates_shape(self):
        assert decode_key("") is None
        assert decode_key("   ") is None
        assert len(decode_key(new_key_display().decode())) == 32
        with pytest.raises(ValueError):
            decode_key("not-base64!!")
        import os

        with pytest.raises(ValueError):
            decode_key("_" * 44)  # decodes to 33 bytes
        with pytest.raises(ValueError):
            decode_key("AA==")  # decodes to 1 byte


class TestLegacyPassthrough:
    def test_plaintext_rows_pass_through_unchanged(self):
        plain = b"%PDF-1.4 legacy row"
        assert decrypt_bytes(plain, aad=_aad_for("x")) == plain

    def test_empty_payloads_are_untouched(self):
        assert encrypt_bytes(b"", aad=_aad_for("x")) == b""
        assert decrypt_bytes(b"", aad=_aad_for("x")) == b""

    def test_implausibly_short_envelope_is_treated_as_legacy(self):
        short = _MAGIC + b"x"  # prefix but no real nonce+tag
        assert decrypt_bytes(short, aad=_aad_for("x")) == short