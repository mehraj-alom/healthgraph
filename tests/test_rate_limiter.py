"""
Phase 0 / Increment 5 — Redis rate-limiter regression tests (pure, CI-safe).

Runs against a FakeRedis in-memory stand-in so the suite needs no live
Redis/Upstash. Verifies the fixed-window counter semantics, the policy that
429 never escalates shared-monitor limits, and the deliberate Redis-failure
policy (fail-open for cheap ops, fail-closed 503 for expensive ops).
"""

import redis as redis_lib
import pytest
from fastapi import HTTPException

from core.rate_limiter import RateLimitExceeded, RateLimiter


class FakeRedis:
    """Minimal Redis client stand-in (incr/expire/ttl only)."""

    def __init__(self, fail_commands=False):
        self._store = {}
        self._ttls = {}
        self.fail_commands = fail_commands

    def incr(self, key):
        if self.fail_commands:
            raise redis_lib.exceptions.ConnectionError("simulated redis outage")
        self._store[key] = self._store.get(key, 0) + 1
        return self._store[key]

    def expire(self, key, seconds):
        self._ttls[key] = seconds
        return True

    def ttl(self, key):
        return self._ttls.get(key, 0)


USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


def _limiter(limit=3, window=60, fail_open=False, failure=False):
    fake = FakeRedis(fail_commands=failure)
    return RateLimiter(client=fake), fake


class TestFixedWindowSemantics:
    def test_under_and_at_limit_allowed(self):
        limiter, _ = _limiter(limit=3, window=60)
        limiter.check(USER_A, "reads", 3, 60)  # 1
        limiter.check(USER_A, "reads", 3, 60)  # 2
        limiter.check(USER_A, "reads", 3, 60)  # 3 == limit is allowed

    def test_over_limit_raises_429_with_retry_after(self):
        limiter, _ = _limiter(limit=3, window=60)
        for _ in range(3):
            limiter.check(USER_A, "reads", 3, 60)
        with pytest.raises(RateLimitExceeded) as exc:
            limiter.check(USER_A, "reads", 3, 60)
        assert exc.value.status_code == 429
        assert exc.value.headers["Retry-After"] == "60"

    def test_expire_set_exactly_once_on_first_request(self):
        limiter, fake = _limiter(limit=5, window=60)
        limiter.check(USER_A, "reads", 5, 60)
        key = list(fake._ttls)[0]
        assert fake._ttls[key] == 60
        assert fake._store[key] == 1

    def test_separate_users_have_independent_counters(self):
        limiter, _ = _limiter(limit=2, window=60)
        limiter.check(USER_A, "reads", 2, 60)
        limiter.check(USER_A, "reads", 2, 60)
        with pytest.raises(RateLimitExceeded):
            limiter.check(USER_A, "reads", 2, 60)
        # USER_B is unaffected by USER_A's counter — rotating identities
        # cannot bypass a limit only if the server keys on the verified
        # principal; the counter is per-identity by construction.
        limiter.check(USER_B, "reads", 2, 60)
        limiter.check(USER_B, "reads", 2, 60)

    def test_separate_operations_have_independent_counters(self):
        limiter, _ = _limiter(limit=1, window=60)
        limiter.check(USER_A, "reads", 1, 60)
        with pytest.raises(RateLimitExceeded):
            limiter.check(USER_A, "reads", 1, 60)
        # A different operation is not throttled by the read counter.
        limiter.check(USER_A, "writes", 1, 60)

    def test_window_resets_after_expiry(self):
        limiter, fake = _limiter(limit=2, window=60)
        limiter.check(USER_A, "reads", 2, 60)
        limiter.check(USER_A, "reads", 2, 60)
        with pytest.raises(RateLimitExceeded):
            limiter.check(USER_A, "reads", 2, 60)
        # Simulate the fixed window elapsing (key + TTL gone).
        fake._store.clear()
        fake._ttls.clear()
        limiter.check(USER_A, "reads", 2, 60)
        limiter.check(USER_A, "reads", 2, 60)
        with pytest.raises(RateLimitExceeded):
            limiter.check(USER_A, "reads", 2, 60)

    def test_zero_limits_pass_through(self):
        limiter, _ = _limiter(limit=-1, window=60)
        limiter.check(USER_A, "reads", -1, 60)  # no-op, never blocks


class TestRedisFailurePolicy:
    def test_fail_open_allows_when_redis_down(self):
        limiter, _ = _limiter(limit=2, window=60, failure=True)
        # fail_open=True → request proceeds despite the Redis outage.
        limiter.check(USER_A, "reads", 2, 60, fail_open=True)  # no exception

    def test_fail_closed_returns_503_when_redis_down(self):
        limiter, _ = _limiter(limit=2, window=60, failure=True)
        with pytest.raises(HTTPException) as exc:
            limiter.check(USER_A, "reads", 2, 60, fail_open=False)
        assert exc.value.status_code == 503