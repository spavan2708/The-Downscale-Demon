import logging
import os
from datetime import datetime, timezone

from celery import Celery
from sqlalchemy import func
from database import SessionLocal, InstanceDB
from database import AgentCommandDB
from agent_control import enabled as agent_control_enabled, enqueue_pause, expire_undelivered_commands, now as agent_now
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
            .filter(func.lower(InstanceDB.state).in_(['running', 'idle']))
            .all()
        )
        for instance in instances:
            try:
                # CloudWatch may lag behind recent client telemetry or omit RAM.
                observed = datetime.fromisoformat(instance.telemetry_updated_at) if instance.telemetry_updated_at else None
                if observed and observed.tzinfo is None:
                    observed = observed.replace(tzinfo=timezone.utc)
                fresh = observed and 0 <= (datetime.now(timezone.utc) - observed).total_seconds() <= 120
                metrics = ({
                    'cpu': instance.cpu_load,
                    'memory_mb': instance.memory_usage_mb,
                    'memory_percent': instance.memory_percent,
                } if fresh else cloud_metrics(instance))
                cpu = metrics['cpu']
                if cpu is not None:
                    instance.cpu_load = cpu
                if metrics.get('memory_mb') is not None:
                    instance.memory_usage_mb = metrics['memory_mb']
                if metrics.get('memory_percent') is not None:
                    instance.memory_percent = metrics['memory_percent']
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
                    if agent_control_enabled():
                        enqueue_pause(db, instance.id)
                    else:
                        safe_downscale(db, instance)
                elif agent_control_enabled() and os.getenv('AGENT_IDLE_ENABLED', '0') == '1':
                    current = datetime.now(timezone.utc)
                    if fresh and cpu is not None and cpu < 5:
                        instance.low_cpu_since = instance.low_cpu_since or current.isoformat()
                        low_for = (current - datetime.fromisoformat(instance.low_cpu_since)).total_seconds()
                        activity = datetime.fromisoformat(instance.activity_observed_at) if instance.activity_observed_at else None
                        last_user = datetime.fromisoformat(instance.last_user_activity_at) if instance.last_user_activity_at else None
                        portal = datetime.fromisoformat(instance.portal_activity_at) if instance.portal_activity_at else None
                        agent_fresh = activity and (current - activity).total_seconds() <= 120
                        user_absent = not last_user or (current - last_user).total_seconds() >= 120
                        portal_absent = not portal or (current - portal).total_seconds() >= 120
                        if low_for >= 900 and agent_fresh and user_absent and portal_absent:
                            enqueue_pause(db, instance.id)
                    else:
                        instance.low_cpu_since = None
            except Exception:
                logger.exception('Lifecycle evaluation failed for workspace %s', instance.id)
                db.rollback()
                raise
        db.commit()
        if agent_control_enabled():
            expire_undelivered_commands(db)
            stale = db.query(AgentCommandDB).filter_by(status='acknowledged').all()
            current = datetime.now(timezone.utc)
            for command in stale:
                if (current - datetime.fromisoformat(command.updated_at)).total_seconds() > 600:
                    command.status = 'failed'
                    command.last_error = 'Worker interrupted after acknowledgment; manual review required'
                    command.updated_at = agent_now()
                    logger.error('Agent command requires review: %s', command.id)
            db.commit()
