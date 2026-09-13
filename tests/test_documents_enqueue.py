"""
Phase 0 / Increment 7 — enqueue-failure regression tests (pure, CI-safe).

When the Celery broker (Redis) is unavailable, `process_document_pipeline.delay()`
raised out of `upload_document`, turning a successful, durably-persisted upload
into a confusing HTTP 500 with an orphaned UPLOADED document. I7 fix: catch the
enqueue failure, log a processing_enqueue_failed security event, and return 503
"Document saved; processing queue unavailable" so the client knows the bytes are
safe and processing will be retried/deferred.

No database, Redis, or external services required — module dependencies are
stubbed at the boundary.
"""

import io

import pytest
from fastapi import HTTPException, UploadFile

import app.api.v1.documents as documents_module


def _upload(filename="rec.pdf", content=b"%PDF-1.4 fake pdf", content_type="application/pdf"):
    headers = {} if content_type is None else {"content-type": content_type}
    return UploadFile(file=io.BytesIO(content), filename=filename, headers=headers)


class _FakeLimiter:
    def check(self, *args, **kwargs):
        return None


class _FakeStorage:
    @staticmethod
    def calculate_file_hash(file_obj, max_size_bytes=None):
        return "fake-hash-abc123"

    @staticmethod
    def save_document(db, file, patient_id, document_id, max_size_bytes=None):
        return f"/docs/{document_id}"


class _FailingTask:
    def delay(self, *args, **kwargs):
        raise RuntimeError("Connection refused: broker down")


class _FakeDB:
    def __init__(self):
        self.added = []
        self.flushed = self.committed = self.rolled_back = False

    def scalar(self, stmt):
        return None  # no existing doc with this hash

    def add(self, obj):
        self.added.append(obj)

    def flush(self):
        self.flushed = True

    def refresh(self, obj):
        pass

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True


@pytest.fixture
def stub_dependencies(monkeypatch):
    events = []
    monkeypatch.setattr(documents_module, "_upload_limiter", _FakeLimiter())
    monkeypatch.setattr(documents_module, "StorageService", _FakeStorage)
    monkeypatch.setattr(documents_module, "process_document_pipeline", _FailingTask())
    monkeypatch.setattr(
        documents_module,
        "log_security_event",
        lambda *args, **kw: events.append({**kw, "event": args[0] if args else None}),
    )
    return events


class TestEnqueueFailureReturns503:
    def test_broker_down_returns_503_not_500(self, stub_dependencies):
        fake_db = _FakeDB()
        with pytest.raises(HTTPException) as exc:
            documents_module.upload_document(
                file=_upload(),
                db=fake_db,
                patient_id="11111111-2222-3333-4444-555555555555",
            )
        assert exc.value.status_code == 503
        assert "processing queue unavailable" in str(exc.value.detail).lower()

    def test_enqueue_failure_logs_security_event(self, stub_dependencies):
        with pytest.raises(HTTPException):
            documents_module.upload_document(
                file=_upload(),
                db=_FakeDB(),
                patient_id="11111111-2222-3333-4444-555555555555",
            )
        assert any(
            ev.get("event") == "processing_enqueue_failed" and ev.get("status") == 503
            for ev in stub_dependencies
        )

    def test_document_was_durably_committed_before_503(self, stub_dependencies):
        fake_db = _FakeDB()
        with pytest.raises(HTTPException):
            documents_module.upload_document(
                file=_upload(),
                db=fake_db,
                patient_id="11111111-2222-3333-4444-555555555555",
            )
        # The row + blob were persisted first; only enqueueing failed.
        assert fake_db.added and fake_db.flushed and fake_db.committed
        assert not fake_db.rolled_back