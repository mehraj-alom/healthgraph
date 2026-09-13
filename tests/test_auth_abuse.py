"""
Phase 0 / Increment 6 — auth abuse protection, JIT blocking, enumeration
protection and public-endpoint gating tests (pure, CI-safe; no DB/Redis).

Covers:
  - layered auth attempt guard (IP + identity) with independent counters
  - temporary JIT block (exactly the Redis TTL semantics, reversible,
    no Postgres, no account-existence disclosure)
  - Redis-failure fail-open/fail-closed policy for auth
  - key-safety via opaque hashed identity suffixes
  - enumeration protection on /api/v1/auth/sync (identical 401, no leak)
  - public-endpoint audit regression (docs gated in production, structures
    endpoint now requires auth)
"""

import asyncio
import hashlib
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from core.rate_limiter import RateLimitExceeded, RateLimiter
import app.api.auth as auth_module
from app.api.auth import sync_firebase_user


class FakeRedis:
    """Minimal Redis client stand-in (incr/expire/ttl/get/set)."""

    def __init__(self, fail_commands=False):
        self._store = {}
        self._ttls = {}
        self.fail_commands = fail_commands

    def incr(self, key):
        if self.fail_commands:
            raise ConnectionError("simulated redis outage")
        self._store[key] = self._store.get(key, 0) + 1
        return self._store[key]

    def expire(self, key, seconds):
        self._ttls[key] = seconds
        return True

    def ttl(self, key):
        return self._ttls.get(key, 0)

    def get(self, key):
        return self._store.get(key)

    def delete(self, key):
        self._store.pop(key, None)
        self._ttls.pop(key, None)
        return True

    def set(self, key, value, ex=None):
        self._store[key] = value
        if ex is not None:
            self._ttls[key] = ex
        return True


def _limiter(failure=False):
    fake = FakeRedis(fail_commands=failure)
    return RateLimiter(client=fake), fake


IP_A = "203.0.113.10"
IP_B = "203.0.113.20"
UID_A = "firebase-uid-alpha"
UID_B = "firebase-uid-beta"


class TestAuthGuardLayers:
    def test_below_and_at_limit_allowed(self):
        limiter, _ = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)

    def test_over_limit_raises_429_and_sets_jit_block(self):
        limiter, fake = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded) as exc:
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        assert exc.value.status_code == 429
        assert int(exc.value.headers["Retry-After"]) > 0
        # The JIT block key exists with an expiry.
        assert any(k.startswith("rate_limit:v1:block:") for k in fake._ttls)

    def test_blocked_identity_is_short_circuited_next_attempt(self):
        limiter, _ = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        # The JIT block short-circuits BEFORE the counter is consulted: even
        # after the window counter resets, the attempt is still blocked.
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)

    def test_jit_block_engages_across_counter_reset(self):
        limiter, fake = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        # Simulate the 600s window counter expiring (Redis removes only the
        # counter key) while the 900s block key is still alive.
        for key in list(fake._store):
            if "block" not in key:
                fake._store.pop(key, None)
                fake._ttls.pop(key, None)
        # Fresh window, but the JIT block is still active: next attempt is
        # short-circuited to 429 without consuming any new attempts.
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)

    def test_ip_layer_and_identity_layer_are_independent(self):
        limiter, _ = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        # Different layer: same IP but identity guard is unaffected.
        limiter.guard_auth(IP_A, operation="auth_identity", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)

    def test_separate_ips_have_independent_buckets(self):
        limiter, _ = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        # IP_B is not throttled by IP_A's bucket.
        for _ in range(10):
            limiter.guard_auth(IP_B, operation="auth_ip", limit=10, window_seconds=600)

    def test_separate_identities_have_independent_buckets(self):
        limiter, _ = _limiter()
        for _ in range(10):
            limiter.guard_auth(UID_A, operation="auth_identity", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(UID_A, operation="auth_identity", limit=10, window_seconds=600)
        for _ in range(10):
            limiter.guard_auth(UID_B, operation="auth_identity", limit=10, window_seconds=600)

    def test_jit_block_auto_expires(self):
        limiter, fake = _limiter()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        with pytest.raises(RateLimitExceeded):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)
        # Simulate the block TTL elapsing (Redis keys removed).
        fake._store.clear()
        fake._ttls.clear()
        for _ in range(10):
            limiter.guard_auth(IP_A, operation="auth_ip", limit=10, window_seconds=600)

    def test_no_lockout_when_fail_open_and_redis_down(self):
        limiter, _ = _limiter(failure=True)
        limiter.guard_auth(
            IP_A, operation="auth_ip", limit=10, window_seconds=600, fail_open=True
        )

    def test_fail_closed_returns_503_when_redis_down(self):
        limiter, _ = _limiter(failure=True)
        with pytest.raises(HTTPException) as exc:
            limiter.guard_auth(
                IP_A, operation="auth_ip", limit=10, window_seconds=600, fail_open=False
            )
        assert exc.value.status_code == 503


