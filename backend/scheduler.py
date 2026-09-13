import os
from datetime import datetime
from celery import Celery
from database import SessionLocal, InstanceDB
from engine import DownscaleDemonEngine

# Initialize Celery connected to the Redis broker container
celery_app = Celery(
    "demon_scheduler",
    broker=os.getenv("REDIS_URL", "redis://redis:6379/0")
)

celery_app.conf.beat_schedule = {
    "shift-cutoff-evaluation": {
        "task": "scheduler.evaluate_shifts",
        "schedule": 300.0,  # Runs policy evaluation every 5 minutes
    }
}

engine = DownscaleDemonEngine()

@celery_app.task
def evaluate_shifts():
    db = SessionLocal()
    current_time = datetime.now().strftime("%H:%M")
    
    try:
        # Query active instances that have passed their shift end window and are not exempt
        active_instances = db.query(InstanceDB).filter(
            InstanceDB.shift_end <= current_time,
            InstanceDB.is_exempt == False
        ).all()

        for instance in active_instances:
            print(f"[SCHEDULER] Shift ended for {instance.aws_instance_id}. Executing downscale...")
            engine.ec2.stop_instances(InstanceIds=[instance.aws_instance_id])
            
    finally:
        db.close()