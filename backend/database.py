import os
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import create_engine, Column, String, Boolean, Float, Integer, Text, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

DB_DIR = os.getenv('DB_DIR', str(Path(__file__).parent / 'db'))
os.makedirs(DB_DIR, exist_ok=True)
database_url = os.getenv('DATABASE_URL', f'sqlite:///{Path(DB_DIR) / "downscale.db"}')
if database_url.startswith('postgresql://'):
    database_url = database_url.replace('postgresql://', 'postgresql+psycopg2://', 1)
connect_args = {'check_same_thread': False} if database_url.startswith('sqlite:') else {}
engine = create_engine(database_url, connect_args=connect_args)
Base = declarative_base()


class UserDB(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True)
    name = Column(String)
    role = Column(String)
    team_id = Column(String)
    password_hash = Column(String)
    access_blocked = Column(Boolean, nullable=False, default=False)


class InstanceDB(Base):
    __tablename__ = 'instances'
    id = Column(String, primary_key=True)
    aws_instance_id = Column(String, unique=True)
    name = Column(String)
    instance_type = Column(String)
    owner_id = Column(String)
    state = Column(String, default='hibernated')
    state_since = Column(String, nullable=True, default=lambda: datetime.now(timezone.utc).isoformat())
    aws_volume_id = Column(String, nullable=True)
    is_exempt = Column(Boolean, default=False)
    is_snoozed = Column(Boolean, default=False)
    has_anomaly = Column(Boolean, default=False)
    cpu_load = Column(Float, default=0)
    memory_usage_mb = Column(Float, nullable=True)
    memory_percent = Column(Float, nullable=True)
    telemetry_updated_at = Column(String, nullable=True)
    activity_observed_at = Column(String, nullable=True)
    last_user_activity_at = Column(String, nullable=True)
    portal_activity_at = Column(String, nullable=True)
    low_cpu_since = Column(String, nullable=True)
    shift_start = Column(String, default='09:00')
    shift_end = Column(String, default='18:00')
    demo_enabled = Column(Boolean, default=False)
    demo_time = Column(String, nullable=True)


class SnapshotDB(Base):
    __tablename__ = 'snapshots'
    id = Column(String, primary_key=True)
    instance_id = Column(String)
    filename = Column(String)
    size_mb = Column(Float)
    tmux_panes = Column(Integer, nullable=True)
    created_at = Column(String, nullable=True)
    simulated_at = Column(String, nullable=True)
    memory_footprint_mb = Column(Float, nullable=True)
    snapshot_ref = Column(String, nullable=True)
    process_tree = Column(Text, nullable=True)


class SessionDB(Base):
    __tablename__ = 'sessions'
    token_hash = Column(String, primary_key=True)
    user_id = Column(String)
    expires_at = Column(Float)
    instance_id = Column(String, nullable=True)


class EventDB(Base):
    __tablename__ = 'events'
    id = Column(Integer, primary_key=True, autoincrement=True)
    instance_id = Column(String)
    event_type = Column(String)
    actor_id = Column(String, nullable=True)
    details = Column(Text, nullable=True)
    created_at = Column(String, nullable=False, default=lambda: datetime.now(timezone.utc).isoformat())


class AgentCredentialDB(Base):
    __tablename__ = 'agent_credentials'
    instance_id = Column(String, primary_key=True)
    token_hash = Column(String, nullable=False)
    issued_at = Column(String, nullable=False)


class AgentCommandDB(Base):
    __tablename__ = 'agent_commands'
    id = Column(String, primary_key=True)
    instance_id = Column(String, nullable=False, index=True)
    action = Column(String, nullable=False)
    target_state = Column(String, nullable=False, default='hibernated')
    status = Column(String, nullable=False, default='pending')
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)
    last_error = Column(Text, nullable=True)


class RuntimeIntervalDB(Base):
    __tablename__ = 'runtime_intervals'
    id = Column(Integer, primary_key=True, autoincrement=True)
    instance_id = Column(String, nullable=False, index=True)
    state = Column(String, nullable=False)
    started_at = Column(String, nullable=False)
    ended_at = Column(String, nullable=False)


