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
    "drain-graph-outbox-every-5-seconds": {
        "task": "workers.graph_sync.drain_graph_outbox",
        "schedule": 5.0,
    }
}