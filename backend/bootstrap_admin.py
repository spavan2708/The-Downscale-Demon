"""Run once: python bootstrap_admin.py USER_ID NAME TEAM_ID (password prompted)."""
import getpass
import sys
from database import SessionLocal, UserDB
from auth import password_hash
if __name__ == '__main__':
    user_id, name, team_id = sys.argv[1:]
    password = getpass.getpass('Administrator password (12+ characters): ')
    if len(password) < 12:
        raise SystemExit('Password must have at least 12 characters')
    with SessionLocal() as db:
        if db.get(UserDB, user_id):
            raise SystemExit('User already exists; refusing to overwrite')
        db.add(UserDB(id=user_id, name=name, team_id=team_id, role='admin', password_hash=password_hash(password)))
        db.commit()
