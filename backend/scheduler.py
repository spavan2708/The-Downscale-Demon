import os
from celery import Celery
from database import SessionLocal, InstanceDB
from engine import in_shift, hibernate
celery_app = Celery('demon_scheduler', broker=os.getenv('REDIS_URL', 'redis://redis:6379/0'))
celery_app.conf.beat_schedule = {'shift-cutoff-evaluation': {'task': 'scheduler.evaluate_shifts', 'schedule': 30.0}}

@celery_app.task
def evaluate_shifts():
    with SessionLocal() as db:
        for instance in db.query(InstanceDB).filter(InstanceDB.state.in_(['running', 'idle'])).all():
            if not in_shift(instance):
                hibernate(db, instance)
        db.commit()
