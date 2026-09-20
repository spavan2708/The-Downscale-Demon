# Employee app integration handoff

Reviewed against source on 2026-09-20. The core flows below are implemented in the sibling portal; retain these contracts when extending it.

Connect the employee app to the existing FastAPI backend at `http://localhost:8000` (WebSocket base `ws://localhost:8000`). Use configurable base URLs and HTTPS/WSS when hosted. CORS permits localhost:5173. Do not create a separate user database, mock fleet, or client-side role selector.

## Sign up

Add Sign In / Sign Up navigation. Collect `user_id`, `name`, `password` (12–128 characters), and `invitation_token`. Do not ask users to select roles, teams, instance types or shifts.

`POST /api/auth/signup` (no authorization header):
```json
{"user_id":"EMP-100","name":"Alex","password":"user-chosen-password","invitation_token":"code-from-manager"}
```
HTTP 201:
```json
{"success":true,"access_token":"...","token_type":"bearer","user":{"id":"EMP-100","name":"Alex","role":"employee","team_id":"platform"},"instance_ids":["i-..."]}
```

Managers/Admins generate codes in the Admin UI using **Invite to Sign Up**. Codes are tied to the intended User ID, expire after 24 hours, and work once. Team/role/workspaces are assigned by the inviter. Signup atomically creates the account and assigned workspaces, which begin hibernated; signup does not wake them. Show the workspace picker after signup.

Errors use HTTP status plus `{detail}`: 400 invalid/expired/used/wrong-user invitation, 409 existing User ID, 422 validation errors. Render FastAPI detail arrays as readable field errors. The separate Chief Architect Sign Up form calls `POST /api/auth/signup/chief-architect` with `{user_id,name,password}` and no invitation. It returns 201 only when no administrator exists; otherwise 409. `backend/bootstrap_admin.py` is also available. Ordinary invitation signup cannot grant admin privileges.

## Login and workspace lifecycle

1. `POST /api/auth/login` with `{user_id,password}` -> same token/user shape (without instance_ids). Login authenticates independently of shift hours.
2. Hold token in app memory, attach `Authorization: Bearer <access_token>` to authenticated REST requests. Tokens expire after eight hours; on HTTP 401 or WebSocket close 4401 clear session and show login.
3. `GET /api/me` -> current identity. `GET /api/instances` -> `{fleet,analytics,snapshots}`, already scoped by the server. Use real fleet data; show empty state when no workspaces exist.
4. Start or restore selected workspace: `POST /api/instance/state` with `{instance_id,target_state:"running"}`. Only open the workspace after HTTP success. HTTP 403 SHIFT LOCKED means stay in the picker and show the server's message.
5. End workspace: `POST /api/logout` with `{instance_id}`; wait for success before clearing local workspace state. This hibernates it; it does not revoke the account bearer token. On local account sign-out, clear the token and close WebSockets.

The legacy `POST /api/login` combines credential authentication and waking an owned workspace; it requires instance_id when several are assigned. Prefer the separate auth + picker + state flow above.

## Live synchronization

Connect `/ws/fleet`; immediately send the first frame `{"token":"<access_token>"}` (10-second deadline). Never put the token into the URL. Frames are JSON:
```json
{"type":"FLEET_UPDATED","instance_id":null,"reason":"connected"}
{"type":"FLEET_UPDATED","instance_id":"i-...","event_id":123}
{"type":"SESSION_TERMINATED","instance_id":"i-...","event_id":124}
```

Refetch `/api/instances` on FLEET_UPDATED. On SESSION_TERMINATED, immediately close/lock the workspace only when instance_id matches the active workspace; return to the picker and show a notice. Refetch fleet too. Reconnect with backoff and refetch after reconnect; events are not replayed. If the refetched active instance is stopped/hibernated, close the workspace even if a termination event was missed. Reconcile on page focus as well. Do not call logout in response to termination events (avoid loops). Purge, shift cutoff, stop, and logout produce targeted events across both apps.

## Fleet / snapshots / billing

Fleet fields include `id,name,type,owner,state,cpu,cost,hourly_rate,exempt,snoozed,anomaly,shift,shift_start,shift_end`. `cost` is current hourly compute; powered-on idle nodes are billable. Stopped/hibernated nodes have zero compute cost.
Snapshots contain `id,instance_id,filename,size_mb,tmux_panes`. Render server filenames `SNAPSHOT_[Instance_Name]_[YYYYMMDD].IMG`; use snapshot UUID as React key. CRIU is simulated; no actual download endpoint exists.

Use server analytics: `compute_hourly,compute_daily,snapshot_gb,snapshot_monthly,total_daily,daily_savings,downscale_rate,exempt_nodes,currency,billing_basis`. USD current-state projections: compute/day = compute/hour × 24; snapshot/month = retained MiB / 1024 × $0.05; total/day = compute/day + snapshot/month / 30. Do not invent savings or recompute billing from visible cards.

Shift authority is the backend clock: UTC by default, Asia/Kolkata in Compose. Start inclusive/end exclusive; overnight shifts supported; equal start/end means 24 hours. Employees cannot edit shifts or perform CRIU manager purges. Use server anomaly flag, not client clock, for the Off-Hours Threat label.

## Acceptance checks

Verify signup, expired/reused/wrong-user codes, login failure, multiple-workspace selection, off-hours wake denial, own-fleet isolation, live provisioning/purge/shift updates, reconnect after a missed purge, and expired-token handling. No user should choose their own privilege level or team.

## Current implementation and data notes

The portal uses React state/refs in `src/App.jsx`, native fetch/WebSocket, and build-time Tailwind. Tokens stay in memory; the implementation does not use React Query, React Router, or localStorage session persistence.

The responsive-card redesign applies to `The-Downscale-Demon/frontend/`, not the sibling portal. On 2026-09-20 the shared local Docker database was cleaned of six demo instances and related snapshots/events, preserving employee `001`, both `hail` workspaces, and the administrator. Consume API results normally; do not hardcode these IDs as a permanent allowlist. See [README](README.md) for the backup record.

The acceptance checks above are a checklist, not a claim that they were rerun during the documentation update. The latest update below replaces the hardcoded active-session timezone label with server metadata.

## Implemented demo and snapshot UX

After authentication, the portal renders `DemoControls` for owned workspaces when `demo_available` is true. It offers the per-workspace toggle, server-timezone date/time input, CPU percentage, running/idle selection, shift-boundary/CPU presets, and immediate evaluation. Apply settings through `/api/instance/demo`, then refetch fleet. If the active instance returns hibernated/stopped, close its session immediately. Standard fleet events continue to reconcile both apps.

The new `SnapshotVault` component replaces the compact retained-snapshot list. Display `created_at` and optional `simulated_at` in the API timezone; null historical times use `legacy_date` plus a time-not-recorded label. Filenames are expandable, and unique references distinguish repeated captures. The portal's active-session timezone now uses the server value rather than hardcoded Asia/Kolkata.

The demo clock is workspace-scoped and fixed until changed/disabled. Do not change token expiry or global machine time. Keep the toggle available before workspace start so users can choose an in-shift clock without waiting.
