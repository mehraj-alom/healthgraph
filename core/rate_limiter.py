"""Redis-backed application-level rate limiting.

Architecture (per Increment 5 requirements):

  - Implemented in FastAPI-side Python, backed by the EXISTING Upstash
    Redis (the same CELERY_BROKER_URL Celery and the log collector reuse).
    No second Redis, no in-memory dictionary counters, no SQLite/Postgres
    counters, no paid rate-limiting SaaS.
  - Safe under multiple API instances/processes because the counter lives
    in shared Redis, and the algorithm uses only atomic single-key
    operations.

Algorithm (fixed-window, atomic, no race conditions):

    1. INCR rate_limit:v1:<operation>:<identity>
    2. if the counter is 1 (first request of the window): EXPIRE with the
       window length — exactly once per window by construction.
    3. if the counter exceeds the limit: HTTP 429 with an accurate
       Retry-After = remaining TTL of the key.

  Two concurrent first requests both INCR to 1 (atomic) and both set the
  same window length, so the TTL is always correct even under racing
  first-requests.

Identity contracts:

  - The identity MUST be a verified principal: the canonical patient UUID
    obtained from the Firebase JWT (get_authenticated_patient_id) or the
    Firebase uid. Client-supplied patient_id/conversation_id is NEVER
    acceptable as a rate-limit identity (see app/api/dependencies.py).
  - IP addresses are used ONLY as a fallback for pre-authentication
    surfaces (auth attempt limiting), where no verified principal exists.

Redis key safety (per Increment 6 requirements):

  - Every identity (patient UUID, Firebase uid, or client IP) is stored in
    Redis keys only as a bounded SHA-256 hex digest, never raw. Raw values —
    especially emails, IPs, or uid strings — cannot inject separators,
    namespaces, or unbounded key names, and never appear in keys or logs.
  - Operations are sanitized to [a-z0-9_] before they enter a key name.
  - All keys carry an EXPIRE (the window for counters, the block duration
    for JIT blocks), so Redis key growth is bounded.

Auth attempt limiting (layered, per Increment 6):

  - guard_auth() enforces two independent layers for pre-authentication and
    authentication surfaces:
      1. rate_limit:v1:auth:ip:<hash of trusted client ip> — 10 / 10 min
      2. rate_limit:v1:auth:identity:<hash of verified uid>  — 10 / 10 min
    Both layers must pass; rotating IPs or identities cannot bypass the
    other layer.
  - When a layer exceeds its budget a temporary expiring "JIT block" key is
    written (rate_limit:v1:block:auth:<layer>:<hash>, TTL = block_seconds).
    The block lives only in Redis, auto-expires, is instantly reversible by
    deleting the key, and never reads sensitive values out through the
    client (only HTTP 429 + Retry-After).

IP handling (per Increment 6):

  - client_ip() honours RATE_LIMIT_TRUST_PROXY_HEADERS. Default False: the
    actual peer connection address (request.client.host) is used, which a
    client cannot spoof. Only when the deployment is behind a trusted proxy
    that strips client-supplied forwarding headers should the flag be
    enabled; the first X-Forwarded-For entry is then used.
    Documented decision: prefer the connection address; never trust
    spoofable headers implicitly.

Redis failure behavior (deliberate, documented, tested):

  - fail_open=True  (cheap/read-only operations): Redis errors let the
    request through. Availability takes priority; a Redis blip never takes
    down normal reads/writes.
  - fail_open=False (expensive operations: chat / document processing):
    Redis errors raise HTTP 503 so abuse protection never silently turns
    into "Redis down = unlimited AI requests". For local development
    (APP_ENV=local) the callers pass fail_open=True so a dev box without a
    Redis still works.
"""

import hashlib
import os
import re
from typing import Optional

import redis
from fastapi import HTTPException, Request, status

from core.redis_client import build_redis_client
from core.security_events import log_security_event

_DEFAULT_PREFIX = "rate_limit:v1"

_IDENTITY_MAX_LEN = 256


