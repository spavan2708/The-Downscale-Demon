"""Reset an existing Chief Architect password: python reset_admin_password.py USER_ID."""
import getpass
import sys

from auth import password_hash
from database import SessionLocal, UserDB


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('Usage: python reset_admin_password.py USER_ID')

    user_id = sys.argv[1]
    password = getpass.getpass('New Chief Architect password (12+ characters): ')
    if len(password) < 12:
        raise SystemExit('Password must have at least 12 characters')

    with SessionLocal() as db:
        user = db.get(UserDB, user_id)
        if not user or user.role not in ('admin', 'chief_architect'):
            raise SystemExit('Chief Architect account not found')
        user.password_hash = password_hash(password)
        db.commit()

    print(f'Password reset for Chief Architect {user_id}.')