class InvitationDB(Base):
    __tablename__ = 'invitations'
    token_hash = Column(String, primary_key=True)
    user_id = Column(String)
    team_id = Column(String)
    role = Column(String)
    workspaces_json = Column(String)
    expires_at = Column(Float)
    used = Column(Boolean, default=False)


class SupportRequestDB(Base):
    __tablename__ = 'support_requests'
    id = Column(String, primary_key=True)
    owner_id = Column(String, nullable=False)
    team_id = Column(String, nullable=True)
    instance_id = Column(String, nullable=True)
    request_type = Column(String, nullable=False)
    extension_hours = Column(Integer, nullable=True)
    subject = Column(String, nullable=False)
    details = Column(Text, nullable=False)
    status = Column(String, default='open', nullable=False)
    response = Column(Text, nullable=True)
    created_at = Column(String, nullable=False)
    updated_at = Column(String, nullable=False)


class AnnouncementDB(Base):
    __tablename__ = 'announcements'
    id = Column(String, primary_key=True)
    team_id = Column(String, nullable=True)
    created_by = Column(String, nullable=False)
    category = Column(String, nullable=False)
    title = Column(String, nullable=False)
    body = Column(Text, nullable=False)
    created_at = Column(String, nullable=False)
    expires_at = Column(String, nullable=True)


Base.metadata.create_all(engine)
with engine.begin() as connection:
    additions = {
        'users': {'team_id': 'VARCHAR', 'password_hash': 'VARCHAR', 'access_blocked': 'BOOLEAN DEFAULT FALSE'},
        'instances': {
            'demo_enabled': 'BOOLEAN DEFAULT FALSE',
            'demo_time': 'VARCHAR',
            'aws_volume_id': 'VARCHAR',
            'memory_usage_mb': 'FLOAT',
            'memory_percent': 'FLOAT',
            'telemetry_updated_at': 'VARCHAR',
            'activity_observed_at': 'VARCHAR',
            'last_user_activity_at': 'VARCHAR',
            'portal_activity_at': 'VARCHAR',
            'low_cpu_since': 'VARCHAR',
            'state_since': 'VARCHAR',
        },
        'sessions': {'instance_id': 'VARCHAR'},
        'support_requests': {'extension_hours': 'INTEGER'},
        'events': {
            'actor_id': 'VARCHAR',
            'details': 'TEXT',
            'created_at': 'VARCHAR',
        },
        'snapshots': {
            'created_at': 'VARCHAR',
            'simulated_at': 'VARCHAR',
            'memory_footprint_mb': 'FLOAT',
            'snapshot_ref': 'VARCHAR',
            'process_tree': 'TEXT',
        },
    }
    if connection.dialect.name == 'sqlite':
        connection.execute(text('BEGIN IMMEDIATE'))
        for table, fields in additions.items():
            columns = {c['name'] for c in inspect(connection).get_columns(table)}
            for column, sql_type in fields.items():
                if column not in columns:
                    connection.execute(text(f'ALTER TABLE {table} ADD COLUMN {column} {sql_type}'))
        connection.execute(text(
            "UPDATE instances SET state_since = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') "
            'WHERE state_since IS NULL'
        ))
        connection.execute(text(
            "UPDATE events SET created_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') "
            'WHERE created_at IS NULL'
        ))
    elif connection.dialect.name == 'postgresql':
        for table, fields in additions.items():
            for column, sql_type in fields.items():
                connection.execute(text(
                    f'ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {sql_type}'
                ))
        connection.execute(text(
            "UPDATE instances SET state_since = CURRENT_TIMESTAMP::text WHERE state_since IS NULL"
        ))
        connection.execute(text(
            "UPDATE events SET created_at = CURRENT_TIMESTAMP::text WHERE created_at IS NULL"
        ))


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    with SessionLocal() as db:
        yield db