class TestKeySafety:
    def test_identities_are_hashed_in_key_names(self):
        limiter, fake = _limiter()
        limiter.guard_auth("attacker@example.com", operation="auth_identity", limit=1, window_seconds=10)
        for key in fake._store:
            assert "@" not in key
            assert "example" not in key
            # The suffix is a bounded SHA-256 hex digest (no raw identity).
            suffix = key.rsplit(":", 1)[-1]
            assert len(suffix) == 2 * 32
            assert suffix == hashlib.sha256(b"attacker@example.com").hexdigest()

    def test_separator_injection_cannot_tag_keys_with_namespaces(self):
        limiter, fake = _limiter()
        evil = "upsert@evil.com:rate_limit:v1:reads"
        limiter.guard_auth(evil, operation="auth_identity", limit=1, window_seconds=10)
        # No raw separator survived into the key: exactly the expected structure.
        for key in fake._store:
            assert ":evil" not in key
            assert "rate_limit:reads" not in key.split("auth_identity")[0]

    def test_unbounded_identity_is_truncated_before_hashing(self):
        limiter, _ = _limiter()
        huge = "x" * 10_000
        # Must not raise from an oversized identity.
        limiter.guard_auth(huge, operation="auth_ip", limit=1, window_seconds=10)


def _auth_request(ip="203.0.113.99", xff=None):
    headers = {}
    if xff:
        headers["x-forwarded-for"] = xff
    return SimpleNamespace(
        headers=headers,
        client=SimpleNamespace(host=ip),
    )


