import os
from pathlib import Path
from sqlalchemy import create_engine, Column, String, Boolean, Float, Integer, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DB_DIR = os.getenv('DB_DIR', str(Path(__file__).parent / 'db'))
os.makedirs(DB_DIR, exist_ok=True)
engine = create_engine(os.getenv('DATABASE_URL', f'sqlite:///{Path(DB_DIR) / "downscale.db"}'), connect_args={'check_same_thread': False})
Base = declarative_base()

class UserDB(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True)
    name = Column(String)
    role = Column(String)
    team_id = Column(String)
    password_hash = Column(String)

class InstanceDB(Base):
    __tablename__ = 'instances'
    id = Column(String, primary_key=True)
    aws_instance_id = Column(String, unique=True)
    name = Column(String)
    instance_type = Column(String)
    owner_id = Column(String)
    state = Column(String, default='hibernated')
    is_exempt = Column(Boolean, default=False)
    is_snoozed = Column(Boolean, default=False)
    has_anomaly = Column(Boolean, default=False)
    cpu_load = Column(Float, default=0)
    shift_start = Column(String, default='09:00')
    shift_end = Column(String, default='18:00')

class SnapshotDB(Base):
    __tablename__ = 'snapshots'
    id = Column(String, primary_key=True)
    instance_id = Column(String)
    filename = Column(String)
    size_mb = Column(Float)
    tmux_panes = Column(Integer, default=2)

class SessionDB(Base):
    __tablename__ = 'sessions'
    token_hash = Column(String, primary_key=True)
    user_id = Column(String)
    expires_at = Column(Float)

class EventDB(Base):
    __tablename__ = 'events'
    id = Column(Integer, primary_key=True, autoincrement=True)
    instance_id = Column(String)
    event_type = Column(String)

class InvitationDB(Base):
    __tablename__ = 'invitations'
    token_hash = Column(String, primary_key=True)
    user_id = Column(String)
    team_id = Column(String)
    role = Column(String)
    workspaces_json = Column(String)
    expires_at = Column(Float)
    used = Column(Boolean, default=False)

Base.metadata.create_all(engine)
# Additive migration: legacy users remain locked until credentials/team are assigned.
with engine.begin() as connection:
    columns = {c['name'] for c in inspect(connection).get_columns('users')}
    for column in ('team_id', 'password_hash'):
        if column not in columns:
            connection.execute(text(f'ALTER TABLE users ADD COLUMN {column} VARCHAR'))
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    with SessionLocal() as db:
        yield db
