from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from engine import DownscaleDemonEngine

app = FastAPI(title="The Downscale Demon API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = DownscaleDemonEngine()

class ShiftUpdateRequest(BaseModel):
    instance_id: str
    shift_start: str
    shift_end: str

class StateChangeRequest(BaseModel):
    instance_id: str
    target_state: str

class TargetRequest(BaseModel):
    instance_id: str

@app.get("/api/instances")
def read_instances():
    return engine.get_instances()

@app.post("/api/shift/update")
def update_shift(req: ShiftUpdateRequest):
    return engine.update_shift(req.instance_id, req.shift_start, req.shift_end)

@app.post("/api/instance/state")
def change_state(req: StateChangeRequest):
    return engine.toggle_state(req.instance_id, req.target_state)

@app.post("/api/instance/anomaly-simulate")
def trigger_anomaly(req: TargetRequest):
    return engine.simulate_anomaly(req.instance_id)

@app.websocket("/ws/criu-dump/{instance_id}")
async def criu_websocket_endpoint(websocket: WebSocket, instance_id: str):
    await websocket.accept()
    try:
        async for log_line in engine.execute_criu_dump_stream(instance_id):
            await websocket.send_text(log_line)
        await websocket.close()
    except WebSocketDisconnect:
        pass