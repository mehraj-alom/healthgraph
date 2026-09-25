"""Pipeline log streaming endpoint for dev console."""
import asyncio
import json
import time
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dependencies import get_authenticated_patient_id
from core.db import get_db
from core.log_collector import LOG_DOC_KEY, LOG_DOC_UNSCOPED, pipeline_logs
from models.events import Document

router = APIRouter(prefix="/api/v1/system/logs", tags=["logs"])


def _patient_document_ids(db: Session, patient_id: uuid.UUID) -> set[str]:
    """IDs of live documents the patient owns (for scoping operational logs).

    DELETED documents are excluded: their logs must stop being visible.
    """
    rows = db.execute(
        select(Document.document_id)
        .where(
            Document.patient_id == patient_id,
            Document.status != "DELETED",
        )
        .limit(2000)
    ).all()
    return {str(r[0]) for r in rows}


def _entry_document_id(entry: dict) -> str | None:
    """Document id a log entry is scoped to, or None when unscoped.

    P15 / D4: this reads the key to_dict() actually emits (LOG_DOC_KEY). The
    previous filter used a "document_id" key that never existed, so both log
    endpoints matched nothing. Entries without an owning document always come
    back None, which is never a member of the patient's owned set — unscoped
    entries stay invisible to every patient.
    """
    value = entry.get(LOG_DOC_KEY)
    if not value or value == LOG_DOC_UNSCOPED:
        return None
    return value


@router.get("/recent")
def get_recent_logs(
    n: int = Query(100, ge=1, le=500),
    document_id: str = Query(None),
    _patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """Return recent pipeline logs scoped to the authenticated patient.

    Requires a valid Firebase token so operational logs are not exposed
    to unauthenticated clients. Entries are keyed by document_id, so
    scoping means: an explicit document_id must belong to the patient,
    otherwise only entries for the patient's own documents are returned.
    """
    owned = _patient_document_ids(db, _patient_id)
    if document_id:
        if document_id not in owned:
            raise HTTPException(status_code=404, detail="Document not found.")
        return {"logs": pipeline_logs.recent(n=n, document_id=document_id)}
    entries = pipeline_logs.recent(n=n)
    return {"logs": [e for e in entries if _entry_document_id(e) in owned]}


@router.get("/stream")
async def stream_logs(
    document_id: str = Query(None),
    _patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
    db: Session = Depends(get_db),
):
    """SSE stream of live pipeline logs. Polls Redis every 1s.

    Requires a valid Firebase token so operational logs are not exposed
    to unauthenticated clients. Same patient scoping as /recent: entries
    for other patients' documents are never streamed.
    """
    owned = _patient_document_ids(db, _patient_id)
    if document_id and document_id not in owned:
        raise HTTPException(status_code=404, detail="Document not found.")

    async def event_generator():
        # P15: dedup state is per-connection (a module-global set leaks
        # entries across patients/streams) and ownership is re-scoped every
        # tick, so a document deleted after connect stops streaming and a
        # newly added one starts. An explicitly requested document that
        # leaves scope ends the stream; the client reconnects into a 404.
        seen_keys: set[str] = set()
        # Send initial connection message
        yield f"data: {json.dumps({'time': time.strftime('%H:%M:%S'), 'level': 'INFO', 'doc': '-', 'msg': 'Log stream connected'})}\n\n"
        try:
            while True:
                owned = _patient_document_ids(db, _patient_id)
                if document_id and document_id not in owned:
                    break
                logs = pipeline_logs.recent(n=200, document_id=document_id)
                for entry in logs:
                    if _entry_document_id(entry) not in owned:
                        continue
                    # Scope the key to this stream: identical time|msg on
                    # another patient's stream must not suppress this one.
                    key = f"{_patient_id}|{_entry_document_id(entry)}|{entry['time']}|{entry['msg']}"
                    if key not in seen_keys:
                        seen_keys.add(key)
                        data = json.dumps(entry)
                        yield f"data: {data}\n\n"
                # Keep per-stream state bounded
                if len(seen_keys) > 1000:
                    seen_keys.clear()
                await asyncio.sleep(1)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
