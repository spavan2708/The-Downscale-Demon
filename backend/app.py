import asyncio
import json
import hashlib
import secrets
import time
import uuid
from typing import Literal
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError
from database import SessionLocal, UserDB, InstanceDB, SnapshotDB, SessionDB, EventDB, InvitationDB
from auth import current_user, authenticate, password_hash, verify_password, visible_query, require_instance
from engine import RATES, serialize, analytics, in_shift, hibernate, emit

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

class EmployeeRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)
    team_id: str = Field(min_length=1, max_length=80)
    role: Literal['employee', 'manager'] = 'employee'
    instances: list[WorkspaceRequest] = Field(min_length=1, max_length=20)

def user_payload(user):
    return dict(id=user.id, name=user.name, role=user.role, team_id=user.team_id)

def issue_session(db, user):
    token = secrets.token_urlsafe(32)
    db.add(SessionDB(token_hash=hashlib.sha256(token.encode()).hexdigest(), user_id=user.id, expires_at=time.time() + 28800))
    return token

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
        # Serialize first-admin creation across workers using the shared SQLite database.
        db.execute(text('BEGIN IMMEDIATE'))
        if db.query(UserDB).filter(UserDB.role == 'admin').first():
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
    role: Literal['employee', 'manager'] = 'employee'
    instances: list[WorkspaceRequest] = Field(min_length=1, max_length=20)

class SignupRequest(BaseModel):
    model_config = {'extra': 'forbid'}
    invitation_token: str = Field(min_length=1, max_length=200)
    user_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=12, max_length=128)

@app.post('/api/invitations', status_code=201)
def invite(req: InvitationRequest, user=Depends(current_user)):
    if user.role not in ('manager', 'admin'):
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if user.role == 'manager' and (not user.team_id or req.team_id != user.team_id or req.role != 'employee'):
        raise HTTPException(403, 'Team Leads may invite employees only within their assigned team')
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
            db.add(InstanceDB(id=identifier, aws_instance_id=identifier, owner_id=user.id,
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
        return dict(fleet=fleet, analytics=analytics(fleet, snapshots), snapshots=[dict(id=s.id, instance_id=s.instance_id, filename=s.filename, size_mb=s.size_mb, tmux_panes=s.tmux_panes) for s in snapshots])

@app.post('/api/employees', status_code=201)
def provision(req: EmployeeRequest, user=Depends(current_user)):
    if user.role not in ('manager', 'admin'):
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    if user.role == 'manager' and (not user.team_id or req.team_id != user.team_id or req.role != 'employee'):
        raise HTTPException(403, 'Team Leads may provision employees only within their assigned team')
    with SessionLocal() as db:
        employee = UserDB(id=req.user_id, name=req.name, role=req.role, team_id=req.team_id, password_hash=password_hash(req.password))
        db.add(employee)
        ids = []
        for spec in req.instances:
            identifier = 'i-' + uuid.uuid4().hex[:17]
            db.add(InstanceDB(id=identifier, aws_instance_id=identifier, owner_id=req.user_id, name=spec.name, instance_type=spec.instance_type, shift_start=spec.shift_start, shift_end=spec.shift_end))
            ids.append(identifier)
            emit(db, identifier)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, 'User ID already exists')
        return dict(user=user_payload(employee), instance_ids=ids)

@app.post('/api/shift/update')
def update_shift(req: ShiftUpdateRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id, management=True)
        inst.shift_start, inst.shift_end = req.shift_start, req.shift_end
        if inst.state in ('running', 'idle') and not in_shift(inst):
            hibernate(db, inst)
        emit(db, inst.id)
        db.commit()
        return {'status': 'SUCCESS'}

@app.post('/api/instance/state')
def change_state(req: StateChangeRequest, user=Depends(current_user)):
    with SessionLocal() as db:
        inst = require_instance(db, user, req.instance_id)
        if req.target_state == 'running' and not in_shift(inst):
            raise HTTPException(403, 'SHIFT LOCKED')
        if req.target_state == 'hibernated':
            hibernate(db, inst)
        else:
            inst.state = req.target_state
            inst.has_anomaly = False
            inst.cpu_load = 4.2 if req.target_state == 'running' else 0
            if req.target_state == 'stopped':
                emit(db, inst.id, 'SESSION_TERMINATED')
            emit(db, inst.id)
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
        inst.state, inst.has_anomaly, inst.cpu_load = 'running', False, 4.2
        token = issue_session(db, user)
        emit(db, inst.id)
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
    try:
        while True:
            user = authenticate(token)
            with SessionLocal() as db:
                events = db.query(EventDB).filter(EventDB.id > cursor).order_by(EventDB.id).limit(200).all()
                ids = {i.id for i in visible_query(db, user).all()}
                for event in events:
                    cursor = event.id
                    if event.instance_id in ids:
                        await websocket.send_json(dict(type=event.event_type, instance_id=event.instance_id, event_id=event.id))
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
        for line in [f'[SYSTEM] SIMULATED CRIU FREEZE {instance_id}', f'[CRIU] SAVED {filename}', '[DOWNSCALE COMPLETE] HIBERNATED; SNAPSHOT STORAGE REMAINS BILLABLE']:
            await websocket.send_text(line)
        await websocket.close()
    except HTTPException as exc:
        await websocket.close(code=4403 if exc.status_code == 403 else 4404)
    except (WebSocketDisconnect, RuntimeError):
        pass