def _normalize_identity(identity: str) -> str:
    """Bound a verified identity to a safe, opaque Redis key suffix.

    Returns a full SHA-256 hex digest, so raw values (UUIDs, uids, IPs,
    emails) never appear inside Redis keys and key names cannot grow
    unbounded or inject separators/namespaces.
    """
    raw = (identity or "").strip()
    if len(raw) > _IDENTITY_MAX_LEN:
        raw = raw[-_IDENTITY_MAX_LEN:]
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _safe_operation(operation: str) -> str:
    """Sanitize an operation name for use inside a Redis key.

    Only [a-z0-9_] is preserved (lowercased); anything else collapses to
    '_' so attacker-influenced values can never shape the key namespace.
    """
    cleaned = re.sub(r"[^a-z0-9_]", "_", (operation or "").lower())
    return cleaned[:64] or "unknown"


def _get_redis() -> redis.Redis:
    """Return a Redis client on the combined Celery-broker / rate-limit Redis.

    Production (and preview) use the Upstash rediss:// broker URL; local
    development falls back to REDIS_HOST/PORT. A single client per process
    reuses redis-py's built-in connection pool.

    Construction goes through core.redis_client (P15 / D7): the deployment
    URL spells the TLS flag ``ssl_cert_reqs=CERT_REQUIRED``, which redis-py
    >= 8 rejects before any command is sent — every limiter was therefore
    hitting its Redis-error path (fail-open locally = no abuse protection).
    """
    return build_redis_client(decode_responses=True, db=0)


class RateLimitExceeded(HTTPException):
    """HTTP 429 raised when a limit is exceeded (with Retry-After)."""

    def __init__(self, retry_after: int) -> None:
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please retry later.",
        )
        self.headers = {"Retry-After": str(max(1, int(retry_after)))}


