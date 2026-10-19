import json
import logging
import math
import os
import re
import shlex
import time
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

from botocore.exceptions import BotoCoreError, ClientError

from database import EventDB, RuntimeIntervalDB, SnapshotDB

logger = logging.getLogger(__name__)

RATES = {'t3.medium': 0.0416, 'c5.xlarge': 0.17, 'r5.large': 0.126}
configured_rates = os.getenv('EC2_HOURLY_RATES_JSON')
if configured_rates:
    parsed_rates = json.loads(configured_rates)
    if not isinstance(parsed_rates, dict) or any(
        not isinstance(rate, (int, float)) or not math.isfinite(rate) or rate < 0
        for rate in parsed_rates.values()
    ):
        raise ValueError('EC2_HOURLY_RATES_JSON must be an object of non-negative numeric rates')
    RATES.update({str(instance_type): float(rate) for instance_type, rate in parsed_rates.items()})

SNAPSHOT_RATE = float(os.getenv('SNAPSHOT_GB_MONTH_RATE', '0.05'))
if not math.isfinite(SNAPSHOT_RATE) or SNAPSHOT_RATE < 0:
    raise ValueError('SNAPSHOT_GB_MONTH_RATE must be a finite non-negative number')
AWS_OPERATION_TIMEOUT = int(os.getenv('AWS_OPERATION_TIMEOUT_SECONDS', '600'))
AWS_POLL_SECONDS = float(os.getenv('AWS_POLL_SECONDS', '5'))


class LifecycleError(RuntimeError):
    pass


def _report_aws_failure(action, workspace_id, exc):
    code = (
        exc.response.get('Error', {}).get('Code', 'AWSClientError')
        if isinstance(exc, ClientError)
        else type(exc).__name__
    )
    logger.exception('AWS %s failed for workspace %s (%s)', action, workspace_id, code)
    return LifecycleError(f'AWS {action} failed for workspace {workspace_id} ({code})')


def aws_lifecycle_enabled():
    return os.getenv('AWS_LIFECYCLE_ENABLED', '0') == '1'


def _aws_client(service):
    import boto3

    return boto3.client(service, region_name=os.getenv('AWS_DEFAULT_REGION', 'us-east-1'))


def _aws_instance_id(instance):
    if not instance.aws_instance_id or not re.fullmatch(r'i-[0-9a-fA-F]{8,17}', instance.aws_instance_id):
        raise LifecycleError(f'Workspace {instance.id} has no valid AWS instance ID')
    return instance.aws_instance_id


def system_now():
    return datetime.now(ZoneInfo(os.getenv('SHIFT_TIMEZONE', 'UTC')))


def demo_available():
    return os.getenv('DEMO_MODE', '0') == '1'


def instance_now(instance):
    if demo_available() and instance.demo_enabled and instance.demo_time:
        return datetime.fromisoformat(instance.demo_time)
    return system_now()


def snapshot_payload(snapshot):
    match = re.search(r'_(\d{8})\.IMG$', snapshot.filename or '')
    legacy_date = None
    if match:
        try:
            legacy_date = datetime.strptime(match.group(1), '%Y%m%d').date().isoformat()
        except ValueError:
            pass
    return dict(
        id=snapshot.id,
        instance_id=snapshot.instance_id,
        filename=snapshot.filename,
        size_mb=snapshot.size_mb,
        tmux_panes=snapshot.tmux_panes,
        created_at=snapshot.created_at,
        simulated_at=snapshot.simulated_at,
        memory_footprint_mb=snapshot.memory_footprint_mb,
        snapshot_ref=snapshot.snapshot_ref,
        process_tree=json.loads(snapshot.process_tree) if snapshot.process_tree else None,
        legacy_date=legacy_date,
    )


def in_shift(instance, now=None):
    clock = (now or instance_now(instance)).strftime('%H:%M')
    start, end = instance.shift_start, instance.shift_end
    if instance.is_exempt or instance.is_snoozed or start == end:
        return True
    return start <= clock < end if start < end else clock >= start or clock < end


def emit(db, instance_id, event_type='FLEET_UPDATED', actor_id=None, details=None):
    db.add(EventDB(
        instance_id=instance_id,
        event_type=event_type,
        actor_id=actor_id,
        details=details,
    ))


def transition_instance_state(db, instance, state):
    if instance.state == state:
        return
    now = datetime.now(timezone.utc)
    started = datetime.fromisoformat(instance.state_since) if instance.state_since else now
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    if started < now:
        db.add(RuntimeIntervalDB(
            instance_id=instance.id,
            state=instance.state,
            started_at=started.isoformat(),
            ended_at=now.isoformat(),
        ))
    instance.state = state
    instance.state_since = now.isoformat()


