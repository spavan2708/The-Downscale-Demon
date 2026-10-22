"""Durable workspace-agent protocol. Disabled unless explicitly enabled."""
import asyncio
import hashlib
import hmac
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, ValidationError, field_validator
import redis

from database import AgentCommandDB, AgentCredentialDB, InstanceDB, SessionLocal
from engine import emit, safe_downscale, send_alert, transition_instance_state

logger = logging.getLogger(__name__)
telemetry_cache = redis.Redis.from_url(
    os.getenv('REDIS_URL', 'redis://redis:6379/0'),
    socket_connect_timeout=0.5, socket_timeout=0.5,
)


def enabled():
    return (
        os.getenv('AGENT_CONTROL_ENABLED', '0') == '1'
        and (os.getenv('AGENT_TLS_READY', '0') == '1'
             or os.getenv('AGENT_ALLOW_INSECURE', '0') == '1')
    )


def now():
    return datetime.now(timezone.utc).isoformat()


class AgentTelemetry(BaseModel):
    type: str = 'TELEMETRY'
    cpu_percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    memory_mb: float = Field(ge=0, allow_inf_nan=False)
    memory_percent: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    observed_at: datetime
    user_active: bool

    @field_validator('observed_at')
    @classmethod
    def valid_time(cls, value):
        if value.tzinfo is None or value.timestamp() > time.time() + 60:
            raise ValueError('observed_at must be timezone-aware and not in the future')
        return value.astimezone(timezone.utc)


def rotate_credential(instance_id):
    token = secrets.token_urlsafe(32)
    with SessionLocal() as db:
        if not db.get(InstanceDB, instance_id):
            raise HTTPException(404, 'Workspace not found')
        row = db.get(AgentCredentialDB, instance_id)
        if row is None:
            row = AgentCredentialDB(instance_id=instance_id)
            db.add(row)
        row.token_hash = hashlib.sha256(token.encode()).hexdigest()
        row.issued_at = now()
        db.commit()
    return token


def valid_credential(instance_id, token):
    with SessionLocal() as db:
        row = db.get(AgentCredentialDB, instance_id)
        return bool(row and isinstance(token, str) and hmac.compare_digest(
            row.token_hash, hashlib.sha256(token.encode()).hexdigest()))


def record_telemetry(instance_id, payload):
    packet = AgentTelemetry.model_validate(payload)
    with SessionLocal() as db:
        instance = db.query(InstanceDB).filter_by(id=instance_id).with_for_update().first()
        if not instance:
            raise HTTPException(404, 'Workspace not found')
        observed_at = packet.observed_at.isoformat()
        if instance.telemetry_updated_at:
            previous = datetime.fromisoformat(instance.telemetry_updated_at)
            if previous.tzinfo is None:
                previous = previous.replace(tzinfo=timezone.utc)
            if packet.observed_at <= previous:
                return False
        instance.cpu_load = packet.cpu_percent
        instance.memory_usage_mb = packet.memory_mb
        instance.memory_percent = packet.memory_percent
        instance.telemetry_updated_at = observed_at
        instance.activity_observed_at = observed_at
        if packet.user_active:
            instance.last_user_activity_at = observed_at
        emit(db, instance_id, 'TELEMETRY_UPDATED', 'workspace-agent')
        db.commit()
        try:
            telemetry_cache.setex(f'telemetry:{instance_id}', 120, packet.model_dump_json())
        except redis.RedisError:
            logger.warning('Agent telemetry cache unavailable for %s', instance_id)
        return True


def enqueue_pause(db, instance_id, target_state='hibernated'):
    existing = db.query(AgentCommandDB).filter(
        AgentCommandDB.instance_id == instance_id,
        AgentCommandDB.status.in_(['pending', 'acknowledged']),
    ).first()
    if existing:
        return existing
    command = AgentCommandDB(id=str(uuid.uuid4()), instance_id=instance_id,
        action='PREPARE_PAUSE', target_state=target_state, status='pending', attempts=0,
        created_at=now(), updated_at=now())
    db.add(command)
    emit(db, instance_id, 'AGENT_COMMAND_PENDING', 'scheduler', command.id)
    return command


