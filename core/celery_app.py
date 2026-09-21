# celery broker and result backend configuration

from celery import Celery
from kombu import Queue

from core.config import settings


def _require_celery_url(value: str, name: str) -> str:
    """Return the broker/backend URL resolved from the runtime environment.

    The URL must come from the provided env vars (CELERY_BROKER_URL /
    CELERY_RESULT_BACKEND) — never from a hardcoded fallback. Voroa Worker
    must be given these (e.g. rediss://user:token@host:6379/0). A missing
    value is a hard error: silently starting against a nonexistent local
    Redis hides the misconfiguration.
    """
    url = (value or "").strip()
    if not url:
        raise RuntimeError(
            f"Cannot create the Celery app: {name} is not set in the "
            "runtime environment. Set "
            f"{name}=rediss://user:token@host:6379/0?ssl_cert_reqs=CERT_REQUIRED "
            "and CELERY_RESULT_BACKEND=rediss://... on the Voroa Worker "
            "service. Refusing to fall back to redis://localhost:6379."
        )
    return url


celery_app = Celery(
    "core",
    broker=_require_celery_url(settings.CELERY_BROKER_URL, "CELERY_BROKER_URL"),
    backend=_require_celery_url(settings.CELERY_RESULT_BACKEND, "CELERY_RESULT_BACKEND"),
    include=[
        "workers.ingestion_tasks",
        "workers.graph_sync",
    ],
)

celery_app.conf.update(
    worker_max_tasks_per_child=1,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    timezone="UTC",
    enable_utc=True,
    # Nobody reads task results (verified: no AsyncResult/result polling
    # anywhere in app/workers/services/core/agents), so never write them to
    # the Upstash result backend — each stored result costs multiple Redis
    # commands against a tight request quota. Short TTL as a second guard.
    task_ignore_result=True,
    result_expires=3600,
    # P7: bound hung OCR/extraction/projection work instead of holding a
    # worker slot forever under acks_late; retry broker connection at boot
    # so beat/API ordering races fail soft instead of fast.
    task_time_limit=900,
    task_soft_time_limit=600,
    broker_connection_retry_on_startup=True,
    task_queues=(
        Queue("celery", routing_key="celery"),
        Queue("ingestion", routing_key="ingestion"),
    ),
    task_routes={
        "ingestion_tasks.process_document": {
            "queue": "ingestion",
            "routing_key": "ingestion",
        }
    },
)

celery_app.conf.beat_schedule = {
    # Outbox drain cadence is a Redis-budget decision, not just a freshness
    # one: every dispatch costs broker + (previously) result-backend commands
    # against the Upstash request quota (~17k dispatches/day at 5s exhausted
    # a 500k quota in days). 60s matches the system's own timescales
    # (5-minute stale-lease recovery, 10s+ retry backoff) and is plenty for
    # a health timeline. Do NOT lower this without raising the quota.
    "drain-graph-outbox-every-60-seconds": {
        "task": "workers.graph_sync.drain_graph_outbox",
        "schedule": 60.0,
    },
    # P7: release crash-stalled documents (PROCESSING/EXTRACTED past the
    # 15-minute lease) back to UPLOADED for reprocessing. Same quota
    # reasoning as the outbox drain; 5 minutes is plenty (lease is 15).
    "sweep-stuck-documents-every-5-minutes": {
        "task": "ingestion_tasks.sweep_stuck_documents",
        "schedule": 300.0,
    },
}