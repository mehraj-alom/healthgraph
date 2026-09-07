"""Redis-backed pipeline log collector for cross-process log visibility."""
import json
import threading
import time
from dataclasses import dataclass
from typing import Optional

import redis


_LOG_KEY = "medgraph:pipeline:logs"
_LOG_MAX = 500


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
            "doc": self.document_id or "-",
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
            import os
            # Production (Voroa) uses the same Redis as the Celery broker
            # (Upstash rediss:// with TLS + password). Reuse it so pipeline
            # logs stream across the API and worker processes with no extra
            # configuration. Fall back to REDIS_HOST/REDIS_PORT for local dev.
            broker_url = os.getenv("CELERY_BROKER_URL")
            if broker_url:
                self._redis = redis.from_url(
                    broker_url, decode_responses=True, db=0
                )
            else:
                host = os.getenv("REDIS_HOST", "redis")
                port = int(os.getenv("REDIS_PORT", "6379"))
                self._redis = redis.Redis(host=host, port=port, db=0, decode_responses=True)
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
