"""Pipeline log streaming endpoint for dev console."""
import asyncio
import json
import time
import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse

from app.api.dependencies import get_authenticated_patient_id
from core.log_collector import pipeline_logs

router = APIRouter(prefix="/api/v1/system/logs", tags=["logs"])


@router.get("/recent")
def get_recent_logs(
    n: int = Query(100, ge=1, le=500),
    document_id: str = Query(None),
    _patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """Return the most recent pipeline logs.

    Requires a valid Firebase token so operational logs are not exposed
    to unauthenticated clients.
    """
    return {"logs": pipeline_logs.recent(n=n, document_id=document_id)}


@router.get("/stream")
async def stream_logs(
    document_id: str = Query(None),
    _patient_id: uuid.UUID = Depends(get_authenticated_patient_id),
):
    """SSE stream of live pipeline logs. Polls Redis every 1s.

    Requires a valid Firebase token so operational logs are not exposed
    to unauthenticated clients.
    """
    seen = 0

    async def event_generator():
        nonlocal seen
        # Send initial connection message
        yield f"data: {json.dumps({'time': time.strftime('%H:%M:%S'), 'level': 'INFO', 'doc': '-', 'msg': 'Log stream connected'})}\n\n"
        try:
            while True:
                logs = pipeline_logs.recent(n=200, document_id=document_id)
                for entry in logs:
                    # Use time+msg as dedup key
                    key = f"{entry['time']}|{entry['msg']}"
                    if key not in _seen_keys:
                        _seen_keys.add(key)
                        data = json.dumps(entry)
                        yield f"data: {data}\n\n"
                # Keep _seen_keys bounded
                if len(_seen_keys) > 1000:
                    _seen_keys.clear()
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


_seen_keys: set = set()
