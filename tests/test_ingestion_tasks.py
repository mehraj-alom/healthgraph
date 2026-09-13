"""
Phase 0 / Increment 7 — ingestion pipeline retry regression guard.

The document-processing task previously declared max_retries=3 but its guard
(`if not document or document.status != "UPLOADED": return`) no-oped every
post-failure retry: after the first run commits status=PROCESSING (or the
except handler commits status=FAILED) the retry invocation returns without
re-running the pipeline, so a transient OCR/extraction failure permanently
stalled the document at PROCESSING/FAILED while Celery reported "success".

Stabilization decision (I7): disable the broken retry so the pipeline fails
explicitly instead of silently no-op'ing. The document is marked FAILED and
the task re-raises the original error for Celery observability. Re-upload
re-enqueues.

These tests guard the retry wiring itself; the status-gate + FAILED handling
are exercised via the app tests elsewhere.
"""

from workers.ingestion_tasks import process_document_pipeline


class TestIngestionTaskRetryWiring:
    """The task must never silently swallow a failure via no-op retries."""

    def test_retries_disabled(self):
        # If someone re-enables retries without fixing the status-gate the
        # retries will no-op (silent data-vacuum). Fail loudly instead.
        assert process_document_pipeline.max_retries == 0

    def test_task_name_preserved(self):
        # The upload endpoint enqueues via this exact name; keep it intact.
        assert process_document_pipeline.name == "ingestion_tasks.process_document"