def runtime_summary(db, instances, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    today = now.astimezone(ZoneInfo(os.getenv('SHIFT_TIMEZONE', 'UTC'))).replace(
        hour=0, minute=0, second=0, microsecond=0,
    ).astimezone(timezone.utc)
    db.flush()
    runtime = []
    totals = {'active_hours': 0.0, 'hibernated_hours': 0.0, 'tracked_hours': 0.0}
    rates = {'active_hours': 0.0, 'hibernated_hours': 0.0, 'tracked_hours': 0.0}
    today_totals = {'active_hours': 0.0, 'hibernated_hours': 0.0}
    today_rates = {'active_hours': 0.0, 'hibernated_hours': 0.0}
    for instance in instances:
        durations = {'active_hours': 0.0, 'hibernated_hours': 0.0, 'tracked_hours': 0.0}
        today_durations = {'active_hours': 0.0, 'hibernated_hours': 0.0}
        intervals = db.query(RuntimeIntervalDB).filter(
            RuntimeIntervalDB.instance_id == instance.id,
        ).all()
        periods = [
            (item.state, datetime.fromisoformat(item.started_at), datetime.fromisoformat(item.ended_at))
            for item in intervals
        ]
        started = datetime.fromisoformat(instance.state_since) if instance.state_since else now
        periods.append((instance.state, started, now))
        for state, start, end in periods:
            if start.tzinfo is None:
                start = start.replace(tzinfo=timezone.utc)
            if end.tzinfo is None:
                end = end.replace(tzinfo=timezone.utc)
            hours = max(0.0, (end - start).total_seconds() / 3600)
            durations['tracked_hours'] += hours
            daily_start = max(start.astimezone(timezone.utc), today)
            daily_end = min(end.astimezone(timezone.utc), now.astimezone(timezone.utc))
            daily_hours = max(0.0, (daily_end - daily_start).total_seconds() / 3600)
            if state in ('running', 'idle', 'isolated'):
                durations['active_hours'] += hours
                today_durations['active_hours'] += daily_hours
            elif state in ('hibernated', 'stopped'):
                durations['hibernated_hours'] += hours
                today_durations['hibernated_hours'] += daily_hours
        rate = RATES.get(instance.instance_type, 0.0)
        for key, value in durations.items():
            totals[key] += value
            rates[key] += value * rate
        for key, value in today_durations.items():
            today_totals[key] += value
            today_rates[key] += value * rate
        runtime.append({
            'instance_id': instance.id,
            'active_hours': round(durations['active_hours'], 4),
            'hibernated_hours': round(durations['hibernated_hours'], 4),
            'today_active_hours': round(today_durations['active_hours'], 4),
            'today_hibernated_hours': round(today_durations['hibernated_hours'], 4),
            'today_estimated_credits_preserved_usd': round(today_durations['hibernated_hours'] * rate, 6),
            'tracked_hours': round(durations['tracked_hours'], 4),
            'managed_compute_usd': round(durations['active_hours'] * rate, 6),
            'baseline_compute_usd': round(durations['tracked_hours'] * rate, 6),
            'aws_state': None,
        })
    return {
        'workspaces': runtime,
        'active_hours': round(totals['active_hours'], 4),
        'hibernated_hours': round(totals['hibernated_hours'], 4),
        'today_active_hours': round(today_totals['active_hours'], 4),
        'today_hibernated_hours': round(today_totals['hibernated_hours'], 4),
        'today_estimated_credits_preserved_usd': round(
            today_rates['hibernated_hours'], 6,
        ),
        'tracked_hours': round(totals['tracked_hours'], 4),
        'baseline_compute_usd': round(rates['tracked_hours'], 6),
        'managed_compute_usd': round(rates['active_hours'], 6),
        'estimated_credits_preserved_usd': round(
            max(0.0, rates['tracked_hours'] - rates['active_hours']), 6,
        ),
        'tracking_basis': 'database state intervals since runtime tracking was enabled',
        'daily_tracking_timezone': os.getenv('SHIFT_TIMEZONE', 'UTC'),
    }


def _wait_for_instance_healthy(ec2, instance_id):
    deadline = time.monotonic() + AWS_OPERATION_TIMEOUT
    while time.monotonic() < deadline:
        response = ec2.describe_instance_status(
            InstanceIds=[instance_id],
            IncludeAllInstances=True,
        )
        statuses = response.get('InstanceStatuses', [])
        if statuses:
            status = statuses[0]
            state = status.get('InstanceState', {}).get('Name')
            instance_ok = status.get('InstanceStatus', {}).get('Status')
            system_ok = status.get('SystemStatus', {}).get('Status')
            if state == 'running' and instance_ok == 'ok' and system_ok == 'ok':
                return
        time.sleep(AWS_POLL_SECONDS)
    raise LifecycleError(f'AWS instance {instance_id} did not become healthy before timeout')


def _wait_for_volume_state(ec2, volume_id, expected_state, instance_id=None):
    deadline = time.monotonic() + AWS_OPERATION_TIMEOUT
    while time.monotonic() < deadline:
        response = ec2.describe_volumes(VolumeIds=[volume_id])
        volume = response['Volumes'][0]
        attachments = volume.get('Attachments', [])
        if expected_state == 'attached':
            if any(
                attachment.get('State') == 'attached'
                and (instance_id is None or attachment.get('InstanceId') == instance_id)
                for attachment in attachments
            ):
                return
        elif volume.get('State') == expected_state:
            return
        time.sleep(AWS_POLL_SECONDS)
    raise LifecycleError(f'EBS volume {volume_id} did not reach state {expected_state}')


def _attach_volume(ec2, instance):
    if not instance.aws_volume_id:
        raise LifecycleError(f'Workspace {instance.id} has no configured checkpoint EBS volume')
    instance_id = _aws_instance_id(instance)
    response = ec2.describe_volumes(VolumeIds=[instance.aws_volume_id])
    volume = response['Volumes'][0]
    attachments = volume.get('Attachments', [])
    if any(
        attachment.get('State') == 'attached'
        and attachment.get('InstanceId') == instance_id
        for attachment in attachments
    ):
        return
    if any(
        attachment.get('State') in ('attaching', 'attached')
        and attachment.get('InstanceId') == instance_id
        for attachment in attachments
    ):
        _wait_for_volume_state(ec2, instance.aws_volume_id, 'attached', instance_id)
        return
    if any(attachment.get('InstanceId') != instance_id for attachment in attachments):
        raise LifecycleError(
            f'EBS volume {instance.aws_volume_id} is attached to another EC2 instance'
        )
    if volume.get('State') != 'available':
        raise LifecycleError(
            f'EBS volume {instance.aws_volume_id} is {volume.get("State")}; refusing to attach'
        )
    device_name = os.getenv('EBS_DEVICE_NAME')
    if not device_name:
        raise LifecycleError('EBS_DEVICE_NAME is required to attach checkpoint storage')
    ec2.attach_volume(
        VolumeId=instance.aws_volume_id,
        InstanceId=instance_id,
        Device=device_name,
    )
    _wait_for_volume_state(ec2, instance.aws_volume_id, 'attached', instance_id)


def _run_ssm_command(instance_id, commands):
    ssm = _aws_client('ssm')
    response = ssm.send_command(
        InstanceIds=[instance_id],
        DocumentName='AWS-RunShellScript',
        Parameters={'commands': commands},
        TimeoutSeconds=min(AWS_OPERATION_TIMEOUT, 3600),
    )
    command_id = response['Command']['CommandId']
    deadline = time.monotonic() + AWS_OPERATION_TIMEOUT
    while time.monotonic() < deadline:
        try:
            invocation = ssm.get_command_invocation(
                CommandId=command_id,
                InstanceId=instance_id,
            )
        except ssm.exceptions.InvocationDoesNotExist:
            time.sleep(AWS_POLL_SECONDS)
            continue
        status = invocation.get('Status')
        if status == 'Success':
            return invocation.get('StandardOutputContent', '')
        if status in ('Cancelled', 'TimedOut', 'Failed', 'Cancelling'):
            raise LifecycleError(
                f'SSM lifecycle command {command_id} ended with {status}: '
                f'{invocation.get("StandardErrorContent", "").strip()}'
            )
        time.sleep(AWS_POLL_SECONDS)
    raise LifecycleError(f'SSM lifecycle command {command_id} did not complete before timeout')


def restore_checkpoint(db, instance):
    if not aws_lifecycle_enabled():
        return None
    if not instance.aws_volume_id:
        raise LifecycleError(f'Workspace {instance.id} has no configured checkpoint EBS volume')
    ec2 = _aws_client('ec2')
    instance_id = _aws_instance_id(instance)
    _wait_for_volume_state(ec2, instance.aws_volume_id, 'attached', instance_id)
    mount_path = os.getenv('EBS_MOUNT_PATH')
    if not mount_path:
        raise LifecycleError('EBS_MOUNT_PATH is required to restore a checkpoint')
    mount_device = os.getenv('EBS_MOUNT_DEVICE')
    if not mount_device:
        raise LifecycleError('EBS_MOUNT_DEVICE is required to restore a checkpoint')
    _run_ssm_command(
        instance_id,
        [
            'set -eu',
            f'mkdir -p {shlex.quote(mount_path)}',
            f'mountpoint -q {shlex.quote(mount_path)} || '
            f'mount {shlex.quote(mount_device)} {shlex.quote(mount_path)}',
            f'actual_source=$(findmnt -n -o SOURCE --target {shlex.quote(mount_path)})',
            f'test "$(readlink -f "$actual_source")" = '
            f'"$(readlink -f {shlex.quote(mount_device)})"',
        ],
    )
    snapshot = (
        db.query(SnapshotDB)
        .filter(SnapshotDB.instance_id == instance.id, SnapshotDB.snapshot_ref.isnot(None))
        .order_by(SnapshotDB.created_at.desc())
        .first()
    )
    if not snapshot:
        return None
    checkpoint_dir = snapshot.snapshot_ref
    output = _run_ssm_command(
        instance_id,
        [
            'set -eu',
            f'test -d {shlex.quote(checkpoint_dir)}',
            f'criu restore -D {shlex.quote(checkpoint_dir)} --shell-job',
        ],
    )
    return output


def wake_instance(db, instance):
    if instance.state in ('running', 'idle'):
        transition_instance_state(db, instance, 'running')
        instance.has_anomaly = False
        emit(db, instance.id)
        return
    if not aws_lifecycle_enabled():
        transition_instance_state(db, instance, 'running')
        instance.cpu_load = 4.2
        instance.has_anomaly = False
        emit(db, instance.id)
        return
    instance_id = _aws_instance_id(instance)
    ec2 = _aws_client('ec2')
    ec2.start_instances(InstanceIds=[instance_id])
    _wait_for_instance_healthy(ec2, instance_id)
    _attach_volume(ec2, instance)
    restore_checkpoint(db, instance)
    transition_instance_state(db, instance, 'running')
    instance.cpu_load = 0
    instance.has_anomaly = False
    emit(db, instance.id)


def _consume_buffered_request(sqs, queue_url, request_id):
    deadline = time.monotonic() + int(os.getenv('REQUEST_QUEUE_WAIT_SECONDS', '30'))
    while time.monotonic() < deadline:
        response = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=1,
            VisibilityTimeout=5,
        )
        for message in response.get('Messages', []):
            try:
                envelope = json.loads(message['Body'])
            except (KeyError, json.JSONDecodeError):
                logger.error('Ignoring malformed buffered request message')
                continue
            if envelope.get('request_id') != request_id:
                sqs.change_message_visibility(
                    QueueUrl=queue_url,
                    ReceiptHandle=message['ReceiptHandle'],
                    VisibilityTimeout=0,
                )
                continue
            if envelope.get('expires_at', 0) < int(time.time()):
                sqs.delete_message(
                    QueueUrl=queue_url,
                    ReceiptHandle=message['ReceiptHandle'],
                )
                raise LifecycleError('Buffered request expired during workspace warm-up')
            sqs.delete_message(
                QueueUrl=queue_url,
                ReceiptHandle=message['ReceiptHandle'],
            )
            return envelope
    raise LifecycleError('Timed out waiting for the buffered request in SQS')


