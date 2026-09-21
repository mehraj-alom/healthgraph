"""Single Redis client construction path for every Redis consumer.

Why this module exists (P15 / D7)
---------------------------------

The deployment supplies the broker as an Upstash ``rediss://`` URL:

    rediss://user:token@host:6379/0?ssl_cert_reqs=CERT_REQUIRED

redis-py 5.x accepted the uppercase ``CERT_REQUIRED`` spelling in the query
string. redis-py 8.x only accepts the lowercase form — its SSLContext
builder does::

    CERT_REQS = {"none": ..., "optional": ..., "required": ...}
    if ssl_cert_reqs not in CERT_REQS:
        raise RedisError(f"Invalid SSL Certificate Requirements Flag: ...")

so the same URL now raises ``RedisError`` before a single command is sent.
Every Redis-backed control in the app therefore failed: the rate limiters
(fail-open locally = no abuse protection at all), the pipeline log
collector, and the Celery broker.

This module normalises the flag to the spelling the installed client
understands, and is the ONLY place a Redis client (or broker URL) is built.

Security notes
--------------

* Normalisation is an explicit allow-list. ``CERT_REQUIRED`` and
  ``required`` both map to certificate *verification enabled* — the fix
  never weakens verification, it only fixes the spelling.
* An unrecognised value **raises** instead of falling back to ``none``.
  Silently downgrading a TLS setting would be a real vulnerability.
* Non-SSL URLs and URLs without the flag are returned untouched.
"""

from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import redis

# Accepted spellings -> the lowercase token redis-py >= 8 validates.
# Both forms mean the same verification level; only the spelling differs.
_CERT_REQS_ALIASES = {
    "none": "none",
    "cert_none": "none",
    "optional": "optional",
    "cert_optional": "optional",
    "required": "required",
    "cert_required": "required",
}

_SSL_CERT_REQS_KEY = "ssl_cert_reqs"


class InvalidSslCertReqs(ValueError):
    """Raised for an unrecognised ssl_cert_reqs value (never downgraded)."""


def normalize_ssl_cert_reqs(value: str | None) -> str:
    """Map an ssl_cert_reqs spelling to the form redis-py expects.

    Raises InvalidSslCertReqs for anything unrecognised so a typo can never
    silently disable certificate verification.
    """
    token = (value or "").strip().lower()
    if token in _CERT_REQS_ALIASES:
        return _CERT_REQS_ALIASES[token]
    raise InvalidSslCertReqs(
        f"Unsupported ssl_cert_reqs value {value!r}; "
        f"expected one of: none, optional, required."
    )


def normalize_redis_url(url: str | None) -> str | None:
    """Return `url` with its ``ssl_cert_reqs`` query flag in canonical form.

    Only that one parameter is rewritten; credentials, host, port, db and
    every other option pass through unchanged. URLs without the flag (or
    without a query string) are returned as-is.
    """
    if not url:
        return url
    parts = urlsplit(url)
    if not parts.query:
        return url
    rewritten = []
    changed = False
    for key, value in parse_qsl(parts.query, keep_blank_values=True):
        if key.lower() == _SSL_CERT_REQS_KEY:
            rewritten.append((key, normalize_ssl_cert_reqs(value)))
            changed = True
        else:
            rewritten.append((key, value))
    if not changed:
        return url
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(rewritten), parts.fragment)
    )


def build_redis_client(url: str | None = None, **kwargs) -> redis.Redis:
    """Build a Redis client from a (possibly rediss://) URL.

    Falls back to ``REDIS_HOST``/``REDIS_PORT`` for local development when
    no URL is configured, mirroring the previous behaviour of the rate
    limiter and log collector.
    """
    raw = (url or os.getenv("CELERY_BROKER_URL") or "").strip()
    if raw:
        return redis.from_url(normalize_redis_url(raw), **kwargs)
    host = os.getenv("REDIS_HOST", "redis")
    port = int(os.getenv("REDIS_PORT", "6379"))
    kwargs.setdefault("db", 0)
    return redis.Redis(host=host, port=port, **kwargs)
