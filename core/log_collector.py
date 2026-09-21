"""Redis-backed pipeline log collector for cross-process log visibility."""
import json
import threading
import time
from dataclasses import dataclass
from typing import Optional

import redis

from core.redis_client import build_redis_client


_LOG_KEY = "medgraph:pipeline:logs"
_LOG_MAX = 500

# Payload key under which a log entry's owning document id is exposed by
# to_dict(). Callers that scope logs to a patient (app/api/v1/logs.py) MUST
# filter on this key — P15 / D4: the endpoint filtered on a "document_id"
# key that to_dict() never emitted, so every scoped lookup returned nothing.
# It is defined once here so the emit side and the filter side cannot drift
# apart again.
LOG_DOC_KEY = "doc"

# Value used when an entry is not tied to any document.
LOG_DOC_UNSCOPED = "-"


@dataclass
class LogEntry:
    timestamp: float
    level: str
    document_id: Optional[str]
    message: str

    def to_dict(self) -> dict:
        return {
            "time": time.strftime("%H:%M:%S", time.localtime(self.timestamp)),
            "level": self.level,
            LOG_DOC_KEY: self.document_id or LOG_DOC_UNSCOPED,
            "msg": self.message,
        }

    def to_json(self) -> str:
        return json.dumps({
            "t": self.timestamp,
            "l": self.level,
            "d": self.document_id or "",
            "m": self.message,
        })

    @classmethod
    def from_json(cls, raw: str) -> "LogEntry":
        data = json.loads(raw)
        return cls(
            timestamp=data["t"],
            level=data["l"],
            document_id=data.get("d") or None,
            message=data["m"],
        )


class LogCollector:
    """Redis-backed log collector. Worker pushes, API pulls."""

    def __init__(self):
        self._redis = None
        self._local_buffer: list[LogEntry] = []
        self._lock = threading.Lock()
        self._subscribers: list = []
        self._sub_lock = threading.Lock()

    def _get_redis(self):
        if self._redis is None:
            # Production (Voroa) uses the same Redis as the Celery broker
            # (Upstash rediss:// with TLS + password). Reuse it so pipeline
            # logs stream across the API and worker processes with no extra
            # configuration. Fall back to REDIS_HOST/REDIS_PORT for local dev.
            # core.redis_client normalises ssl_cert_reqs for redis-py >= 8
            # (P15 / D7) so this no longer fails on the deployment URL.
            self._redis = build_redis_client(decode_responses=True, db=0)
        return self._redis

    def append(self, level: str, message: str, document_id: Optional[str] = None):
        entry = LogEntry(
            timestamp=time.time(),
            level=level.upper(),
            document_id=document_id,
            message=message,
        )
        try:
            r = self._get_redis()
            r.rpush(_LOG_KEY, entry.to_json())
            r.ltrim(_LOG_KEY, -_LOG_MAX, -1)
        except Exception:
            pass

        # Also notify in-process SSE subscribers
        with self._sub_lock:
            dead = []
            for q in self._subscribers:
                try:
                    q.put_nowait(entry)
                except Exception:
                    dead.append(q)
            for q in dead:
                self._subscribers.remove(q)

    def recent(self, n: int = 100, document_id: Optional[str] = None) -> list[dict]:
        try:
            r = self._get_redis()
            raw_list = r.lrange(_LOG_KEY, -n, -1)
            entries = [LogEntry.from_json(raw) for raw in raw_list]
        except Exception:
            with self._lock:
                entries = list(self._local_buffer[-n:])

        if document_id:
            entries = [e for e in entries if e.document_id == document_id]
        return [e.to_dict() for e in entries[-n:]]

    def subscribe(self):
        """Return an asyncio.Queue that receives new LogEntry objects (in-process only)."""
        import asyncio
        q = asyncio.Queue()
        with self._sub_lock:
            self._subscribers.append(q)
        return q


pipeline_logs = LogCollector()
