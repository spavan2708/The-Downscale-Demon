import logging
import os
from datetime import datetime, timezone

from celery import Celery
from database import SessionLocal, InstanceDB
from engine import (
    cloud_metrics,
    emit,
    in_shift,
    isolate_instance,
    safe_downscale,
    send_alert,
)

logger = logging.getLogger(__name__)
celery_app = Celery('demon_scheduler', broker=os.getenv('REDIS_URL', 'redis://redis:6379/0'))
celery_app.conf.beat_schedule = {
    'shift-cutoff-evaluation': {
        'task': 'scheduler.evaluate_shifts',
        'schedule': 30.0,
    },
}


@celery_app.task
def evaluate_shifts():
    with SessionLocal() as db:
        instances = (
            db.query(InstanceDB)
            .filter(InstanceDB.state.in_(['running', 'idle']))
            .all()
        )
        for instance in instances:
            try:
                metrics = cloud_metrics(instance)
                cpu = metrics['cpu']
                if cpu is not None:
                    instance.cpu_load = cpu
                instance.memory_usage_mb = metrics.get('memory_mb')
                instance.memory_percent = metrics.get('memory_percent')
                instance.telemetry_updated_at = datetime.now(timezone.utc).isoformat()
                outside_shift = not in_shift(instance)
                memory = metrics.get('memory_percent')
                if outside_shift and (
                    (cpu is not None and cpu > 85)
                    or (memory is not None and memory > 85)
                ):
                    alert_message = isolate_instance(db, instance, memory)
                    emit(db, instance.id, 'SESSION_TERMINATED')
                    emit(db, instance.id)
                    db.commit()
                    send_alert(alert_message)
                    continue
                if outside_shift:
                    safe_downscale(db, instance)
            except Exception:
                logger.exception('Lifecycle evaluation failed for workspace %s', instance.id)
                db.rollback()
                raise
        db.commit()
