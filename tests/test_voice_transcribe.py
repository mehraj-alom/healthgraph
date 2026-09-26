"""Voice STT transport endpoint (Phase 5).

Route presence + auth enforcement + caps + sidecar failure mapping.
No DB, no Redis, no tables: the endpoint is an authenticated pipe.
"""
import io
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api.dependencies import get_authenticated_patient_id

PID = uuid.uuid4()


def _client():
    was_ready = bool(getattr(app.state, "ready", False))
    app.state.ready = True
    client = TestClient(app, raise_server_exceptions=False)
    return client, was_ready


def _wav_bytes(n=8000):
    import wave

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x00\x00" * n)
    return buf.getvalue()


def test_voice_transcribe_requires_auth_not_404():
    client, was_ready = _client()
    try:
        resp = client.post("/api/v1/voice/transcribe", files={"file": ("t.wav", _wav_bytes(), "audio/wav")})
        assert resp.status_code in (401, 403), resp.status_code
    finally:
        app.state.ready = was_ready


def test_voice_transcribe_rejects_bad_type_and_oversize():
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        r1 = client.post("/api/v1/voice/transcribe", files={"file": ("t.txt", b"hello", "text/plain")})
        assert r1.status_code == 400, r1.status_code
        big = b"\x00" * (5 * 1024 * 1024 + 1)
        r2 = client.post("/api/v1/voice/transcribe", files={"file": ("t.wav", big, "audio/wav")})
        assert r2.status_code == 413, r2.status_code
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready


def test_voice_transcribe_sidecar_down_is_503(monkeypatch):
    import app.api.v1.voice as voice

    class DeadClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            import httpx

            raise httpx.ConnectError("refused")

    monkeypatch.setattr(voice.httpx, "AsyncClient", DeadClient)
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        resp = client.post("/api/v1/voice/transcribe", files={"file": ("t.wav", _wav_bytes(), "audio/wav")})
        assert resp.status_code == 503, resp.status_code
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready


def test_voice_transcribe_success_proxies_text(monkeypatch):
    import app.api.v1.voice as voice

    class FakeResp:
        status_code = 200

        def json(self):
            return {"text": "took my morning pill", "infer_s": 1.2}

    class FakeClient:
        seen = {}

        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, content=None, headers=None):
            FakeClient.seen["url"] = url
            FakeClient.seen["bytes"] = len(content or b"")
            return FakeResp()

    monkeypatch.setattr(voice.httpx, "AsyncClient", FakeClient)
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        audio = _wav_bytes()
        resp = client.post("/api/v1/voice/transcribe", files={"file": ("t.wav", audio, "audio/wav")})
        assert resp.status_code == 200, resp.status_code
        assert resp.json()["text"] == "took my morning pill"
        assert "127.0.0.1" in FakeClient.seen["url"], "proxied to the loopback sidecar only"
        assert FakeClient.seen["bytes"] > 1000
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready


def test_voice_transcribe_non_200_is_502(monkeypatch):
    import app.api.v1.voice as voice

    class BadResp:
        status_code = 413

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return BadResp()

    monkeypatch.setattr(voice.httpx, "AsyncClient", FakeClient)
    client, was_ready = _client()
    app.dependency_overrides[get_authenticated_patient_id] = lambda: PID
    try:
        resp = client.post("/api/v1/voice/transcribe", files={"file": ("t.wav", _wav_bytes(), "audio/wav")})
        assert resp.status_code == 502, resp.status_code
    finally:
        app.dependency_overrides.clear()
        app.state.ready = was_ready
