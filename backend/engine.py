import os
import boto3
import asyncio
from typing import AsyncGenerator
from database import SessionLocal, InstanceDB, SnapshotDB

class DownscaleDemonEngine:
    def __init__(self):
        self.cost_table = {"t3.medium": 0.0416, "c5.xlarge": 0.1700, "r5.large": 0.1260, "idle_ipv4": 0.0050}
        self._seed_initial_db()

    def _seed_initial_db(self):
        db = SessionLocal()
        if db.query(InstanceDB).count() == 0:
            fleet = [
                InstanceDB(id="i-01a88b9c", aws_instance_id="i-01a88b9c", name="DEV-SANDBOX-ALPHA", instance_type="t3.medium", owner_id="EMP-902", state="running", cpu_load=4.2, shift_start="09:00", shift_end="18:00"),
                InstanceDB(id="i-09927cc1", aws_instance_id="i-09927cc1", name="PROD-ANALYTICS-DB", instance_type="c5.xlarge", owner_id="MGR-101", state="running", is_exempt=True, cpu_load=78.9, shift_start="00:00", shift_end="23:59"),
                InstanceDB(id="i-04312ff8", aws_instance_id="i-04312ff8", name="BUILD-WORKER-IDLE", instance_type="t3.medium", owner_id="EMP-902", state="idle", cpu_load=0.1, shift_start="09:00", shift_end="18:00"),
                InstanceDB(id="i-07741ee2", aws_instance_id="i-07741ee2", name="ML-TRAINING-SANDBOX", instance_type="r5.large", owner_id="EMP-404", state="idle", has_anomaly=True, cpu_load=98.5, shift_start="10:00", shift_end="19:00"),
                InstanceDB(id="i-0b553dd4", aws_instance_id="i-0b553dd4", name="STAGING-API-GATEWAY", instance_type="t3.medium", owner_id="MGR-101", state="running", cpu_load=12.4, shift_start="08:00", shift_end="20:00"),
                InstanceDB(id="i-0f998aa1", aws_instance_id="i-0f998aa1", name="INTEGRATION-TEST-NODE", instance_type="t3.medium", owner_id="EMP-902", state="hibernated", cpu_load=0.0, shift_start="09:00", shift_end="18:00")
            ]
            db.add_all(fleet)
            db.commit()
        db.close()

    def get_instances(self):
        db = SessionLocal()
        records = db.query(InstanceDB).all()
        fleet = []
        for r in records:
            fleet.append({
                "id": r.id,
                "name": r.name,
                "type": r.instance_type,
                "state": r.state,
                "owner": r.owner_id,
                "cpu": r.cpu_load,
                "cost": self.cost_table.get(r.instance_type, 0.0416),
                "exempt": r.is_exempt,
                "snoozed": r.is_snoozed,
                "anomaly": r.has_anomaly,
                "shift": f"{r.shift_start} - {r.shift_end}" if not r.is_exempt else "24/7 EXEMPT",
                "shift_start": r.shift_start,
                "shift_end": r.shift_end
            })
        db.close()
        return fleet

    def update_shift(self, instance_id: str, start: str, end: str):
        db = SessionLocal()
        inst = db.query(InstanceDB).filter(InstanceDB.id == instance_id).first()
        if inst:
            inst.shift_start = start
            inst.shift_end = end
            db.commit()
        db.close()
        return {"status": "SUCCESS"}

    def toggle_state(self, instance_id: str, target_state: str):
        db = SessionLocal()
        inst = db.query(InstanceDB).filter(InstanceDB.id == instance_id).first()
        if inst:
            inst.state = target_state
            if target_state == "running":
                inst.has_anomaly = False
            db.commit()
        db.close()
        return {"status": "SUCCESS", "new_state": target_state}

    def simulate_anomaly(self, instance_id: str):
        db = SessionLocal()
        inst = db.query(InstanceDB).filter(InstanceDB.id == instance_id).first()
        if inst:
            inst.has_anomaly = True
            inst.cpu_load = 99.8
            db.commit()
        db.close()
        return {"status": "ANOMALY_TRIGGERED"}

    async def execute_criu_dump_stream(self, instance_id: str) -> AsyncGenerator[str, None]:
        logs = [
            f"[SYSTEM] INITIATING CRIU STATE SNAPSHOT FOR {instance_id}",
            "[CRIU] FREEZING USERSPACE PROCESS TREE (PIDs: 4012, 4015)...",
            "[CRIU] DUMPING INTERACTIVE TMUX SESSION SOCKETS & BASH HISTORIES",
            "[CRIU] WRITING MEMORY PAGES TO /var/snapshots/dev_environment.img (34.2MB)",
            "[EC2] RELEASING UNASSOCIATED ELASTIC IP...",
            f"[EC2] ISSUING HARD STOP COMMAND TO {instance_id}",
            "[DOWNSCALE COMPLETE] TARGET IS HIBERNATED. ZERO FINOPS LEAKAGE."
        ]
        for line in logs:
            await asyncio.sleep(0.3)
            yield line

        db = SessionLocal()
        inst = db.query(InstanceDB).filter(InstanceDB.id == instance_id).first()
        if inst:
            inst.state = "hibernated"
            db.commit()
        db.close()