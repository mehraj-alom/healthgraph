"""
Phase 0 / Increment 5 — global app security behavior (Dev console gating +
unhandled-exception sanitization). Uses the real create_app() app directly.

The app module import does not start the lifespan (no TestClient context
manager), so no database/Redis/AI dependencies are touched here. /health is
exempt from the readiness gate and responds immediately.
"""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from core.config import settings


def _client():
    return TestClient(app)


class TestDevConsoleGating:
    def test_root_served_in_local(self):
        resp = _client().get("/")
        assert resp.status_code == 200

    def test_root_not_served_in_production(self, monkeypatch):
        monkeypatch.setattr(settings, "APP_ENV", "production")
        resp = _client().get("/")
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Not Found"

    def test_health_stays_available_in_production(self, monkeypatch):
        monkeypatch.setattr(settings, "APP_ENV", "production")
        resp = _client().get("/health")
        assert resp.status_code == 200

    def test_ready_gate_does_not_leak_in_production(self, monkeypatch):
        monkeypatch.setattr(settings, "APP_ENV", "production")
        # Non-exempt endpoint while not ready → 503, no internals.
        resp = _client().get("/api/v1/auth/sync")
        assert resp.status_code == 503
        assert "detail" in resp.json()


class TestErrorHandlerSanitization:
    def test_unhandled_exception_returns_generic_500_with_request_id(self):
        @app.get("/__test_boom", include_in_schema=False)
        def boom():
            raise RuntimeError(
                "internal secret: postgres://user:pass@db, jwt=abc.def, /var/secret.json"
            )

        app.state.ready = True  # bypass the readiness gate so the handler runs
        try:
            resp = TestClient(app, raise_server_exceptions=False).get("/__test_boom")
            assert resp.status_code == 500
            body = resp.json()
            assert body["detail"] == "Internal Server Error"
            # No internal details leak to the client.
            assert "postgres://" not in resp.text
            assert "jwt" not in resp.text.lower()
            assert "/var/secret" not in resp.text
            assert resp.headers.get("X-Request-ID")
        finally:
            app.state.ready = False
            app.routes[:] = [
                r for r in app.routes if getattr(r, "path", "") != "/__test_boom"
            ]


class TestErrorResponseSurface:
    """Increment 6 — every HTTP error surface stays sanitized + correlated.

    No stack traces, filesystem paths, connection strings, secrets or PHI
    may ever reach a client; every response carries X-Request-ID.
    """

    @pytest.mark.parametrize(
        "path,method",
        [
            ("/api/v1/definitely-not-a-route", "get"),  # 404 route-not-found
            ("/health", "post"),                          # 405 method-not-allowed
            ("/api/v1/summaries/daily/not-a-date", "get"),  # 4xx (auth/validation)
            ("/api/v1/auth/sync", "get"),                 # 405 + no token path
        ],
    )
    def test_error_responses_are_sanitized_and_correlated(self, path, method):
        app.state.ready = True
        try:
            resp = getattr(TestClient(app, raise_server_exceptions=False), method)(path)
            assert resp.status_code in (400, 401, 403, 404, 405, 422)
            assert resp.headers.get("X-Request-ID"), "X-Request-ID missing"
            # No internals leak.
            assert "Traceback" not in resp.text
            assert "/var/" not in resp.text
            assert "postgres://" not in resp.text
            assert "redis://" not in resp.text
            assert "secret" not in resp.text.lower()
        finally:
            app.state.ready = False

    def test_not_ready_503_is_sanitized_and_correlated(self):
        app.state.ready = False
        resp = TestClient(app, raise_server_exceptions=False).get(
            "/api/v1/summaries/daily/2024-01-01"
        )
        assert resp.status_code == 503
        assert resp.headers.get("X-Request-ID")
        assert "Traceback" not in resp.text
        assert "secret" not in resp.text.lower()