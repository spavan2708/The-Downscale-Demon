from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from engine import DownscaleDemonEngine

app = FastAPI(title="The Downscale Demon API")

# Allow requests from the frontend container
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = DownscaleDemonEngine()

class ActionRequest(BaseModel):
    instance_id: str
    is_busy: bool = False

@app.get("/api/instances")
def read_instances():
    return engine.get_instances()

@app.post("/api/evaluate")
def evaluate(req: ActionRequest):
    return engine.evaluate_and_downscale(req.instance_id, req.is_busy)

@app.post("/api/wake")
def wake(req: ActionRequest):
    return engine.wake_instance(req.instance_id)

@app.post("/api/snooze")
def snooze(req: ActionRequest):
    return engine.toggle_snooze(req.instance_id)