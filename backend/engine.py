import os
import re
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from database import SnapshotDB, EventDB

RATES = {'t3.medium': 0.0416, 'c5.xlarge': 0.17, 'r5.large': 0.126}
SNAPSHOT_RATE = float(os.getenv('SNAPSHOT_GB_MONTH_RATE', '0.05'))

def system_now():
    return datetime.now(ZoneInfo(os.getenv('SHIFT_TIMEZONE', 'UTC')))

def demo_available():
    return os.getenv('DEMO_MODE', '0') == '1'

def instance_now(instance):
    if demo_available() and instance.demo_enabled and instance.demo_time:
        return datetime.fromisoformat(instance.demo_time)
    return system_now()

def snapshot_payload(snapshot):
    # Legacy snapshots never stored a timestamp. Only the filename date is known.
    match = re.search(r'_(\d{8})\.IMG$', snapshot.filename or '')
    legacy_date = None
    if match:
        try:
            legacy_date = datetime.strptime(match.group(1), '%Y%m%d').date().isoformat()
        except ValueError:
            pass
    return dict(id=snapshot.id, instance_id=snapshot.instance_id, filename=snapshot.filename,
                size_mb=snapshot.size_mb, tmux_panes=snapshot.tmux_panes,
                created_at=snapshot.created_at, simulated_at=snapshot.simulated_at,
                legacy_date=legacy_date)

def in_shift(instance, now=None):
    clock = (now or instance_now(instance)).strftime('%H:%M')
    start, end = instance.shift_start, instance.shift_end
    if instance.is_exempt or instance.is_snoozed or start == end:
        return True
    return start <= clock < end if start < end else clock >= start or clock < end

def emit(db, instance_id, event_type='FLEET_UPDATED'):
    db.add(EventDB(instance_id=instance_id, event_type=event_type))

def hibernate(db, instance):
    filename = None
    if instance.state != 'hibernated':
        name = re.sub(r'[^A-Za-z0-9_-]', '_', instance.name)
        captured = datetime.now(timezone.utc)
        effective = instance_now(instance)
        filename = f'SNAPSHOT_{name}_{effective:%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}.IMG'
        db.add(SnapshotDB(id=str(uuid.uuid4()), instance_id=instance.id,
            filename=filename, size_mb=34.2, created_at=captured.isoformat(),
            simulated_at=effective.isoformat() if demo_available() and instance.demo_enabled and instance.demo_time else None))
    instance.state = 'hibernated'
    instance.cpu_load = 0
    instance.has_anomaly = False
    emit(db, instance.id, 'SESSION_TERMINATED')
    emit(db, instance.id)
    return filename

def serialize(instance):
    return dict(id=instance.id, name=instance.name, type=instance.instance_type,
        owner=instance.owner_id, state=instance.state, cpu=instance.cpu_load,
        cost=RATES.get(instance.instance_type, 0) if instance.state in ('running', 'idle') else 0,
        hourly_rate=RATES.get(instance.instance_type), exempt=instance.is_exempt,
        snoozed=instance.is_snoozed, anomaly=instance.has_anomaly,
        shift=f'{instance.shift_start} - {instance.shift_end}',
        shift_start=instance.shift_start, shift_end=instance.shift_end,
        timezone=os.getenv('SHIFT_TIMEZONE', 'UTC'),
        demo_enabled=bool(demo_available() and instance.demo_enabled),
        demo_time=instance.demo_time if demo_available() and instance.demo_enabled else None)

def analytics(fleet, snapshots):
    # idle means powered on; stopped/hibernated incur no compute charge.
    compute = sum(i['cost'] for i in fleet)
    baseline = sum(RATES.get(i['type'], 0) for i in fleet)
    storage_gb = sum(s.size_mb for s in snapshots) / 1024
    storage_month = storage_gb * SNAPSHOT_RATE
    eligible = [i for i in fleet if not i['exempt']]
    return dict(compute_hourly=round(compute, 6), compute_daily=round(compute * 24, 6),
        snapshot_gb=round(storage_gb, 6), snapshot_monthly=round(storage_month, 6),
        total_daily=round(compute * 24 + storage_month / 30, 6),
        daily_savings=round((baseline - compute) * 24 - storage_month / 30, 6),
        downscale_rate=round(100 * sum(i['state'] == 'hibernated' for i in eligible) / len(eligible), 1) if eligible else 0,
        exempt_nodes=sum(i['exempt'] for i in fleet), currency='USD', billing_basis='current-state projection; 30-day month',
        snapshot_gb_month_rate=SNAPSHOT_RATE)
