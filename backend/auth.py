import hashlib
import hmac
import os
import secrets
import time
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from database import SessionLocal, SessionDB, UserDB, InstanceDB

bearer = HTTPBearer(auto_error=False)

ROLE_RANK = {
    'employee': 1,
    'manager': 2,
    'team_lead': 2,
    'admin': 3,
    'chief_architect': 3,
}


def role_rank(user):
    return ROLE_RANK.get(user.role, 0)


def shift_access(instance, now=None):
    if instance.is_exempt or instance.is_snoozed or instance.shift_start == instance.shift_end:
        return True
    if (
        os.getenv('DEMO_MODE', '0') == '1'
        and instance.demo_enabled
        and instance.demo_time
    ):
        clock = datetime.fromisoformat(instance.demo_time)
    else:
        clock = now or datetime.now(ZoneInfo(os.getenv('SHIFT_TIMEZONE', 'UTC')))
    current = clock.strftime('%H:%M')
    if instance.shift_start < instance.shift_end:
        return instance.shift_start <= current < instance.shift_end
    return current >= instance.shift_start or current < instance.shift_end


def password_hash(password):
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600000).hex()
    return f'{salt}:{digest}'

def verify_password(password, encoded):
    if not encoded:
        return False
    salt, digest = encoded.split(':')
    return hmac.compare_digest(digest, hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 600000).hex())

def authenticate(token):
    with SessionLocal() as db:
        session = db.get(SessionDB, hashlib.sha256(token.encode()).hexdigest())
        user = db.get(UserDB, session.user_id) if session and session.expires_at > time.time() else None
        if not user or user.access_blocked:
            raise HTTPException(401, 'Invalid or expired session')
        db.expunge(user)
        return user

def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, 'Bearer token required')
    return authenticate(credentials.credentials)

def visible_query(db, user):
    query = db.query(InstanceDB)
    if role_rank(user) >= 3:
        return query
    if role_rank(user) == 2 and user.team_id:
        return query.join(UserDB, UserDB.id == InstanceDB.owner_id).filter(UserDB.team_id == user.team_id)
    return query.filter(InstanceDB.owner_id == user.id)


def require_instance(db, user, instance_id, management=False, enforce_shift=False):
    if management and role_rank(user) < 2:
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    instance = visible_query(db, user).filter(InstanceDB.id == instance_id).first()
    if not instance:
        raise HTTPException(404, 'Instance not found')
    if enforce_shift and not shift_access(instance):
        raise HTTPException(403, 'SHIFT LOCKED')
    return instance
