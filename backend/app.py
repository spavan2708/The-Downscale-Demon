import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import asyncio
import base64
import json
import hashlib
import logging
import re
import secrets
import time
import uuid
from types import SimpleNamespace
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, ValidationError, field_validator
import redis
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from database import engine as database_engine, SessionLocal, UserDB, InstanceDB, SnapshotDB, SessionDB, EventDB, InvitationDB, SupportRequestDB, AnnouncementDB
from auth import current_user, authenticate, password_hash, verify_password, visible_query, require_instance, role_rank
from agent_control import agent_websocket, enabled as agent_control_enabled, enqueue_pause, rotate_credential
from engine import (
    LifecycleError,
    analytics,
    aws_lifecycle_enabled,
    complete_buffered_request,
    demo_available,
    emit,
    hibernate,
    in_shift,
    forward_request,
    live_session_state,
    queue_request_and_wake,
    safe_downscale,
    serialize,
    snapshot_payload,
    instance_now,
    runtime_summary,
    terminate_workspace,
    transition_instance_state,
    wake_instance,
)

logger = logging.getLogger(__name__)
app = FastAPI(title='The Downscale Demon API')
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LoginRequest(BaseModel):
    user_id: str
    password: str
    instance_id: str | None = None

class TargetRequest(BaseModel):
    instance_id: str

class ShiftUpdateRequest(TargetRequest):
    shift_start: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    shift_end: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')

class AccessBlockRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    blocked: bool

class DeleteWorkspaceRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    confirmation_name: str = Field(min_length=1, max_length=80)

class StateChangeRequest(TargetRequest):
    target_state: Literal['running', 'hibernated', 'stopped']

    @field_validator('target_state', mode='before')
    @classmethod
    def normalize_command(cls, value):
        return {'Wake': 'running', 'Sleep': 'hibernated', 'Terminate': 'stopped'}.get(value, value) if isinstance(value, str) else value


class TelemetryPacket(TargetRequest):
    cpu_percent: float = Field(ge=0, le=100, allow_inf_nan=False)
    memory_mb: float = Field(ge=0, allow_inf_nan=False)
    memory_percent: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    observed_at: datetime

    @field_validator('observed_at')
    @classmethod
    def validate_observed_at(cls, value):
        if value.tzinfo is None or value.timestamp() > time.time() + 60:
            raise ValueError('observed_at must include a timezone and cannot be in the future')
        return value.astimezone(timezone.utc)


telemetry_cache = redis.Redis.from_url(
    os.getenv('REDIS_URL', 'redis://redis:6379/0'),
    socket_connect_timeout=0.5, socket_timeout=0.5,
)


def ingest_telemetry(payload, user):
    packet = TelemetryPacket.model_validate(payload)
    with SessionLocal() as db:
        instance = require_instance(db, user, packet.instance_id)
        instance = db.query(InstanceDB).filter_by(id=instance.id).with_for_update().one()
        observed_at = packet.observed_at.isoformat()
        if instance.telemetry_updated_at:
            previous = datetime.fromisoformat(instance.telemetry_updated_at)
            if previous.tzinfo is None:
                previous = previous.replace(tzinfo=timezone.utc)
            if packet.observed_at <= previous:
                return {'type': 'TELEMETRY_ACK', 'instance_id': instance.id, 'accepted': False}
        instance.cpu_load = packet.cpu_percent
        instance.memory_usage_mb = packet.memory_mb
        instance.memory_percent = packet.memory_percent
        instance.telemetry_updated_at = observed_at
        emit(db, instance.id, 'TELEMETRY_UPDATED', user.id, json.dumps(packet.model_dump(mode='json')))
        db.commit()
        try:
            telemetry_cache.setex(f'telemetry:{instance.id}', 120, packet.model_dump_json())
        except redis.RedisError:
            logger.warning('Telemetry cache unavailable for %s', instance.id)
        return {'type': 'TELEMETRY_ACK', 'instance_id': instance.id, 'accepted': True}

class WorkspaceRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r'^[A-Za-z0-9 _-]+$')
    instance_type: Literal['t3.medium', 'c5.xlarge', 'r5.large']
    shift_start: str = Field(default='09:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    shift_end: str = Field(default='18:00', pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    aws_instance_id: str | None = Field(default=None, pattern=r'^i-[0-9a-fA-F]{8,17}$')
    aws_volume_id: str | None = Field(default=None, pattern=r'^vol-[0-9a-fA-F]+$')

class EmployeeRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)
    team_id: str = Field(min_length=1, max_length=80)
    role: Literal['employee', 'manager', 'team_lead'] = 'employee'
    instances: list[WorkspaceRequest] = Field(min_length=1, max_length=20)

class AddWorkspacesRequest(BaseModel):
    instances: list[WorkspaceRequest] = Field(min_length=1, max_length=20)

class SupportRequestCreate(BaseModel):
    model_config = {'extra': 'forbid'}
    request_type: Literal['overtime', 'storage', 'issue']
    subject: str = Field(min_length=4, max_length=120)
    details: str = Field(min_length=10, max_length=3000)
    instance_id: str | None = None
    extension_hours: int | None = Field(default=None, ge=1, le=12)

class SupportRequestDecision(BaseModel):
    model_config = {'extra': 'forbid'}
    status: Literal['approved', 'rejected', 'in_progress', 'resolved']
    response: str | None = Field(default=None, max_length=2000)

class OvertimeDecisionRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    response: str | None = Field(default=None, max_length=2000)

class WorkspaceAssignmentRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    user_id: str = Field(min_length=1, max_length=80)

class AnnouncementCreate(BaseModel):
    model_config = {'extra': 'forbid'}
    category: Literal['maintenance', 'announcement', 'policy'] = 'announcement'
    title: str = Field(min_length=4, max_length=120)
    body: str = Field(min_length=10, max_length=3000)
    team_id: str | None = None
    expires_at: datetime | None = None


def support_request_payload(request):
    return {
        'id': request.id,
        'owner_id': request.owner_id,
        'team_id': request.team_id,
        'instance_id': request.instance_id,
        'request_type': request.request_type,
        'extension_hours': request.extension_hours,
        'subject': request.subject,
        'details': request.details,
        'status': request.status,
        'response': request.response,
        'created_at': request.created_at,
        'updated_at': request.updated_at,
    }