def queue_request_and_wake(db, instance, request_metadata):
    if not aws_lifecycle_enabled():
        raise LifecycleError('AWS lifecycle actions are disabled')
    if instance.state not in ('stopped', 'hibernated'):
        return None
    queue_url = os.getenv('REQUEST_QUEUE_URL')
    if not queue_url:
        raise LifecycleError('REQUEST_QUEUE_URL is required for edge request buffering')
    instance_id = _aws_instance_id(instance)
    request_id = str(uuid.uuid4())
    request_ttl = int(os.getenv('REQUEST_TTL_SECONDS', '300'))
    if request_ttl <= 0:
        raise LifecycleError('REQUEST_TTL_SECONDS must be positive')
    envelope = {
        'request_id': request_id,
        'workspace_id': instance.id,
        'aws_instance_id': instance_id,
        'expires_at': int(time.time()) + request_ttl,
        'request': request_metadata,
    }
    if len(json.dumps(envelope).encode('utf-8')) > 240 * 1024:
        raise LifecycleError('Buffered request exceeds the configured SQS payload limit')
    sqs = _aws_client('sqs')
    sqs.send_message(QueueUrl=queue_url, MessageBody=json.dumps(envelope))
    wake_instance(db, instance)
    return request_id


def complete_buffered_request(request_id):
    queue_url = os.getenv('REQUEST_QUEUE_URL')
    if not queue_url:
        raise LifecycleError('REQUEST_QUEUE_URL is required to complete buffered requests')
    _consume_buffered_request(_aws_client('sqs'), queue_url, request_id)


