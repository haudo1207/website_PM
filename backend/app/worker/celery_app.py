from celery import Celery
from ..config import settings

celery_app = Celery("task_compliance",
    broker=settings.REDIS_URL, backend=settings.REDIS_URL,
    include=["app.worker.tasks"])

celery_app.conf.update(
    task_serializer="json", result_expires=3600,
    timezone="Asia/Ho_Chi_Minh",
    broker_connection_retry_on_startup=True)