def announcement_payload(announcement):
    return {
        'id': announcement.id,
        'category': announcement.category,
        'title': announcement.title,
        'body': announcement.body,
        'created_at': announcement.created_at,
        'expires_at': announcement.expires_at,
        'team_id': announcement.team_id,
    }


def user_payload(user):
    role_title = {
        'employee': 'Employee',
        'manager': 'Team Lead',
        'team_lead': 'Team Lead',
        'admin': 'Chief Architect',
        'chief_architect': 'Chief Architect',
    }.get(user.role, user.role)
    return dict(id=user.id, name=user.name, role=user.role, role_title=role_title, team_id=user.team_id)

def issue_session(db, user, instance_id=None):
    if user.access_blocked:
        raise HTTPException(403, 'Account access is blocked. Contact your Team Lead or Chief Architect.')
    token = secrets.token_urlsafe(32)
    db.add(SessionDB(
        token_hash=hashlib.sha256(token.encode()).hexdigest(),
        user_id=user.id,
        expires_at=time.time() + 28800,
        instance_id=instance_id,
    ))
    return token


def _parse_extension_hours(subject, details):
    words = {
        'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6,
        'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10, 'eleven': 11, 'twelve': 12,
    }
    match = re.search(
        r'\+?\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:hours?|hrs?)\b',
        f'{subject} {details}',
        re.IGNORECASE,
    )
    if not match:
        return None
    value = match.group(1).lower()
    return int(value) if value.isdigit() else words[value]


def _require_governance_request_access(request, user):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if role_rank(user) == 2 and request.team_id != user.team_id:
        raise HTTPException(404, 'Support request not found')


def _approve_overtime_request(db, request, user, response=None):
    if request.request_type != 'overtime':
        raise HTTPException(400, 'Only overtime requests can extend a shift')
    if request.status != 'open':
        raise HTTPException(409, 'This request has already been decided')
    if not request.instance_id:
        raise HTTPException(422, 'Overtime request must target a workspace')
    if not request.extension_hours or not 1 <= request.extension_hours <= 12:
        raise HTTPException(422, 'Overtime request must specify an extension from 1 to 12 hours')
    instance = db.get(InstanceDB, request.instance_id)
    if not instance or instance.owner_id != request.owner_id:
        raise HTTPException(409, 'Overtime request workspace is no longer assigned to its employee')
    if instance.shift_start == instance.shift_end:
        raise HTTPException(409, 'Workspace already has a 24-hour shift window')
    end_hour, end_minute = map(int, instance.shift_end.split(':'))
    extended_minutes = (end_hour * 60 + end_minute + request.extension_hours * 60) % (24 * 60)
    previous_end = instance.shift_end
    instance.shift_end = f'{extended_minutes // 60:02d}:{extended_minutes % 60:02d}'
    request.status = 'approved'
    request.response = (response or f'Approved for {request.extension_hours} additional hour(s).').strip()
    request.updated_at = datetime.now(timezone.utc).isoformat()
    details = json.dumps({
        'request_id': request.id,
        'owner_id': request.owner_id,
        'extension_hours': request.extension_hours,
        'previous_shift_end': previous_end,
        'shift_end': instance.shift_end,
    })
    emit(db, instance.id, 'SHIFT_EXTENDED', user.id, details)
    emit(db, instance.id, 'SHIFT_UPDATED', user.id, details)
    emit(db, instance.id, 'SUPPORT_REQUEST_UPDATED', user.id, f'{request.id}: approved')
    emit(db, instance.id, 'FLEET_UPDATED', user.id, 'Approved overtime shift extension')
    return request, instance


def _reject_overtime_request(db, request, user, response=None):
    if request.request_type != 'overtime':
        raise HTTPException(400, 'Only overtime requests can be rejected here')
    if request.status != 'open':
        raise HTTPException(409, 'This request has already been decided')
    request.status = 'rejected'
    request.response = (response or 'Overtime request rejected.').strip()
    request.updated_at = datetime.now(timezone.utc).isoformat()
    event_details = f'{request.id}: rejected'
    emit(db, request.instance_id, 'SUPPORT_REQUEST_UPDATED', user.id, event_details)
    emit(db, request.instance_id, 'OVERTIME_REJECTED', user.id, event_details)
    return request


def _serialize_access_mode(db, instances):
    ids = [instance.id for instance in instances]
    now = datetime.now(timezone.utc).timestamp()
    active_sessions = {}
    if ids:
        rows = db.query(SessionDB, UserDB).join(
            UserDB, UserDB.id == SessionDB.user_id,
        ).filter(
            SessionDB.instance_id.in_(ids),
            SessionDB.expires_at > now,
            UserDB.access_blocked.is_(False),
        ).order_by(SessionDB.expires_at.desc()).all()
        for session, user in rows:
            active_sessions.setdefault(session.instance_id, user)
    output = []
    for instance in instances:
        active_user = active_sessions.get(instance.id) if instance.state in ('running', 'idle') else None
        output.append({
            **serialize(instance),
            'access_mode': active_user is not None,
            'active_user': active_user.name if active_user else None,
            'active_user_id': active_user.id if active_user else None,
        })
    return output


def downscale_or_503(db, instance):
    try:
        return safe_downscale(db, instance)
    except LifecycleError as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post('/api/auth/login')
def auth_login(req: LoginRequest):
    with SessionLocal() as db:
        user = db.get(UserDB, req.user_id)
        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(401, 'Invalid credentials')
        if user.access_blocked:
            raise HTTPException(403, 'Account access is blocked. Contact your Team Lead or Chief Architect.')
        token = issue_session(db, user)
        db.commit()
        return dict(success=True, access_token=token, token_type='bearer', user=user_payload(user))

class ChiefArchitectSignupRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    user_id: str = Field(min_length=1, max_length=80, pattern=r'^\S+$')
    name: str = Field(min_length=1, max_length=80, pattern=r'.*\S.*')
    password: str = Field(min_length=12, max_length=128)

@app.post('/api/auth/signup/chief-architect', status_code=201)
def chief_architect_signup(req: ChiefArchitectSignupRequest):
    encoded = password_hash(req.password)
    with SessionLocal() as db:
        if database_engine.dialect.name == 'sqlite':
            db.execute(text('BEGIN IMMEDIATE'))
        elif database_engine.dialect.name == 'postgresql':
            db.execute(text('SELECT pg_advisory_xact_lock(8675309)'))
        if db.query(UserDB).filter(UserDB.role.in_(['admin', 'chief_architect'])).first():
            raise HTTPException(409, 'A Chief Architect already exists. Please sign in with that account.')
        if db.get(UserDB, req.user_id):
            raise HTTPException(409, 'User ID already exists')
        user = UserDB(id=req.user_id, name=req.name.strip(), role='admin',
            team_id='platform', password_hash=encoded)
        db.add(user)
        token = issue_session(db, user)
        db.commit()
        return dict(success=True, access_token=token, token_type='bearer', user=user_payload(user))

class InvitationRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=80)
    team_id: str = Field(min_length=1, max_length=80)
    role: Literal['employee', 'manager', 'team_lead'] = 'employee'
    instances: list[WorkspaceRequest] = Field(min_length=1, max_length=20)

class SignupRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    invitation_token: str = Field(min_length=1, max_length=200)
    user_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)

@app.post('/api/invitations', status_code=201)
def invite(req: InvitationRequest, user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if role_rank(user) == 2 and (not user.team_id or req.team_id != user.team_id or req.role != 'employee'):
        raise HTTPException(403, 'Team Leads may invite employees only within their assigned team')
    if role_rank(user) < 3 and any(
        workspace.aws_instance_id or workspace.aws_volume_id for workspace in req.instances
    ):
        raise HTTPException(403, 'Only Chief Architects may bind AWS resources')
    with SessionLocal() as db:
        if db.get(UserDB, req.user_id):
            raise HTTPException(409, 'User ID already exists')
        token = secrets.token_urlsafe(32)
        expiry = time.time() + 86400
        db.add(InvitationDB(token_hash=hashlib.sha256(token.encode()).hexdigest(),
            user_id=req.user_id, team_id=req.team_id, role=req.role,
            workspaces_json=json.dumps([s.model_dump() for s in req.instances]), expires_at=expiry))
        db.commit()
        return dict(invitation_token=token, user_id=req.user_id, expires_at=expiry)

@app.post('/api/auth/signup', status_code=201)
def signup(req: SignupRequest):
    digest = hashlib.sha256(req.invitation_token.encode()).hexdigest()
    with SessionLocal() as db:
        # Conditional update makes redemption single-use, including concurrent requests.
        claimed = db.query(InvitationDB).filter(InvitationDB.token_hash == digest,
            InvitationDB.user_id == req.user_id, InvitationDB.used == False,
            InvitationDB.expires_at > time.time()).update({'used': True}, synchronize_session=False)
        if not claimed:
            raise HTTPException(400, 'Invalid, expired, or already used invitation')
        invitation = db.get(InvitationDB, digest)
        user = UserDB(id=req.user_id, name=req.name, role=invitation.role,
            team_id=invitation.team_id, password_hash=password_hash(req.password))
        db.add(user)
        ids = []
        for spec in json.loads(invitation.workspaces_json):
            identifier = 'i-' + uuid.uuid4().hex[:17]
            db.add(InstanceDB(id=identifier, aws_instance_id=spec.get('aws_instance_id'),
                aws_volume_id=spec.get('aws_volume_id'), owner_id=user.id,
                name=spec['name'], instance_type=spec['instance_type'],
                shift_start=spec['shift_start'], shift_end=spec['shift_end']))
            ids.append(identifier)
            emit(db, identifier)
        token = issue_session(db, user)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'User ID already exists')
        return dict(success=True, access_token=token, token_type='bearer',
            user=user_payload(user), instance_ids=ids)

@app.get('/api/me')
def me(user=Depends(current_user)):
    return user_payload(user)

@app.get('/api/instances')
def read_instances(user=Depends(current_user)):
    with SessionLocal() as db:
        records = visible_query(db, user).all()
        snapshots = db.query(SnapshotDB).filter(SnapshotDB.instance_id.in_([i.id for i in records])).all()
        fleet = _serialize_access_mode(db, records)
        return dict(fleet=fleet, analytics=analytics(fleet, snapshots),
                    demo_available=demo_available(), timezone=os.getenv('SHIFT_TIMEZONE', 'UTC'),
                    aws_lifecycle_enabled=aws_lifecycle_enabled(),
                    snapshots=[snapshot_payload(s) for s in snapshots])


@app.get('/api/instance/session-state/{instance_id}')
def read_session_state(instance_id: str, user=Depends(current_user)):
    with SessionLocal() as db:
        instance = require_instance(db, user, instance_id)
        try:
            live_state = live_session_state(instance)
        except LifecycleError as exc:
            raise HTTPException(503, str(exc)) from exc
        snapshot = db.query(SnapshotDB).filter(
            SnapshotDB.instance_id == instance.id,
        ).order_by(SnapshotDB.created_at.desc()).first()
        return {
            'instance_id': instance.id,
            'state': instance.state,
            'available': live_state['available'],
            'reason': live_state.get('reason'),
            'processes': live_state.get('processes'),
            'tmux_sessions': live_state.get('tmux_sessions'),
            'restored_ram_history_mb': snapshot.memory_footprint_mb if snapshot else None,
            'checkpoint_created_at': snapshot.created_at if snapshot else None,
        }


