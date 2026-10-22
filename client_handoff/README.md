# Files to copy into The-Downscale-Client

- Replace `src/context/AppContext.jsx` with `AppContext.jsx` in this directory. This is based on the AppContext text pasted by the user in the conversation, with the working Demon API address and employee activity heartbeats.
- Add `agent/agent.py` from `agent.py` and `agent/requirements.txt` from `requirements.txt`. The agent is a separate Python process on a managed workspace; the React portal does not collect host metrics.

The agent expects `DOWNSCALE_INSTANCE_ID`, `DOWNSCALE_AGENT_TOKEN`, and `DOWNSCALE_AGENT_WS_URL` (the base URL ending in `/ws/agent`). In production use `wss://` and a certificate trusted by the workspace. For a local simulation only, set `DOWNSCALE_ALLOW_INSECURE=1` and `DOWNSCALE_AGENT_SIMULATION=1`. Install with `python -m pip install -r agent/requirements.txt` and start with `python agent/agent.py`.

The Chief Architect rotates a credential with `POST /api/workspaces/{instance_id}/agent-credential` only after `AGENT_CONTROL_ENABLED=1` and TLS are configured on Demon. The token appears once in the response; keep it out of source control and shell history. A real pause requires `DOWNSCALE_PREPARE_COMMAND` to point to an executable receiving the command ID as its only argument. Without it, the agent refuses preparation and Demon leaves the workspace running.

If the pushed Client repository differs from the pasted source, reconcile the complete `AppContext.jsx` before replacing it. This directory is a handoff artifact and is not built by Demon's Docker Compose stack.
