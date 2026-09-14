import hashlib
import hmac
import secrets
import time
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from database import SessionLocal, SessionDB, UserDB, InstanceDB

bearer = HTTPBearer(auto_error=False)

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
        if not user:
            raise HTTPException(401, 'Invalid or expired session')
        db.expunge(user)
        return user

def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, 'Bearer token required')
    return authenticate(credentials.credentials)

def visible_query(db, user):
    query = db.query(InstanceDB)
    if user.role == 'admin':
        return query
    if user.role == 'manager' and user.team_id:
        return query.join(UserDB, UserDB.id == InstanceDB.owner_id).filter(UserDB.team_id == user.team_id)
    return query.filter(InstanceDB.owner_id == user.id)

def require_instance(db, user, instance_id, management=False):
    if management and user.role not in ('manager', 'admin'):
        raise HTTPException(403, 'Team Lead or Chief Architect required')
    instance = visible_query(db, user).filter(InstanceDB.id == instance_id).first()
    if not instance:
        raise HTTPException(404, 'Instance not found')
    return instance