@app.get('/api/employee/inbox')
def employee_inbox(user=Depends(current_user)):
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    with SessionLocal() as db:
        instances = visible_query(db, user).filter(InstanceDB.owner_id == user.id).all()
        announcements = db.query(AnnouncementDB).filter(
            AnnouncementDB.team_id.is_(None) | (AnnouncementDB.team_id == user.team_id),
        ).order_by(AnnouncementDB.created_at.desc()).limit(100).all()
        announcements = [
            item for item in announcements
            if not item.expires_at or datetime.fromisoformat(item.expires_at) > now
        ]
        requests = db.query(SupportRequestDB).filter(
            SupportRequestDB.owner_id == user.id,
            SupportRequestDB.status != 'open',
        ).order_by(SupportRequestDB.updated_at.desc()).limit(100).all()
        notifications = [announcement_payload(item) for item in announcements]
        for request in requests:
            if request.status in ('approved', 'rejected', 'resolved'):
                notifications.append({
                    'id': f'request:{request.id}',
                    'category': 'request',
                    'title': f'{request.request_type.title()} request {request.status}',
                    'body': request.response or request.subject,
                    'created_at': request.updated_at,
                    'expires_at': None,
                    'team_id': request.team_id,
                })
        for instance in instances:
            if instance.state not in ('running', 'idle') or instance.is_exempt or instance.is_snoozed:
                continue
            start_hour, start_minute = map(int, instance.shift_start.split(':'))
            end_hour, end_minute = map(int, instance.shift_end.split(':'))
            if instance.shift_start == instance.shift_end:
                continue
            local_now = instance_now(instance)
            current = local_now.hour * 60 + local_now.minute + local_now.second / 60
            start = start_hour * 60 + start_minute
            end = end_hour * 60 + end_minute
            active = start <= current < end if start < end else current >= start or current < end
            remaining = (end - current) % 1440 if active else 0
            if 0 < remaining <= 15:
                minutes = max(1, int(remaining))
                notifications.append({
                    'id': f'shift:{instance.id}:{local_now.date().isoformat()}',
                    'category': 'shift',
                    'title': 'Shift ending soon',
                    'body': f'{instance.name} is scheduled to hibernate in {minutes} minute(s), at {instance.shift_end}.',
                    'created_at': now_iso,
                    'expires_at': None,
                    'team_id': user.team_id,
                })
        requests_query = db.query(SupportRequestDB)
        if role_rank(user) >= 3:
            pass
        elif role_rank(user) == 2:
            requests_query = requests_query.filter(SupportRequestDB.team_id == user.team_id)
        else:
            requests_query = requests_query.filter(SupportRequestDB.owner_id == user.id)
        support_requests = requests_query.order_by(SupportRequestDB.created_at.desc()).limit(100).all()
        return {
            'announcements': sorted(notifications, key=lambda item: item['created_at'], reverse=True),
            'requests': [support_request_payload(item) for item in support_requests],
        }


@app.post('/api/support/requests', status_code=201)
def create_support_request(req: SupportRequestCreate, user=Depends(current_user)):
    subject = req.subject.strip()
    details = req.details.strip()
    if len(subject) < 4 or len(details) < 10:
        raise HTTPException(422, 'Subject or details are too short after trimming whitespace')
    with SessionLocal() as db:
        if req.instance_id:
            require_instance(db, user, req.instance_id)
        now = datetime.now(timezone.utc).isoformat()
        request = SupportRequestDB(
            id=str(uuid.uuid4()),
            owner_id=user.id,
            team_id=user.team_id,
            instance_id=req.instance_id,
            request_type=req.request_type,
            extension_hours=(
                req.extension_hours if req.extension_hours is not None
                else _parse_extension_hours(subject, details) if req.request_type == 'overtime'
                else None
            ),
            subject=subject,
            details=details,
            status='open',
            created_at=now,
            updated_at=now,
        )
        db.add(request)
        if req.instance_id:
            emit(db, req.instance_id, 'SUPPORT_REQUEST_CREATED', user.id, request.request_type)
        else:
            emit(db, None, 'SUPPORT_REQUEST_CREATED', user.id, request.request_type)
        db.commit()
        return support_request_payload(request)


@app.post('/api/support/requests/{request_id}/decision')
def decide_support_request(request_id: str, req: SupportRequestDecision, user=Depends(current_user)):
    with SessionLocal() as db:
        request = db.get(SupportRequestDB, request_id)
        if not request:
            raise HTTPException(404, 'Support request not found')
        _require_governance_request_access(request, user)
        if request.request_type == 'overtime' and req.status == 'approved':
            _approve_overtime_request(db, request, user, req.response)
            db.commit()
            return support_request_payload(request)
        if request.request_type == 'overtime' and req.status in ('rejected',):
            _reject_overtime_request(db, request, user, req.response)
            db.commit()
            return support_request_payload(request)
        if request.status != 'open':
            raise HTTPException(409, 'This request has already been decided')
        request.status = req.status
        request.response = req.response.strip() if req.response else None
        request.updated_at = datetime.now(timezone.utc).isoformat()
        if request.instance_id:
            emit(db, request.instance_id, 'SUPPORT_REQUEST_UPDATED', user.id, f'{request.id}: {request.status}')
        else:
            emit(db, None, 'SUPPORT_REQUEST_UPDATED', user.id, f'{request.id}: {request.status}')
        db.commit()
        return support_request_payload(request)


@app.post('/api/requests/{request_id}/approve')
@app.post('/api/support/requests/{request_id}/approve')
def approve_overtime_request(
    request_id: str,
    req: OvertimeDecisionRequest | None = None,
    user=Depends(current_user),
):
    with SessionLocal() as db:
        request = db.get(SupportRequestDB, request_id)
        if not request:
            raise HTTPException(404, 'Support request not found')
        _require_governance_request_access(request, user)
        approved, instance = _approve_overtime_request(
            db, request, user, req.response if req else None,
        )
        db.commit()
        return {
            'request': support_request_payload(approved),
            'instance_id': instance.id,
            'shift_start': instance.shift_start,
            'shift_end': instance.shift_end,
        }


@app.post('/api/requests/{request_id}/reject')
@app.post('/api/support/requests/{request_id}/reject')
def reject_overtime_request(
    request_id: str,
    req: OvertimeDecisionRequest | None = None,
    user=Depends(current_user),
):
    with SessionLocal() as db:
        request = db.get(SupportRequestDB, request_id)
        if not request:
            raise HTTPException(404, 'Support request not found')
        _require_governance_request_access(request, user)
        rejected = _reject_overtime_request(
            db, request, user, req.response if req else None,
        )
        db.commit()
        return support_request_payload(rejected)