def next_command(instance_id):
    with SessionLocal() as db:
        command = db.query(AgentCommandDB).filter_by(
            instance_id=instance_id, status='pending',
        ).order_by(AgentCommandDB.created_at).with_for_update().first()
        if not command:
            return None
        elapsed = (datetime.now(timezone.utc) - datetime.fromisoformat(command.updated_at)).total_seconds()
        if command.attempts and elapsed < 30:
            return None
        if command.attempts >= 3:
            command.status = 'failed'
            command.last_error = 'Agent acknowledgment timed out'
            command.updated_at = now()
            db.commit()
            send_alert(f'Agent command timed out: {command.instance_id} {command.id}')
            return None
        command.attempts += 1
        command.updated_at = now()
        result = {'type': 'COMMAND', 'id': command.id, 'action': command.action}
        db.commit()
        return result


def expire_undelivered_commands(db):
    current = datetime.now(timezone.utc)
    commands = db.query(AgentCommandDB).filter_by(status='pending', attempts=0).all()
    for command in commands:
        if (current - datetime.fromisoformat(command.created_at)).total_seconds() > 600:
            command.status = 'failed'
            command.last_error = 'No agent connected within ten minutes'
            command.updated_at = now()
            logger.error('Agent did not connect for command %s', command.id)
            send_alert(f'Agent unavailable for workspace {command.instance_id}')


def acknowledge(instance_id, command_id, prepared, detail=None):
    with SessionLocal() as db:
        command = db.query(AgentCommandDB).filter_by(
            id=command_id, instance_id=instance_id,
        ).with_for_update().first()
        if not command:
            raise HTTPException(404, 'Command not found')
        if command.status in ('completed', 'failed'):
            return command.status
        if command.status != 'pending':
            return command.status
        if not prepared:
            command.last_error = (str(detail) if detail else 'Agent refused preparation')[:500]
            command.updated_at = now()
            if command.attempts >= 3:
                command.status = 'failed'
                send_alert(f'Agent preparation failed: {instance_id} {command.id}')
            db.commit()
            return command.status
        command.status = 'acknowledged'
        command.updated_at = now()
        db.commit()
    try:
        with SessionLocal() as db:
            instance = db.query(InstanceDB).filter_by(id=instance_id).with_for_update().one()
            safe_downscale(db, instance)
            command = db.get(AgentCommandDB, command_id)
            if command.target_state == 'stopped':
                transition_instance_state(db, instance, 'stopped')
            command.status = 'completed'
            command.updated_at = now()
            emit(db, instance_id, 'AGENT_COMMAND_COMPLETED', 'workspace-agent', command_id)
            db.commit()
            return 'completed'
    except Exception as exc:
        logger.exception('Agent downscale failed for %s', instance_id)
        with SessionLocal() as db:
            command = db.get(AgentCommandDB, command_id)
            command.status = 'failed'
            command.last_error = str(exc)[:500]
            command.updated_at = now()
            db.commit()
        send_alert(f'Agent downscale failed for {instance_id}: {type(exc).__name__}')
        return 'failed'


async def agent_websocket(websocket: WebSocket, instance_id: str):
    await websocket.accept()
    if not enabled():
        await websocket.close(code=4403)
        return
    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        if not isinstance(first, dict) or not valid_credential(instance_id, first.get('token')):
            await websocket.close(code=4401)
            return
        await websocket.send_json({'type': 'AGENT_CONNECTED', 'instance_id': instance_id})
        while True:
            if not valid_credential(instance_id, first['token']):
                await websocket.close(code=4401)
                return
            command = next_command(instance_id)
            if command:
                await websocket.send_json(command)
            try:
                message = await asyncio.wait_for(websocket.receive_json(), timeout=1)
            except asyncio.TimeoutError:
                continue
            if not isinstance(message, dict):
                continue
            if message.get('type') == 'TELEMETRY':
                try:
                    accepted = record_telemetry(instance_id, message)
                    await websocket.send_json({'type': 'TELEMETRY_ACK', 'accepted': accepted})
                except ValidationError:
                    await websocket.send_json({'type': 'ERROR', 'detail': 'Invalid telemetry'})
            elif message.get('type') == 'COMMAND_ACK':
                if not isinstance(message.get('prepared'), bool):
                    await websocket.send_json({'type': 'ERROR', 'detail': 'Invalid command acknowledgment'})
                    continue
                try:
                    status = acknowledge(instance_id, str(message.get('id', '')),
                                         message['prepared'], message.get('detail'))
                    await websocket.send_json({'type': 'COMMAND_RESULT', 'id': message.get('id'), 'status': status})
                except HTTPException as exc:
                    await websocket.send_json({'type': 'ERROR', 'detail': exc.detail})
    except (WebSocketDisconnect, RuntimeError, OSError):
        return
