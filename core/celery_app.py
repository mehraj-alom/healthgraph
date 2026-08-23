# celery broker and result backend configuration

from celery import Celery
from core.config import settings

celery_app = Celery(
    "core",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "workers.ingestion_tasks", 
        "tasks.graph_sync"  
    ],
)

celery_app.conf.update(
    worker_max_tasks_per_child=1,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    timezone="UTC",
    enable_utc=True
)


celery_app.conf.beat_schedule = {
    "drain-graph-outbox-every-5-seconds": {
        "task": "tasks.graph_sync.drain_graph_outbox",
        "schedule": 5.0,
    }
}