@app.post('/api/announcements', status_code=201)
def create_announcement(req: AnnouncementCreate, user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if role_rank(user) == 2 and (not user.team_id or req.team_id not in (None, user.team_id)):
        raise HTTPException(403, 'Team Leads may announce only to their assigned team')
    team_id = user.team_id if role_rank(user) == 2 else req.team_id
    now = datetime.now(timezone.utc)
    if req.expires_at and req.expires_at.tzinfo is None:
        raise HTTPException(422, 'Announcement expiry must include a timezone')
    if req.expires_at and req.expires_at <= now:
        raise HTTPException(422, 'Announcement expiry must be in the future')
    title = req.title.strip()
    body = req.body.strip()
    if len(title) < 4 or len(body) < 10:
        raise HTTPException(422, 'Announcement title or body is too short after trimming whitespace')
    with SessionLocal() as db:
        announcement = AnnouncementDB(
            id=str(uuid.uuid4()),
            team_id=team_id,
            created_by=user.id,
            category=req.category,
            title=title,
            body=body,
            created_at=now.isoformat(),
            expires_at=req.expires_at.astimezone(timezone.utc).isoformat() if req.expires_at else None,
        )
        db.add(announcement)
        emit(db, None, 'ANNOUNCEMENT_CREATED', user.id, announcement.title)
        db.commit()
        return announcement_payload(announcement)


@app.api_route(
    '/proxy/{instance_id}/{path:path}',
    methods=['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
)
async def edge_proxy(instance_id: str, path: str, request: Request, user=Depends(current_user)):
    if not os.getenv('AWS_LIFECYCLE_ENABLED') == '1':
        raise HTTPException(503, 'AWS edge proxy is disabled on this server')
    body = await request.body()
    allowed_request_headers = {
        'accept',
        'accept-language',
        'content-type',
        'if-modified-since',
        'if-none-match',
        'range',
        'user-agent',
    }
    forwarded_headers = {
        key: value for key, value in request.headers.items()
        if key.lower() in allowed_request_headers
    }
    request_metadata = {
        'method': request.method,
        'path': path,
        'query': request.url.query,
        'headers': forwarded_headers,
        'body_base64': base64.b64encode(body).decode('ascii'),
    }
    with SessionLocal() as db:
        instance = require_instance(db, user, instance_id, enforce_shift=True)
        if instance.state == 'isolated':
            raise HTTPException(423, 'Workspace is isolated')
        asleep = instance.state in ('stopped', 'hibernated')
        if not asleep and instance.state not in ('running', 'idle'):
            raise HTTPException(409, f'Workspace cannot accept requests in state {instance.state}')
        target = SimpleNamespace(
            id=instance.id,
            name=instance.name,
            state=instance.state,
            aws_instance_id=instance.aws_instance_id,
            aws_volume_id=instance.aws_volume_id,
        )
    request_id = None
    if asleep:
        try:
            request_id = await asyncio.to_thread(
                _buffer_and_wake,
                instance_id,
                request_metadata,
            )
        except LifecycleError as exc:
            raise HTTPException(503, str(exc)) from exc
    try:
        status, response_headers, response_body = await asyncio.to_thread(
            forward_request,
            target,
            request.method,
            path,
            request.url.query,
            forwarded_headers,
            body,
        )
    except LifecycleError as exc:
        raise HTTPException(502, str(exc)) from exc
    if request_id:
        try:
            await asyncio.to_thread(complete_buffered_request, request_id)
        except LifecycleError as exc:
            raise HTTPException(503, str(exc)) from exc
    return Response(content=response_body, status_code=status, headers=response_headers)


def _buffer_and_wake(instance_id, request_metadata):
    with SessionLocal() as db:
        instance = db.get(InstanceDB, instance_id)
        if not instance:
            raise LifecycleError(f'Workspace {instance_id} no longer exists')
        request_id = queue_request_and_wake(db, instance, request_metadata)
        db.commit()
        return request_id


class DemoRequest(TargetRequest):
    model_config = {'extra': 'forbid'}
    enabled: bool
    simulated_time: datetime | None = None
    cpu: float = Field(default=4.2, ge=0, le=100, allow_inf_nan=False)
    activity: Literal['running', 'idle'] = 'running'
    evaluate_now: bool = False

@app.post('/api/instance/demo')
def configure_demo(req: DemoRequest, user=Depends(current_user)):
    if not demo_available():
        raise HTTPException(403, 'Demo controls are disabled on this server')
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id)
        clock = req.simulated_time
        if clock:
            zone = ZoneInfo(os.getenv('SHIFT_TIMEZONE', 'UTC'))
            clock = clock.replace(tzinfo=zone) if clock.tzinfo is None else clock.astimezone(zone)
        inst.demo_enabled = req.enabled
        inst.demo_time = clock.isoformat() if req.enabled and clock else None
        powered = inst.state in ('running', 'idle')
        if powered:
            inst.cpu_load = req.cpu if req.enabled else 4.2
            transition_instance_state(db, inst, req.activity if req.enabled else 'running')
        inst.has_anomaly = bool(powered and req.enabled and req.cpu > 85 and not in_shift(inst))
        outcome = 'Demo settings applied' if req.enabled else 'Demo disabled; real server clock restored'
        if (req.evaluate_now or not req.enabled) and powered:
            if not in_shift(inst):
                downscale_or_503(db, inst)
                outcome = 'Outside shift: workspace hibernated and snapshot recorded'
            else:
                outcome = 'Inside shift or exempt: workspace remains powered on'
        elif not powered:
            outcome += '. Workspace remains hibernated/stopped; use Start / Restore to wake it'
        emit(db, inst.id)
        db.commit()
        return dict(instance=serialize(inst), outcome=outcome)

@app.post('/api/employees', status_code=201)
def provision(req: EmployeeRequest, user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if role_rank(user) == 2 and (not user.team_id or req.team_id != user.team_id or req.role != 'employee'):
        raise HTTPException(403, 'Team Leads may provision employees only within their assigned team')
    if role_rank(user) < 3 and any(
        workspace.aws_instance_id or workspace.aws_volume_id for workspace in req.instances
    ):
        raise HTTPException(403, 'Only Chief Architects may bind AWS resources')
    with SessionLocal() as db:
        employee = UserDB(id=req.user_id, name=req.name, role=req.role, team_id=req.team_id, password_hash=password_hash(req.password))
        db.add(employee)
        ids = []
        for spec in req.instances:
            identifier = 'i-' + uuid.uuid4().hex[:17]
            db.add(InstanceDB(
                id=identifier,
                aws_instance_id=spec.aws_instance_id,
                aws_volume_id=spec.aws_volume_id,
                owner_id=req.user_id,
                name=spec.name,
                instance_type=spec.instance_type,
                shift_start=spec.shift_start,
                shift_end=spec.shift_end,
            ))
            ids.append(identifier)
            emit(db, identifier)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'User ID already exists')
        return dict(user=user_payload(employee), instance_ids=ids)

@app.post('/api/employees/{user_id}/workspaces', status_code=201)
def add_workspaces(user_id: str, req: AddWorkspacesRequest, user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    with SessionLocal() as db:
        employee = db.get(UserDB, user_id)
        if not employee:
            raise HTTPException(404, 'Employee not found')
        if role_rank(user) == 2 and (not user.team_id or employee.team_id != user.team_id):
            raise HTTPException(403, 'Team Leads may add workspaces only to employees within their assigned team')
        if role_rank(user) < 3 and any(
            workspace.aws_instance_id or workspace.aws_volume_id for workspace in req.instances
        ):
            raise HTTPException(403, 'Only Chief Architects may bind AWS resources')
        ids = []
        for spec in req.instances:
            identifier = 'i-' + uuid.uuid4().hex[:17]
            db.add(InstanceDB(
                id=identifier,
                aws_instance_id=spec.aws_instance_id,
                aws_volume_id=spec.aws_volume_id,
                owner_id=user_id,
                name=spec.name,
                instance_type=spec.instance_type,
                shift_start=spec.shift_start,
                shift_end=spec.shift_end,
            ))
            ids.append(identifier)
            emit(db, identifier)
        db.commit()
        return dict(instance_ids=ids)

@app.post('/api/workspaces', status_code=201)
def create_unassigned_workspace(req: WorkspaceRequest, user=Depends(current_user)):
    if role_rank(user) < 3:
        raise HTTPException(403, 'Chief Architect required to create an unassigned workspace')
    with SessionLocal() as db:
        instance = InstanceDB(
            id='i-' + uuid.uuid4().hex[:17],
            aws_instance_id=req.aws_instance_id,
            aws_volume_id=req.aws_volume_id,
            owner_id=None,
            name=req.name.strip(),
            instance_type=req.instance_type,
            shift_start=req.shift_start,
            shift_end=req.shift_end,
            state='hibernated',
        )
        db.add(instance)
        emit(db, instance.id, 'FLEET_UPDATED', user.id, 'Unassigned workspace created')
        db.commit()
        return {'instance_id': instance.id, 'workspace': serialize(instance)}

@app.post('/api/workspaces/{instance_id}/assign')
def assign_workspace(instance_id: str, req: WorkspaceAssignmentRequest, user=Depends(current_user)):
    if role_rank(user) < 3:
        raise HTTPException(403, 'Chief Architect required to assign an unallocated workspace')
    with SessionLocal() as db:
        instance = db.query(InstanceDB).filter_by(id=instance_id).with_for_update().first()
        employee = db.get(UserDB, req.user_id)
        if not instance:
            raise HTTPException(404, 'Workspace not found')
        if instance.owner_id is not None:
            raise HTTPException(409, 'Workspace is already assigned')
        if not employee or role_rank(employee) >= 2:
            raise HTTPException(404, 'Employee not found')
        instance.owner_id = employee.id
        emit(db, instance.id, 'FLEET_UPDATED', user.id, f'Workspace assigned to {employee.id}')
        db.commit()
        return {'instance_id': instance.id, 'owner_id': employee.id}


@app.post('/api/workspaces/{instance_id}/agent-credential')
def issue_agent_credential(instance_id: str, user=Depends(current_user)):
    if role_rank(user) < 3:
        raise HTTPException(403, 'Chief Architect required')
    if not agent_control_enabled():
        raise HTTPException(503, 'Agent control is disabled')
    return {'instance_id': instance_id, 'agent_token': rotate_credential(instance_id)}


@app.websocket('/ws/agent/{instance_id}')
async def workspace_agent_socket(websocket: WebSocket, instance_id: str):
    await agent_websocket(websocket, instance_id)

@app.get('/api/governance/overview')
def governance_overview(user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    with SessionLocal() as db:
        instances = visible_query(db, user).order_by(InstanceDB.name).all()
        employees_query = db.query(UserDB)
        if role_rank(user) == 2:
            employees_query = employees_query.filter(UserDB.team_id == user.team_id)
        employees = employees_query.order_by(UserDB.name).all()
        employee_rows = [{
            'id': employee.id,
            'name': employee.name,
            'role': employee.role,
            'team_id': employee.team_id,
            'access_blocked': bool(employee.access_blocked),
            'workspace_count': sum(item.owner_id == employee.id for item in instances),
        } for employee in employees]
        request_query = db.query(SupportRequestDB).filter(SupportRequestDB.status == 'open')
        if role_rank(user) == 2:
            request_query = request_query.filter(SupportRequestDB.team_id == user.team_id)
        requests = request_query.order_by(SupportRequestDB.created_at.asc()).limit(100).all()
        instance_ids = [instance.id for instance in instances]
        audit_query = db.query(EventDB)
        if instance_ids:
            audit_query = audit_query.filter(EventDB.instance_id.in_(instance_ids))
        else:
            audit_query = audit_query.filter(EventDB.actor_id == user.id)
        audit = audit_query.order_by(EventDB.id.desc()).limit(100).all()
        serialized_fleet = _serialize_access_mode(db, instances)
        snapshots = db.query(SnapshotDB).filter(
            SnapshotDB.instance_id.in_(instance_ids),
        ).all() if instance_ids else []
        return {
            'employees': employee_rows,
            'requests': [support_request_payload(item) for item in requests],
            'runtime': runtime_summary(db, instances),
            'audit': [{
                'id': item.id,
                'instance_id': item.instance_id,
                'event_type': item.event_type,
                'actor_id': item.actor_id,
                'details': item.details,
                'created_at': item.created_at,
            } for item in audit],
            'analytics': analytics(serialized_fleet, snapshots),
            'aws_lifecycle_enabled': aws_lifecycle_enabled(),
        }

@app.post('/api/employees/{user_id}/access')
def set_employee_access(user_id: str, req: AccessBlockRequest, user=Depends(current_user)):
    if role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if user_id == user.id:
        raise HTTPException(400, 'You cannot block or unblock your own account')
    with SessionLocal() as db:
        employee = db.get(UserDB, user_id)
        if not employee or (role_rank(user) == 2 and employee.team_id != user.team_id):
            raise HTTPException(404, 'Employee not found')
        if role_rank(employee) >= 2:
            raise HTTPException(403, 'Only employee accounts can be locked from this control')
        instances = db.query(InstanceDB).filter(InstanceDB.owner_id == employee.id).all()
        employee.access_blocked = req.blocked
        status = 'ACCESS_BLOCKED' if req.blocked else 'ACCESS_RESTORED'
        db.query(SessionDB).filter(SessionDB.user_id == employee.id).delete(synchronize_session=False)
        if instances:
            for instance in instances:
                emit(db, instance.id, status, user.id, f'Account access changed for {employee.id}')
                if req.blocked:
                    emit(db, instance.id, 'SESSION_TERMINATED', user.id, 'Access blocked by governance action')
        else:
            emit(db, None, status, user.id, f'Account access changed for {employee.id}')
        db.commit()

        if req.blocked:
            failed = []
            for instance in instances:
                if instance.state not in ('running', 'idle', 'isolated'):
                    continue
                try:
                    safe_downscale(db, instance)
                    db.commit()
                except LifecycleError as exc:
                    db.rollback()
                    failed.append(f'{instance.name}: {exc}')
            if failed:
                logger.error('Access blocked for %s, but workspace downscale failed: %s', employee.id, '; '.join(failed))
                raise HTTPException(
                    503,
                    f'Access was blocked and sessions revoked, but some workspaces could not be hibernated: {"; ".join(failed)}',
                )
        return {
            'user_id': employee.id,
            'access_blocked': employee.access_blocked,
            'downscaled': req.blocked,
        }

@app.delete('/api/workspaces/{instance_id}')
def delete_workspace(instance_id: str, req: DeleteWorkspaceRequest, user=Depends(current_user)):
    if role_rank(user) < 3:
        raise HTTPException(403, 'Chief Architect required to terminate a workspace')
    with SessionLocal() as db:
        instance = db.get(InstanceDB, instance_id)
        if not instance:
            raise HTTPException(404, 'Workspace not found')
        if req.confirmation_name != instance.name:
            raise HTTPException(409, 'Confirmation must exactly match the workspace name')
        instance_name = instance.name
        try:
            terminate_workspace(db, instance)
        except LifecycleError as exc:
            db.rollback()
            raise HTTPException(503, str(exc)) from exc
        db.query(SnapshotDB).filter(SnapshotDB.instance_id == instance.id).delete(synchronize_session=False)
        db.query(SupportRequestDB).filter(SupportRequestDB.instance_id == instance.id).delete(synchronize_session=False)
        emit(
            db,
            instance.id,
            'WORKSPACE_DELETED',
            user.id,
            json.dumps({'name': instance_name, 'owner_id': instance.owner_id}),
        )
        emit(db, None, 'FLEET_UPDATED', user.id, f'Workspace {instance_name} terminated and removed')
        db.delete(instance)
        db.commit()
        return {'status': 'DELETED', 'instance_id': instance_id, 'name': instance_name}

@app.post('/api/shift/update')
def update_shift(req: ShiftUpdateRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id, management=True)
        previous = f'{inst.shift_start}-{inst.shift_end}'
        inst.shift_start, inst.shift_end = req.shift_start, req.shift_end
        if inst.state in ('running', 'idle') and not in_shift(inst):
            downscale_or_503(db, inst)
        emit(db, inst.id, 'SHIFT_UPDATED', user.id, f'{previous} -> {req.shift_start}-{req.shift_end}')
        emit(db, inst.id)
        db.commit()
        return {'status': 'SUCCESS'}

@app.post('/api/instance/state')
def change_state(req: StateChangeRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(
            db,
            user,
            req.instance_id,
            enforce_shift=req.target_state == 'running',
        )
        if req.target_state == 'running' and not in_shift(inst):
            raise HTTPException(403, 'SHIFT LOCKED')
        if req.target_state == 'running' and inst.state == 'isolated':
            raise HTTPException(423, 'Workspace is isolated; Chief Architect approval and AWS review are required')
        if agent_control_enabled() and req.target_state in ('hibernated', 'stopped') and inst.state in ('running', 'idle'):
            command = enqueue_pause(db, inst.id, req.target_state)
            db.commit()
            return dict(status='PENDING', new_state=inst.state, command_id=command.id)
        if req.target_state == 'hibernated':
            downscale_or_503(db, inst)
        elif req.target_state == 'stopped':
            downscale_or_503(db, inst)
            transition_instance_state(db, inst, 'stopped')
            emit(db, inst.id, 'SESSION_TERMINATED')
        else:
            try:
                wake_instance(db, inst)
            except LifecycleError as exc:
                raise HTTPException(503, str(exc)) from exc
        if role_rank(user) == 1:
            active_sessions = db.query(SessionDB).filter(
                SessionDB.user_id == user.id,
                SessionDB.expires_at > time.time(),
            )
            if req.target_state == 'running':
                active_sessions.update(
                    {SessionDB.instance_id: inst.id},
                    synchronize_session=False,
                )
            else:
                active_sessions.filter(SessionDB.instance_id == inst.id).update(
                    {SessionDB.instance_id: None},
                    synchronize_session=False,
                )
        db.commit()
        return dict(status='SUCCESS', new_state=inst.state)

@app.post('/api/instance/anomaly-simulate')
def anomaly(req: TargetRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id)
        if inst.state not in ('running', 'idle'):
            raise HTTPException(409, 'Instance must be powered on')
        inst.cpu_load = 99.8
        inst.has_anomaly = not in_shift(inst)
        emit(db, inst.id)
        db.commit()
        return dict(status='ANOMALY_TRIGGERED', off_hours_threat=inst.has_anomaly, context='Off-Hours Threat' if inst.has_anomaly else 'In-shift CPU spike')

@app.post('/api/login')
def workspace_login(req: LoginRequest):
    with SessionLocal() as db:
        user = db.get(UserDB, req.user_id)
        if not user or not verify_password(req.password, user.password_hash):
            raise HTTPException(401, 'Invalid credentials')
        if user.access_blocked:
            raise HTTPException(403, 'Account access is blocked. Contact your Team Lead or Chief Architect.')
        query = db.query(InstanceDB).filter(InstanceDB.owner_id == user.id)
        if req.instance_id:
            query = query.filter(InstanceDB.id == req.instance_id)
        instances = query.all()
        if not instances:
            raise HTTPException(404, 'No allocated workspace')
        if len(instances) > 1:
            raise HTTPException(409, 'Specify instance_id; multiple workspaces allocated')
        inst = instances[0]
        if not in_shift(inst):
            raise HTTPException(403, 'SHIFT LOCKED')
        try:
            wake_instance(db, inst)
        except LifecycleError as exc:
            raise HTTPException(503, str(exc)) from exc
        token = issue_session(db, user, inst.id)
        db.commit()
        return dict(success=True, access_token=token, token_type='bearer', user=user_payload(user), user_id=user.id, instance_id=inst.id, instance_name=inst.name, shift=f'{inst.shift_start} - {inst.shift_end}')

@app.post('/api/logout')
def logout(req: TargetRequest, user=Depends(current_user)):
    return change_state(StateChangeRequest(instance_id=req.instance_id, target_state='hibernated'), user)

async def websocket_user(websocket):
    # First frame avoids putting bearer credentials into URLs/access logs.
    await websocket.accept()
    try:
        message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        return authenticate(message.get('token', '')), message.get('token', '')
    except (HTTPException, ValueError, AttributeError, asyncio.TimeoutError, WebSocketDisconnect):
        await websocket.close(code=4401)
        return None, None

@app.websocket('/ws/fleet')
async def fleet_websocket(websocket: WebSocket):
    user, token = await websocket_user(websocket)
    if not user:
        return
    with SessionLocal() as db:
        cursor = db.query(func.max(EventDB.id)).scalar() or 0
    await websocket.send_json({'type': 'FLEET_UPDATED', 'instance_id': None, 'reason': 'connected'})
    last_finops_push = time.monotonic()
    last_telemetry_push = time.monotonic()
    try:
        while True:
            user = authenticate(token)
            with SessionLocal() as db:
                events = db.query(EventDB).filter(EventDB.id > cursor).order_by(EventDB.id).limit(200).all()
                records = visible_query(db, user).all()
                ids = {i.id for i in records}
                snapshots = db.query(SnapshotDB).filter(
                    SnapshotDB.instance_id.in_(ids)
                ).all() if ids else []
                serialized_fleet = _serialize_access_mode(db, records)
                access_by_id = {item['id']: item for item in serialized_fleet}
                current_analytics = analytics(serialized_fleet, snapshots)
                telemetry = [{
                    'instance_id': instance.id,
                    'state': instance.state,
                    'cpu_percent': instance.cpu_load,
                    'memory_mb': instance.memory_usage_mb,
                    'memory_percent': instance.memory_percent,
                    'observed_at': instance.telemetry_updated_at,
                    'access_mode': access_by_id[instance.id]['access_mode'],
                    'active_user': access_by_id[instance.id]['active_user'],
                } for instance in records]
                for event in events:
                    cursor = event.id
                    if event.instance_id in ids or (
                        event.instance_id is None
                        and event.event_type in (
                            'SUPPORT_REQUEST_CREATED',
                            'SUPPORT_REQUEST_UPDATED',
                            'ANNOUNCEMENT_CREATED',
                            'ACCESS_BLOCKED',
                            'ACCESS_RESTORED',
                            'FLEET_UPDATED',
                        )
                    ):
                        await websocket.send_json(dict(
                            type=event.event_type,
                            instance_id=event.instance_id,
                            event_id=event.id,
                            actor_id=event.actor_id,
                            details=event.details,
                            analytics=current_analytics,
                            **({'telemetry': [item for item in telemetry if item['instance_id'] == event.instance_id]}
                               if event.event_type == 'TELEMETRY_UPDATED' else {}),
                        ))
                if time.monotonic() - last_finops_push >= 1:
                    await websocket.send_json({
                        'type': 'FINOPS_UPDATED',
                        'analytics': current_analytics,
                        'runtime': runtime_summary(db, records),
                        'server_time': datetime.now(timezone.utc).isoformat(),
                    })
                    last_finops_push = time.monotonic()
                if time.monotonic() - last_telemetry_push >= 10:
                    await websocket.send_json({
                        'type': 'TELEMETRY_UPDATED',
                        'telemetry': telemetry,
                        'runtime': runtime_summary(db, records),
                    })
                    last_telemetry_push = time.monotonic()
            try:
                message = await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
                try:
                    payload = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if isinstance(payload, dict) and payload.get('type') == 'PING':
                    await websocket.send_json({
                        'type': 'PONG',
                        'sent_at': payload.get('sent_at'),
                        'server_time': datetime.now(timezone.utc).isoformat(),
                    })
                elif isinstance(payload, dict) and payload.get('type') == 'TELEMETRY':
                    if agent_control_enabled():
                        await websocket.send_json({'type': 'ERROR', 'status': 403, 'detail': 'Use the workspace agent for telemetry'})
                    else:
                        try:
                            await websocket.send_json(ingest_telemetry(payload, user))
                        except ValidationError:
                            await websocket.send_json({'type': 'ERROR', 'status': 422, 'detail': 'Invalid telemetry packet'})
                        except HTTPException as exc:
                            await websocket.send_json({'type': 'ERROR', 'status': exc.status_code, 'detail': exc.detail})
                elif isinstance(payload, dict) and payload.get('type') == 'ACTIVITY' and role_rank(user) == 1:
                    with SessionLocal() as activity_db:
                        instance = require_instance(activity_db, user, str(payload.get('instance_id', '')))
                        instance.portal_activity_at = datetime.now(timezone.utc).isoformat()
                        activity_db.commit()
            except asyncio.TimeoutError:
                pass
    except HTTPException:
        await websocket.close(code=4401)
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass

@app.websocket('/ws/criu-dump/{instance_id}')
async def criu_websocket(websocket: WebSocket, instance_id: str):
    user, token = await websocket_user(websocket)
    if not user:
        return
    try:
        with SessionLocal() as db:
            inst = require_instance(db, user, instance_id, management=True)
            # Commit before streaming: closing the terminal cannot cancel an authorized purge.
            filename = hibernate(db, inst) or 'No new memory snapshot (already hibernated)'
            db.commit()
        if aws_lifecycle_enabled():
            lines = [
                f'[SYSTEM] CRIU CHECKPOINT COMPLETE {instance_id}',
                f'[CRIU] SAVED {filename}',
                '[DOWNSCALE COMPLETE] EBS UNMOUNTED/DETACHED; EC2 STOPPED',
            ]
        else:
            lines = [
                f'[SYSTEM] SIMULATED CRIU FREEZE {instance_id}',
                f'[CRIU] SAVED {filename}',
                '[DOWNSCALE COMPLETE] HIBERNATED; SNAPSHOT STORAGE REMAINS BILLABLE',
            ]
        for line in lines:
            await websocket.send_text(line)
        await websocket.close()
    except HTTPException as exc:
        await websocket.close(code=4403 if exc.status_code == 403 else 4404)
    except LifecycleError as exc:
        await websocket.send_text(f'[LIFECYCLE ERROR] {exc}')
        await websocket.close(code=4503)
    except (WebSocketDisconnect, RuntimeError):
        pass
