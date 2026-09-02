# celery broker and result backend configuration

from celery import Celery
from kombu import Queue

from core.config import settings

celery_app = Celery(
    "core",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
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