def forward_request(instance, method, path, query, headers, body):
    if not aws_lifecycle_enabled():
        raise LifecycleError('AWS lifecycle actions are disabled')
    template = os.getenv('INSTANCE_PROXY_URL_TEMPLATE')
    if not template:
        raise LifecycleError('INSTANCE_PROXY_URL_TEMPLATE is required for edge forwarding')
    instance_id = _aws_instance_id(instance)
    response = _aws_client('ec2').describe_instances(InstanceIds=[instance_id])
    reservations = response.get('Reservations', [])
    if not reservations or not reservations[0].get('Instances'):
        raise LifecycleError(f'AWS instance {instance_id} was not found')
    private_ip = reservations[0]['Instances'][0].get('PrivateIpAddress')
    if not private_ip:
        raise LifecycleError(f'AWS instance {instance_id} has no private IP address')
    base_url = template.format(private_ip=private_ip, instance_id=instance_id)
    encoded_path = quote(path, safe='/')
    url = f'{base_url.rstrip("/")}/{encoded_path.lstrip("/")}'
    if query:
        url = f'{url}?{query}'
    upstream_request = Request(url, data=body or None, headers=headers, method=method)
    try:
        upstream = urlopen(upstream_request, timeout=60)
    except HTTPError as exc:
        upstream = exc
    except URLError as exc:
        raise LifecycleError(f'Unable to reach warmed workspace {instance.id}') from exc
    with upstream:
        excluded_headers = {'connection', 'transfer-encoding', 'content-length'}
        response_headers = {
            key: value for key, value in upstream.headers.items()
            if key.lower() not in excluded_headers
        }
        return upstream.status, response_headers, upstream.read()


