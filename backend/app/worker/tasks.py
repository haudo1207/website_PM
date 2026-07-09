from .celery_app import celery_app
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

@celery_app.task(name="app.worker.tasks.check_sheet")
def check_sheet(spreadsheet_id: str, db_sheet_id: int, run_id: str):
    logger.info(f"[Worker] check_sheet called (legacy, doing nothing) for sheet_id={db_sheet_id}")
    return {"status": "deprecated"}

@celery_app.on_after_configure.connect
def setup_periodic_tasks(sender, **kwargs):
    # Deprecated periodic tasks setup
    pass

@celery_app.task(name="app.worker.tasks.check_all_sheets")
def check_all_sheets():
    logger.info("[Worker] check_all_sheets called (legacy, doing nothing)")
    return {"status": "deprecated"}
