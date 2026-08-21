# celery broker and result backend configuration

from celery import Celery
from core.config import settings

celery_app = Celery(
    "core",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["workers.ingestion_tasks"],
)
###*****************************************************************###
celery_app.conf.update(
    #"""Celery configuration settings for the application.
    #it is fully optimized for the dev macine and can be changed for production deployment."""
    worker_max_tasks_per_child=1,
    worker_prefetch_multiplier=1,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    timezone="UTC",
    enable_utc=True
)
###*****************************************************************###