def _aws_downscale(instance, snapshot_id):
    ec2 = _aws_client('ec2')
    instance_id = _aws_instance_id(instance)
    if not instance.aws_volume_id:
        raise LifecycleError(f'Workspace {instance.id} has no configured checkpoint EBS volume')
    _wait_for_volume_state(ec2, instance.aws_volume_id, 'attached', instance_id)

    mount_path = os.getenv('EBS_MOUNT_PATH')
    target_pid = os.getenv('CRIU_TARGET_PID')
    checkpoint_root = os.getenv('CRIU_CHECKPOINT_ROOT')
    mount_device = os.getenv('EBS_MOUNT_DEVICE')
    if not mount_path or not target_pid or not checkpoint_root or not mount_device:
        raise LifecycleError(
            'EBS_MOUNT_PATH, EBS_MOUNT_DEVICE, CRIU_TARGET_PID, and '
            'CRIU_CHECKPOINT_ROOT are required'
        )
    if not target_pid.isdecimal():
        raise LifecycleError('CRIU_TARGET_PID must be a positive process ID')
    if (
        not os.path.isabs(mount_path)
        or not os.path.isabs(mount_device)
        or not os.path.isabs(checkpoint_root)
    ):
        raise LifecycleError(
            'EBS_MOUNT_PATH, EBS_MOUNT_DEVICE, and CRIU_CHECKPOINT_ROOT must be absolute paths'
        )
    if os.path.commonpath((mount_path, checkpoint_root)) != os.path.normpath(mount_path):
        raise LifecycleError('CRIU_CHECKPOINT_ROOT must be inside EBS_MOUNT_PATH')
    checkpoint_dir = os.path.join(checkpoint_root, snapshot_id)
    quoted_mount = shlex.quote(mount_path)
    quoted_device = shlex.quote(mount_device)
    quoted_dir = shlex.quote(checkpoint_dir)
    metadata_marker = 'DOWNSCALE_METADATA:'
    output = _run_ssm_command(
        instance_id,
        [
            'set -eu',
            f'mountpoint -q {quoted_mount}',
            f'actual_source=$(findmnt -n -o SOURCE --target {quoted_mount})',
            f'test "$(readlink -f "$actual_source")" = "$(readlink -f {quoted_device})"',
            f'test -d /proc/{target_pid}',
            f'memory_kb=$(awk \'/^VmRSS:/ {{print $2}}\' /proc/{target_pid}/status)',
            f'process_tree=$(ps -o pid=,ppid=,comm= --forest -p {target_pid} | base64 | tr -d "\\n")',
            f'sync -f {quoted_mount}',
            f'mkdir -p {quoted_dir}',
            f'criu dump -t {target_pid} -D {quoted_dir} --shell-job',
            f'sync -f {quoted_dir}',
            f'checkpoint_mb=$(du -sm {quoted_dir} | cut -f1)',
            f'printf "{metadata_marker}%s:%s:%s\\n" "$memory_kb" "$checkpoint_mb" "$process_tree"',
            f'umount -- {quoted_mount}',
            f'if mountpoint -q {quoted_mount}; then exit 42; fi',
        ],
    )
    metadata = next(
        (line[len(metadata_marker):] for line in output.splitlines() if line.startswith(metadata_marker)),
        None,
    )
    if not metadata:
        raise LifecycleError('CRIU checkpoint command returned no RAM/process metadata')
    try:
        memory_value, size_value, encoded_tree = metadata.split(':', 2)
        memory_kb = float(memory_value)
        checkpoint_size_mb = float(size_value)
        import base64

        process_tree = base64.b64decode(encoded_tree).decode('utf-8').strip()
    except (ValueError, UnicodeDecodeError) as exc:
        raise LifecycleError('CRIU checkpoint command returned invalid RAM/process metadata') from exc

    ec2.detach_volume(VolumeId=instance.aws_volume_id, InstanceId=instance_id, Force=False)
    _wait_for_volume_state(ec2, instance.aws_volume_id, 'available')
    ec2.stop_instances(InstanceIds=[instance_id])
    ec2.get_waiter('instance_stopped').wait(
        InstanceIds=[instance_id],
        WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
    )
    return checkpoint_dir, memory_kb / 1024, checkpoint_size_mb, process_tree