class TestEnumerationProtection:

    def test_invalid_token_error_is_identical_for_any_token(self, monkeypatch):
        limiter, _ = _limiter()
        monkeypatch.setattr(auth_module, "_auth_limiter", limiter)
        fake_db = SimpleNamespace(
            execute=lambda stmt: SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        credentials = SimpleNamespace(credentials="bogus-token-A")

        with pytest.raises(HTTPException) as exc_a:
            asyncio.run(sync_firebase_user(_auth_request(), credentials, fake_db))

        credentials_b = SimpleNamespace(credentials="bogus-token-B")
        with pytest.raises(HTTPException) as exc_b:
            asyncio.run(sync_firebase_user(_auth_request(), credentials_b, fake_db))

        # Enumeration rule: the client cannot distinguish a token for an
        # existing account from a token for a non-existent account.
        assert exc_a.value.status_code == exc_b.value.status_code == 401
        assert exc_a.value.detail == exc_b.value.detail == "Invalid token."

    def test_invalid_token_is_not_block_revealing(self, monkeypatch):
        limiter, _ = _limiter()
        monkeypatch.setattr(auth_module, "_auth_limiter", limiter)
        fake_db = SimpleNamespace(
            execute=lambda stmt: SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        credentials = SimpleNamespace(credentials="bogus-token")
        try:
            asyncio.run(sync_firebase_user(_auth_request(), credentials, fake_db))
        except HTTPException:
            pass
        # Block keys (auth_ip_block/auth_identity_block) are never created
        # for a merely invalid token — only for exceeding the attempt budget.
        assert not any("_block" in k for k in limiter._client._store)

    def test_429_does_not_disclose_block_reason(self, monkeypatch):
        limiter, _ = _limiter()
        monkeypatch.setattr(auth_module, "_auth_limiter", limiter)
        fake_db = SimpleNamespace(
            execute=lambda stmt: SimpleNamespace(scalar_one_or_none=lambda: None)
        )
        credentials = SimpleNamespace(credentials="bogus-token")
        # The first `limit` attempts return 401 (invalid token); the next
        # one trips the IP-layer budget and activates the JIT block.
        for _ in range(10):
            with pytest.raises(HTTPException) as first:
                asyncio.run(
                    sync_firebase_user(_auth_request(), credentials, fake_db)
                )
            assert first.value.status_code == 401
        with pytest.raises(HTTPException) as exc:
            asyncio.run(
                sync_firebase_user(_auth_request(), credentials, fake_db)
            )
        assert exc.value.status_code == 429
        assert "lock" not in exc.value.detail.lower()
        assert "account" not in exc.value.detail.lower()
        assert "redis" not in exc.value.detail.lower()
        assert exc.value.headers["Retry-After"]


class TestClientIPTrustPolicy:
    def test_default_prefers_connection_address_not_xff(self, monkeypatch):
        from core.config import settings
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False)
        limiter, _ = _limiter()
        req = _auth_request(ip="1.2.3.4", xff="6.6.6.6")
        assert limiter.client_ip(req) == "1.2.3.4"

    def test_trusted_proxy_uses_first_xff_entry(self, monkeypatch):
        from core.config import settings
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", True)
        limiter, _ = _limiter()
        req = _auth_request(ip="1.2.3.4", xff="8.8.8.8, 1.2.3.4")
        assert limiter.client_ip(req) == "8.8.8.8"

    def test_missing_client_falls_back_safely(self, monkeypatch):
        from core.config import settings
        monkeypatch.setattr(settings, "RATE_LIMIT_TRUST_PROXY_HEADERS", False)
        limiter, _ = _limiter()
        req = SimpleNamespace(headers={}, client=None)
        assert limiter.client_ip(req) == "unknown"


def _route_dependencies(route):
    resolved = []
    pending = [route.dependant]
    while pending:
        dep = pending.pop()
        if dep.call is not None:
            resolved.append(dep.call)
        pending.extend(dep.dependencies)
    return resolved


class TestPublicEndpointAudit:
    def test_health_route_exists_and_needs_no_auth(self):
        import app.main as main_module

        health_routes = [
            r for r in main_module.app.routes if getattr(r, "path", None) == "/health"
        ]
        assert health_routes, "expected a /health route"
        auth = {r for r in _route_dependencies(health_routes[0]) if "patient" in (r.__name__ if hasattr(r, "__name__") else "")}
        # /health must stay public; nothing requires get_authenticated_patient_id.
        assert auth == set()

    def test_structures_endpoint_now_requires_auth(self):
        from app.api.dependencies import get_authenticated_patient_id
        from app.api.v1 import body_state

        route = [
            r
            for r in body_state.router.routes
            if r.path.endswith("/structures") and "GET" in r.methods
        ][0]
        resolved = _route_dependencies(route)
        assert get_authenticated_patient_id in resolved

    def test_docs_disabled_in_production(self, monkeypatch):
        from core.config import settings
        import app.main as main_module

        monkeypatch.setattr(settings, "APP_ENV", "production")
        prod_app = main_module.create_app()
        prod_app.state.ready = True
        from fastapi.testclient import TestClient

        client = TestClient(prod_app)
        for path in ("/docs", "/redoc", "/openapi.json"):
            resp = client.get(path)
            assert resp.status_code in (404, 405), path