class RateLimiter:

    def __init__(self, client: Optional[redis.Redis] = None, prefix: str = _DEFAULT_PREFIX):
        # All RateLimiter instances share one module-level client so the
        # redis-py connection pool is created once per process.
        self._client = client if client is not None else _default_client
        self._prefix = prefix

    # ── helpers ──────────────────────────────────────────────────────────

    def _key(self, identity: str, operation: str) -> str:
        return f"{self._prefix}:{_safe_operation(operation)}:{_normalize_identity(identity)}"

    def client_ip(self, request: Request) -> str:
        """Client IP for pre-authentication rate limiting.

        Default (RATE_LIMIT_TRUST_PROXY_HEADERS=False): return the actual
        peer connection address, which cannot be spoofed over plain TCP.
        Only behind a trusted proxy that strips client-supplied forwarding
        headers should the first X-Forwarded-For entry be honoured. See
        core/config.py for the documented decision.
        """
        from core.config import settings

        if settings.RATE_LIMIT_TRUST_PROXY_HEADERS:
            forwarded = request.headers.get("x-forwarded-for")
            if forwarded:
                return forwarded.split(",")[0].strip()
        return request.client.host if request.client is not None else "unknown"

    # ── core check ───────────────────────────────────────────────────────

    def check(
        self,
        identity: str,
        operation: str,
        limit: int,
        window_seconds: int,
        *,
        fail_open: bool = False,
    ) -> None:
        """Enforce a fixed-window limit.

        Raises:
          RateLimitExceeded (429) when the limit is exceeded.
          HTTPException (503) when Redis is unavailable and fail_open=False.
        Returns None when the request is allowed.
        """
        if limit <= 0 or window_seconds <= 0:
            return

        key = self._key(identity, operation)
        try:
            count = self._client.incr(key)
            if count == 1:
                # First request of a window owns EXPIRE setup. Racing
                # first-requests both set the same window — harmless.
                self._client.expire(key, window_seconds)
        except Exception:
            # Unreachable/misconfigured Redis must never crash request
            # handling. Policy is decided by the caller via fail_open.
            if fail_open:
                return
            log_security_event(
                "rate_limit_unavailable",
                endpoint=operation,
                patient_id=identity,
                message="Rate limiter unavailable; failing closed",
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Rate limiter unavailable. Please retry shortly.",
            )

        if count > limit:
            try:
                ttl = self._client.ttl(key)
            except Exception:
                ttl = None
            retry_after = int(ttl) if ttl and ttl > 0 else window_seconds
            log_security_event(
                "rate_limit_exceeded",
                endpoint=operation,
                patient_id=identity,
                status=429,
                message=f"limit={limit} window={window_seconds}s",
            )
            raise RateLimitExceeded(retry_after)

    # ── auth attempt limiting (layered IP + identity, JIT blocking) ─────

    def _block_key(self, identity: str, operation: str) -> str:
        return f"{self._prefix}:block:{_safe_operation(operation)}:{_normalize_identity(identity)}"

    def raise_if_blocked(
        self,
        identity: str,
        operation: str,
        *,
        fail_open: bool = True,
    ) -> None:
        """Raise 429 if a JIT temporary block is active for this identity.

        The block is an expiring Redis key only — no Postgres records, no
        permanent store, reversible by letting it expire (or deleting the
        key). On Redis failure the decision is fail-open so a blip never
        locks legitimate users out of authentication.
        """
        key = self._block_key(identity, operation)
        try:
            ttl = self._client.ttl(key)
        except Exception:
            if not fail_open:
                log_security_event(
                    "rate_limit_unavailable",
                    endpoint=operation,
                    message="Block check unavailable; failing closed",
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Rate limiter unavailable. Please retry shortly.",
                )
            return
        if ttl and ttl > 0:
            log_security_event(
                "auth_attempt_blocked",
                endpoint=operation,
                status=429,
                message=f"temporary JIT block active ttl={int(ttl)}s",
            )
            raise RateLimitExceeded(int(ttl))

    def guard_auth(
        self,
        identity: str,
        *,
        operation: str,
        limit: int = 10,
        window_seconds: int = 600,
        block_seconds: int = 900,
        fail_open: bool = True,
    ) -> None:
        """Enforce one auth-attempt layer: fixed-window counter + JIT block.

        Layer semantics (call once per layer with its own identity):

          - IP layer:      identity = trusted client IP → rate_limit:v1:auth_ip:<hash>
          - identity layer: identity = verified Firebase uid → rate_limit:v1:auth_identity:<hash>

        When the counter exceeds `limit` for the first time, an expiring
        block key (`rate_limit:v1:block:<op>:<hash>`, TTL `block_seconds`)
        is written; every subsequent attempt short-circuits to 429 via
        `raise_if_blocked` — even after the window counter resets — until the
        block expires. Repeated abuse re-writes the block, extending it.
        Blocks are Redis-TTL only (auto-expire, reversible, no Postgres, no
        account-existence disclosure). Redis outages fail open for auth so
        users are never locked out of sign-in.
        """
        if limit <= 0 or window_seconds <= 0:
            return

        safe_op = _safe_operation(operation)

        self.raise_if_blocked(identity, safe_op, fail_open=fail_open)

        key = self._key(identity, safe_op)
        try:
            count = self._client.incr(key)
            if count == 1:
                self._client.expire(key, window_seconds)
        except Exception:
            if not fail_open:
                log_security_event(
                    "rate_limit_unavailable",
                    endpoint=operation,
                    message="Auth limiter unavailable; failing closed",
                )
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Rate limiter unavailable. Please retry shortly.",
                )
            return

        if count > limit:
            # JIT temporary block: expiring Redis key, reversible, no
            # Postgres, no account-existence disclosure on the wire.
            try:
                self._client.set(self._block_key(identity, safe_op), "1", ex=block_seconds)
            except Exception:
                if not fail_open:
                    log_security_event(
                        "rate_limit_unavailable",
                        endpoint=operation,
                        message="Block write unavailable; failing closed",
                    )
                    raise HTTPException(
                        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                        detail="Rate limiter unavailable. Please retry shortly.",
                    )
            log_security_event(
                "auth_attempts_exceeded",
                endpoint=operation,
                status=429,
                message=f"limit={limit} window={window_seconds}s block={block_seconds}s",
            )
            raise RateLimitExceeded(block_seconds)


# Reusable singleton. Identity must always be derived from verified auth.
_default_client = _get_redis()
rate_limiter = RateLimiter()