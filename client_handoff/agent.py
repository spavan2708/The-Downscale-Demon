"""Copy this file into The-Downscale-Client/agent/agent.py."""
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

import psutil
import websocket


INSTANCE_ID = os.environ['DOWNSCALE_INSTANCE_ID']
TOKEN = os.environ['DOWNSCALE_AGENT_TOKEN']
URL = os.environ['DOWNSCALE_AGENT_WS_URL'].rstrip('/') + '/' + INSTANCE_ID
if not URL.startswith('wss://') and os.getenv('DOWNSCALE_ALLOW_INSECURE') != '1':
    raise SystemExit('WSS is required; use DOWNSCALE_ALLOW_INSECURE=1 only for local simulation')

STATE_PATH = Path.home() / '.downscale-agent' / f'{INSTANCE_ID}-prepared.json'


def prepared_ids():
    try:
        return set(json.loads(STATE_PATH.read_text()))
    except (FileNotFoundError, ValueError):
        return set()


def remember(command_id, ids):
    ids.add(command_id)
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = STATE_PATH.with_suffix('.tmp')
    temporary.write_text(json.dumps(sorted(ids)))
    os.replace(temporary, STATE_PATH)


def sample():
    memory = psutil.virtual_memory()
    try:
        # A logged-in OS user is treated as active. This conservative signal
        # prevents idle downscale when finer input activity is unavailable.
        user_active = bool(psutil.users())
    except Exception:
        user_active = True
    return {
        'type': 'TELEMETRY',
        'cpu_percent': psutil.cpu_percent(interval=1),
        'memory_mb': memory.used / 1048576,
        'memory_percent': memory.percent,
        'observed_at': datetime.now(timezone.utc).isoformat(),
        'user_active': user_active,
    }


def prepare(command_id, known):
    if command_id in known:
        return True, 'Already prepared'
    if os.getenv('DOWNSCALE_AGENT_SIMULATION') == '1':
        remember(command_id, known)
        return True, 'Simulation preparation complete'
    command = os.getenv('DOWNSCALE_PREPARE_COMMAND')
    if not command:
        return False, 'No preparation command configured'
    try:
        result = subprocess.run([command, command_id], timeout=30,
                                capture_output=True, text=True, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        return False, type(exc).__name__
    if result.returncode:
        return False, f'Preparation exited {result.returncode}'
    remember(command_id, known)
    return True, 'Preparation complete'


def run():
    known = prepared_ids()
    delay = 1
    while True:
        socket = None
        try:
            socket = websocket.create_connection(URL, timeout=10)
            socket.settimeout(1)
            socket.send(json.dumps({'token': TOKEN}))
            first = json.loads(socket.recv())
            if first.get('type') != 'AGENT_CONNECTED':
                raise RuntimeError('Agent authentication failed')
            print(f'Agent connected for {INSTANCE_ID}', flush=True)
            delay = 1
            next_sample = 0
            while True:
                if time.monotonic() >= next_sample:
                    socket.send(json.dumps(sample()))
                    next_sample = time.monotonic() + 30
                try:
                    message = json.loads(socket.recv())
                except websocket.WebSocketTimeoutException:
                    continue
                if message.get('type') == 'COMMAND' and message.get('action') == 'PREPARE_PAUSE':
                    command_id = message.get('id')
                    if not isinstance(command_id, str):
                        continue
                    ready, detail = prepare(command_id, known)
                    socket.send(json.dumps({'type': 'COMMAND_ACK', 'id': command_id,
                                            'prepared': ready, 'detail': detail}))
                elif message.get('type') == 'COMMAND_RESULT':
                    print(f"Command {message.get('id')}: {message.get('status')}", flush=True)
        except (OSError, ValueError, RuntimeError, websocket.WebSocketException) as exc:
            print(f'Agent disconnected: {type(exc).__name__}; retrying', flush=True)
        finally:
            if socket:
                socket.close()
        time.sleep(delay)
        delay = min(delay * 2, 15)


if __name__ == '__main__':
    run()