def safe_downscale(db, instance):
    if instance.state in ('hibernated', 'stopped'):
        return None
    name = re.sub(r'[^A-Za-z0-9_-]', '_', instance.name)
    captured = datetime.now(timezone.utc)
    effective = instance_now(instance)
    snapshot_id = str(uuid.uuid4())
    filename = f'SNAPSHOT_{name}_{effective:%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:6]}.IMG'
    if aws_lifecycle_enabled():
        try:
            snapshot_ref, memory_footprint_mb, size_mb, process_tree = _aws_downscale(
                instance,
                snapshot_id,
            )
        except (BotoCoreError, ClientError) as exc:
            raise _report_aws_failure('checkpoint/downscale', instance.id, exc) from exc
    else:
        snapshot_ref = None
        memory_footprint_mb = None
        process_tree = None
        size_mb = None
    db.add(
        SnapshotDB(
            id=snapshot_id,
            instance_id=instance.id,
            filename=filename,
            size_mb=size_mb,
            created_at=captured.isoformat(),
            simulated_at=(
                effective.isoformat()
                if demo_available() and instance.demo_enabled and instance.demo_time
                else None
            ),
            tmux_panes=None,
            memory_footprint_mb=memory_footprint_mb,
            snapshot_ref=snapshot_ref,
            process_tree=json.dumps(process_tree) if process_tree is not None else None,
        )
    )
    transition_instance_state(db, instance, 'hibernated')
    instance.cpu_load = 0
    instance.has_anomaly = False
    emit(db, instance.id, 'SESSION_TERMINATED')
    emit(db, instance.id)
    return filename


def hibernate(db, instance):
    return safe_downscale(db, instance)


