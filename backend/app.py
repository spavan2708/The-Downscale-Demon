import os
from datetime import datetime
from zoneinfo import ZoneInfo
import asyncio
import base64
import json
import hashlib
import secrets
import time
import uuid
from types import SimpleNamespace
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from database import engine as database_engine, SessionLocal, UserDB, InstanceDB, SnapshotDB, SessionDB, EventDB, InvitationDB
from auth import current_user, authenticate, password_hash, verify_password, visible_query, require_instance, role_rank
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
    queue_request_and_wake,
    safe_downscale,
    serialize,
    snapshot_payload,
    wake_instance,
)

app = FastAPI(title='The Downscale Demon API')
app.add_middleware(CORSMiddleware, allow_origins=['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'], allow_credentials=True, allow_methods=['*'], allow_headers=['*'])

class LoginRequest(BaseModel):
    user_id: str
    password: str
    instance_id: str | None = None

class TargetRequest(BaseModel):
    instance_id: str

class ShiftUpdateRequest(TargetRequest):
    shift_start: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')
    shift_end: str = Field(pattern=r'^([01]\d|2[0-3]):[0-5]\d$')

class StateChangeRequest(TargetRequest):
    target_state: Literal['running', 'hibernated', 'stopped']

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

def user_payload(user):
    role_title = {
        'employee': 'Employee',
        'manager': 'Team Lead',
        'team_lead': 'Team Lead',
        'admin': 'Chief Architect',
        'chief_architect': 'Chief Architect',
    }.get(user.role, user.role)
    return dict(id=user.id, name=user.name, role=user.role, role_title=role_title, team_id=user.team_id)

def issue_session(db, user):
    token = secrets.token_urlsafe(32)
    db.add(SessionDB(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id, expires_at=time.time() + 28800))
    return token


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
        fleet = [serialize(i) for i in records]
        return dict(fleet=fleet, analytics=analytics(fleet, snapshots),
                    demo_available=demo_available(), timezone=os.getenv('SHIFT_TIMEZONE', 'UTC'),
                    aws_lifecycle_enabled=aws_lifecycle_enabled(),
                    snapshots=[snapshot_payload(s) for s in snapshots])


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
            inst.state = req.activity if req.enabled else 'running'
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

@app.post('/api/shift/update')
def update_shift(req: ShiftUpdateRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id, management=True)
        inst.shift_start, inst.shift_end = req.shift_start, req.shift_end
        if inst.state in ('running', 'idle') and not in_shift(inst):
            downscale_or_503(db, inst)
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
        if req.target_state == 'hibernated':
            downscale_or_503(db, inst)
        elif req.target_state == 'stopped':
            downscale_or_503(db, inst)
            inst.state = 'stopped'
            emit(db, inst.id, 'SESSION_TERMINATED')
        else:
            try:
                wake_instance(db, inst)
            except LifecycleError as exc:
                raise HTTPException(503, str(exc)) from exc
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
        token = issue_session(db, user)
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
                current_analytics = analytics(
                    [serialize(instance) for instance in records],
                    snapshots,
                )
                for event in events:
                    cursor = event.id
                    if event.instance_id in ids:
                        await websocket.send_json(dict(
                            type=event.event_type,
                            instance_id=event.instance_id,
                            event_id=event.id,
                            analytics=current_analytics,
                        ))
                if time.monotonic() - last_finops_push >= 10:
                    await websocket.send_json({
                        'type': 'FINOPS_UPDATED',
                        'analytics': current_analytics,
                    })
                    last_finops_push = time.monotonic()
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=0.5)
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
