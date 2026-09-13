import os
from sqlalchemy import create_engine, Column, String, Boolean, Float, Integer, ForeignKey
from sqlalchemy.orm import declarative_base, sessionmaker

DB_DIR = "/app/db"
os.makedirs(DB_DIR, exist_ok=True)
DB_PATH = os.path.join(DB_DIR, "downscale.db")

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
Base = declarative_base()

class UserDB(Base):
    __tablename__ = 'users'
    id = Column(String, primary_key=True)
    name = Column(String)
    role = Column(String)  # employee, manager, admin

class InstanceDB(Base):
    __tablename__ = 'instances'
    id = Column(String, primary_key=True)
    aws_instance_id = Column(String, unique=True)
    name = Column(String)
    instance_type = Column(String)
    owner_id = Column(String)
    state = Column(String, default="running")
    is_exempt = Column(Boolean, default=False)
    is_snoozed = Column(Boolean, default=False)
    has_anomaly = Column(Boolean, default=False)
    cpu_load = Column(Float, default=4.2)
    shift_start = Column(String, default="09:00")
    shift_end = Column(String, default="18:00")

class SnapshotDB(Base):
    __tablename__ = 'snapshots'
    id = Column(String, primary_key=True)
    instance_id = Column(String)
    filename = Column(String)
    size_mb = Column(Float)
    tmux_panes = Column(Integer, default=2)

Base.metadata.create_all(engine)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()