def _terminate_workspace(db, instance):
    if not aws_lifecycle_enabled():
        transition_instance_state(db, instance, 'stopped')
        return

    instance_id = _aws_instance_id(instance)
    ec2 = _aws_client('ec2')
    response = ec2.describe_instances(InstanceIds=[instance_id])
    reservations = response.get('Reservations', [])
    records = [item for reservation in reservations for item in reservation.get('Instances', [])]
    if not records:
        raise LifecycleError(f'AWS instance {instance_id} was not found')
    aws_state = records[0].get('State', {}).get('Name')

    if aws_state == 'pending':
        ec2.get_waiter('instance_running').wait(
            InstanceIds=[instance_id],
            WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
        )
        aws_state = 'running'
    if aws_state == 'stopping':
        ec2.get_waiter('instance_stopped').wait(
            InstanceIds=[instance_id],
            WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
        )
        aws_state = 'stopped'
    if aws_state == 'shutting-down':
        ec2.get_waiter('instance_terminated').wait(
            InstanceIds=[instance_id],
            WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
        )
        aws_state = 'terminated'

    if aws_state == 'running':
        if instance.aws_volume_id:
            if instance.state in ('running', 'idle', 'isolated'):
                safe_downscale(db, instance)
            else:
                _aws_downscale(instance, str(uuid.uuid4()))
                transition_instance_state(db, instance, 'hibernated')
        else:
            _run_ssm_command(instance_id, ['set -eu', 'sync'])
            ec2.stop_instances(InstanceIds=[instance_id])
            ec2.get_waiter('instance_stopped').wait(
                InstanceIds=[instance_id],
                WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
            )
            transition_instance_state(db, instance, 'hibernated')
        aws_state = 'stopped'
    elif aws_state not in ('stopped', 'terminated'):
        raise LifecycleError(f'AWS instance {instance_id} is in unsupported state {aws_state}')

    if instance.aws_volume_id:
        volume_response = ec2.describe_volumes(VolumeIds=[instance.aws_volume_id])
        volumes = volume_response.get('Volumes', [])
        if not volumes:
            raise LifecycleError(f'EBS volume {instance.aws_volume_id} was not found')
        attachments = volumes[0].get('Attachments', [])
        if any(item.get('InstanceId') != instance_id for item in attachments):
            raise LifecycleError(f'EBS volume {instance.aws_volume_id} is attached to another EC2 instance')
        if attachments:
            if any(item.get('State') == 'detaching' for item in attachments):
                _wait_for_volume_state(ec2, instance.aws_volume_id, 'available')
            else:
                if aws_state not in ('stopped', 'terminated'):
                    raise LifecycleError('Cannot safely detach EBS storage before EC2 stops')
                ec2.detach_volume(VolumeId=instance.aws_volume_id, InstanceId=instance_id, Force=False)
                _wait_for_volume_state(ec2, instance.aws_volume_id, 'available')

    if aws_state != 'terminated':
        ec2.terminate_instances(InstanceIds=[instance_id])
        ec2.get_waiter('instance_terminated').wait(
            InstanceIds=[instance_id],
            WaiterConfig={'Delay': max(1, int(AWS_POLL_SECONDS)), 'MaxAttempts': max(1, AWS_OPERATION_TIMEOUT // max(1, int(AWS_POLL_SECONDS)))},
        )
    transition_instance_state(db, instance, 'stopped')


def terminate_workspace(db, instance):
    try:
        return _terminate_workspace(db, instance)
    except LifecycleError:
        raise
    except (BotoCoreError, ClientError) as exc:
        raise _report_aws_failure('workspace termination', instance.id, exc) from exc


def cloud_metrics(instance):
    if not aws_lifecycle_enabled():
        return {'cpu': instance.cpu_load, 'memory': None}
    instance_id = _aws_instance_id(instance)
    cloudwatch = _aws_client('cloudwatch')
    end = datetime.now(timezone.utc)
    start = end.timestamp() - 300
    metrics = {}
    for metric_name, key, namespace in (
        ('CPUUtilization', 'cpu', 'AWS/EC2'),
        ('mem_used_percent', 'memory_percent', 'CWAgent'),
        ('mem_used', 'memory_mb', 'CWAgent'),
    ):
        response = cloudwatch.get_metric_statistics(
            Namespace=namespace,
            MetricName=metric_name,
            Dimensions=[{'Name': 'InstanceId', 'Value': instance_id}],
            StartTime=datetime.fromtimestamp(start, timezone.utc),
            EndTime=end,
            Period=60,
            Statistics=['Average'],
        )
        datapoints = sorted(response.get('Datapoints', []), key=lambda point: point['Timestamp'])
        metrics[key] = datapoints[-1]['Average'] if datapoints else None
    return metrics


def live_session_state(instance):
    if not aws_lifecycle_enabled():
        return {
            'available': False,
            'reason': 'Live process and tmux inspection requires the AWS lifecycle connection.',
        }
    if instance.state not in ('running', 'idle'):
        raise LifecycleError('Workspace must be running to inspect its live session')
    script = (
        'import json, subprocess\n'
        'processes = subprocess.run(["ps", "-eo", "pid,ppid,comm", "--forest"], '
        'capture_output=True, text=True, check=True).stdout\n'
        'try:\n'
        ' tmux_output = subprocess.run(["tmux", "list-sessions", "-F", '
        '"#{session_name}:#{session_windows}"], capture_output=True, text=True, check=True).stdout\n'
        ' sessions = [line for line in tmux_output.splitlines() if line.strip()]\n'
        'except (FileNotFoundError, subprocess.CalledProcessError):\n'
        ' sessions = []\n'
        'print("SESSION_STATE:" + json.dumps({"processes": processes[-12000:], '
        '"tmux_sessions": sessions}))\n'
    )
    output = _run_ssm_command(
        _aws_instance_id(instance),
        ['set -eu', f'python3 -c {shlex.quote(script)}'],
    )
    payload = next(
        (line[len('SESSION_STATE:'):] for line in output.splitlines() if line.startswith('SESSION_STATE:')),
        None,
    )
    if payload is None:
        raise LifecycleError('Remote session inspection returned no process state')
    try:
        result = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise LifecycleError('Remote session inspection returned invalid state') from exc
    return {'available': True, **result}


def isolate_instance(db, instance, memory_percent=None):
    if aws_lifecycle_enabled():
        group_id = os.getenv('AWS_QUARANTINE_SECURITY_GROUP_ID')
        if not group_id:
            raise LifecycleError('AWS_QUARANTINE_SECURITY_GROUP_ID is required for isolation')
        _aws_client('ec2').modify_instance_attribute(
            InstanceId=_aws_instance_id(instance),
            Groups=[group_id],
        )
    instance.has_anomaly = True
    transition_instance_state(db, instance, 'isolated')
    memory = 'unknown' if memory_percent is None else f'{memory_percent:.1f}%'
    return (
        f'Off-hours anomaly isolated: workspace={instance.id}, '
        f'cpu={instance.cpu_load:.1f}%, memory={memory}, '
        f'shift={instance.shift_start}-{instance.shift_end}'
    )


def send_alert(message):
    webhook_url = os.getenv('SLACK_WEBHOOK_URL')
    if not webhook_url:
        logger.warning('Lifecycle alert: %s', message)
        return False
    request = Request(
        webhook_url,
        data=json.dumps({'text': message}).encode('utf-8'),
        headers={'Content-Type': 'application/json'},
        method='POST',
    )
    try:
        with urlopen(request, timeout=5) as response:
            if response.status < 200 or response.status >= 300:
                raise LifecycleError(f'Slack alert returned HTTP {response.status}')
    except URLError as exc:
        logger.exception('Slack alert delivery failed')
        raise LifecycleError('Slack alert delivery failed') from exc
    return True


def serialize(instance):
    return dict(
        id=instance.id,
        name=instance.name,
        type=instance.instance_type,
        owner=instance.owner_id,
        state=instance.state,
        cpu=instance.cpu_load,
        cost=RATES.get(instance.instance_type, 0)
        if instance.state in ('running', 'idle', 'isolated') else 0,
        hourly_rate=RATES.get(instance.instance_type),
        exempt=instance.is_exempt,
        snoozed=instance.is_snoozed,
        anomaly=instance.has_anomaly,
        memory_mb=instance.memory_usage_mb,
        memory_percent=instance.memory_percent,
        telemetry_updated_at=instance.telemetry_updated_at,
        shift_active=in_shift(instance),
        shift=f'{instance.shift_start} - {instance.shift_end}',
        shift_start=instance.shift_start,
        shift_end=instance.shift_end,
        timezone=os.getenv('SHIFT_TIMEZONE', 'UTC'),
        demo_enabled=bool(demo_available() and instance.demo_enabled),
        demo_time=instance.demo_time if demo_available() and instance.demo_enabled else None,
    )


def analytics(fleet, snapshots):
    compute = sum(i['cost'] for i in fleet)
    baseline = sum(RATES.get(i['type'], 0) for i in fleet)
    storage_gb = sum(s.size_mb or 0 for s in snapshots) / 1024
    storage_month = storage_gb * SNAPSHOT_RATE
    eligible = [i for i in fleet if not i['exempt']]
    return dict(
        compute_hourly=round(compute, 6),
        compute_daily=round(compute * 24, 6),
        snapshot_gb=round(storage_gb, 6),
        snapshot_monthly=round(storage_month, 6),
        total_daily=round(compute * 24 + storage_month / 30, 6),
        daily_savings=round((baseline - compute) * 24 - storage_month / 30, 6),
        downscale_rate=round(
            100 * sum(i['state'] == 'hibernated' for i in eligible) / len(eligible), 1
        ) if eligible else 0,
        exempt_nodes=sum(i['exempt'] for i in fleet),
        currency='USD',
        billing_basis='configured AWS On-Demand rate projection; 30-day month; not billed usage',
        snapshot_gb_month_rate=SNAPSHOT_RATE,
    )
