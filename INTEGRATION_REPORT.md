# API integration report

Reviewed against source on 2026-10-19.

## Five-step pipeline integration target

This report separates local default behavior from the opt-in AWS lifecycle path. With `AWS_LIFECYCLE_ENABLED=0` (the default), REST endpoints manage simulated workspace state. When explicitly enabled and configured, the edge proxy uses SQS and EC2, state hydration/downscale use EBS and SSM-driven CRIU, anomaly polling can read CloudWatch and isolate with a quarantine security group, and the fleet WebSocket emits scoped analytics. No live AWS account validation is claimed.

```text
1 Edge Proxy & Buffering
  API Gateway / Lambda -> SQS request envelope
       |                    (bounded, expiring, correlated)
       | readiness
2 State Preservation & Hydration
  EC2 start -> checkpoint EBS attach -> compatible CRIU restore -> ready
       |
3 Shift RBAC & Anomaly Guard
  Employee -> Team Lead -> Chief Architect checks
  shift authorization + off-hours CPU/RAM assessment -> allow/isolate
       |
4 Safe Downscale & Storage Unmount
  quiesce -> flush/checkpoint -> unmount/detach confirmation
  -> AWS SDK ec2.stop_instances
       |
5 FinOps Analytics Engine
  active usage vs 24x7 baseline -> estimated savings -> authorized WebSocket
```

The cross-component contract carries a workspace ID, request/correlation ID, expiry, and explicit failure results. The implementation bounds SQS request payload size and waits for EC2 status checks, but AWS queue retention, redrive, client timeout limits, duplicate delivery, retry/idempotency, and response correlation still require deployment configuration and validation. CRIU checkpoint compatibility and socket behavior are environment-dependent. FinOps estimates must be distinguished from actual billed usage.

## Authentication and isolation

The user-facing hierarchy is Employee -> Team Lead -> Chief Architect; persisted role aliases map to server-side ranks. The API never accepts client-provided role claims.

Protected REST endpoints require `Authorization: Bearer <access_token>`. Roles are persisted server-side: `employee` (own instances), `manager` (assigned team), `admin` (entire fleet). Client role claims are never accepted. Snapshots, analytics, mutations and event delivery use the same scope. Unauthorized instance IDs return 404; management-only actions return 403 for employees.

- `POST /api/auth/login`: `{user_id,password}` -> `{success,access_token,token_type,user:{id,name,role,team_id}}`. Authenticates without waking a workspace; tokens expire after eight hours.
- `GET /api/me`: authenticated user identity.
- `GET /api/instances`: `{fleet,analytics,snapshots,demo_available,timezone}` within caller scope. Use this to reconcile state after connecting/reconnecting.
- `POST /api/login`: `{user_id,password,instance_id?}` authenticates and wakes an owned workspace within shift. Select `instance_id` when several exist (otherwise 409). Returns token/user plus `user_id,instance_id,instance_name,shift`.
- `POST /api/employees`: Manager/Admin provisioning, atomically creates a user and 1–20 initially hibernated instances. Example:

```json
{"user_id":"EMP-100","name":"Alex","password":"choose-a-unique-password","team_id":"platform","role":"employee","instances":[{"name":"Alex Workspace","instance_type":"t3.medium","shift_start":"09:00","shift_end":"18:00"}]}
```

Returns HTTP 201 `{user,instance_ids}`; duplicate user ID -> 409. Managers can only create employees within their team. Admins may also create `manager` accounts for any team.

Existing authenticated mutation endpoints: `/api/shift/update` (`instance_id,shift_start,shift_end`, management only), `/api/instance/state` (`instance_id,target_state`: running/hibernated/stopped), `/api/instance/anomaly-simulate` and `/api/logout` (`instance_id`). Logout hibernates the specified workspace. Failures use HTTP error status and `{detail}`.

## Governance controls and runtime data

- `GET /api/governance/overview` (Team Lead/Chief Architect): returns only the caller's team-scoped or global `employees`, pending `requests`, `audit` entries, fleet analytics, and runtime summary.
- `POST /api/employees/{user_id}/access` with `{"blocked":true|false}`: Team Leads may manage employee accounts in their team; Chief Architects may manage any employee account. Blocking removes all stored sessions immediately, prevents new login, and requests hibernation for powered-on workspaces. If a workspace downscale fails, the access block remains in force and the API returns 503 with the affected workspace/failure detail. Self-lockout and locking a Team Lead/Chief Architect through this control are rejected.
- `DELETE /api/workspaces/{instance_id}` with `{"confirmation_name":"exact workspace name"}`: Chief Architect only. The exact-name confirmation is enforced server-side. The AWS path safely checkpoints/quiesces where configured, detaches EBS, and terminates EC2; the detached EBS volume is retained, not erased. Workspace and snapshot/request metadata are removed only after AWS operations succeed. Local mode simulates registry deletion.
- AWS SDK failures during checkpoint/downscale or workspace termination are logged and returned as explicit lifecycle failures; workspace deletion returns 503 rather than reporting success.

`InstanceDB.state_since` and `RuntimeIntervalDB` track observed state intervals. At migration time, pre-existing workspaces begin a new runtime tracking baseline; earlier active/hibernated hours are not reconstructed. Runtime totals classify running/idle/isolated as active and stopped/hibernated as hibernated; the baseline and managed spend use configured hourly rates. The scheduler samples CloudWatch CPU/memory for powered-on AWS instances and stores the latest reading in the database; it is telemetry, not an AWS billable-uptime source. The UI labels lifetime savings as modeled compute avoidance, not actual AWS credits.

Shift updates and governance controls write actor/time/details to `events`. Fleet WebSocket event delivery notifies both clients; workspace deletion emits a global `FLEET_UPDATED` after the row is removed so other authorized clients refetch and reconcile.

## FinOps formulas

The current API provides USD current-state projections, not historical invoices, live AWS price quotes, or awarded credits. Defaults are t3.medium=0.0416/hour; c5.xlarge=0.1700/hour; r5.large=0.1260/hour. `EC2_HOURLY_RATES_JSON` can override them with deployment-appropriate rates. The production FinOps step still needs reconciliation with AWS billing/usage data and must not label projected savings as awarded credits.

- compute_hourly = sum(rate[type] for running or idle instances). Idle means powered on. Hibernated/stopped contribute zero.
- compute_daily = compute_hourly × 24.
- snapshot_gb = sum(retained snapshot size_mb) / 1024 (size_mb stores MiB).
- snapshot_monthly = snapshot_gb × SNAPSHOT_GB_MONTH_RATE (default $0.05).
- total_daily = compute_daily + snapshot_monthly / 30.
- daily_savings = (all-allocated-instance hourly baseline - compute_hourly) × 24 - snapshot_monthly / 30.
- downscale_rate = hibernated non-exempt instances / all non-exempt instances × 100; empty denominator gives zero.

Snapshots remain billable after wake. In local mode CRIU is simulated; unavailable checkpoint size/RAM/pane metadata remains null instead of using a fabricated size. In AWS mode the remote checkpoint's measured directory size and RAM footprint are stored separately; actual EBS storage billing still requires AWS billing reconciliation. Snapshots are independently retained (no incremental block deduplication is modeled). Legacy filenames: `SNAPSHOT_[sanitized Instance_Name]_[YYYYMMDD].IMG`; new captures also include time and a unique suffix; UUID snapshot IDs distinguish repeated dumps. EC2 ancillary charges and live metered usage are outside this estimate.

## WebSockets

Connect `/ws/fleet` or `/ws/criu-dump/{instance_id}` and immediately send `{"token":"<access_token>"}` as the first frame (10-second deadline). Credentials must not be put in URLs. Invalid/expired authentication closes with 4401; unauthorized CRIU requests close with 4403/4404.

Fleet frames are JSON (replaces the old bare FLEET_UPDATED string):

```json
{"type":"FLEET_UPDATED","instance_id":null,"reason":"connected"}
{"type":"FLEET_UPDATED","instance_id":"i-...","event_id":123}
{"type":"SESSION_TERMINATED","instance_id":"i-...","event_id":124}
```

On SESSION_TERMINATED, close the active workspace session only if instance_id matches; refetch fleet. Events are persisted transactionally and delivered only to authorized owners/team leads/admins, including changes from Celery. Live delivery polls every 500 ms. Reconnect and refetch: historical events are not replayed on a new connection.

The fleet socket also sends `{"type":"FINOPS_UPDATED","analytics":{...},"runtime":{...}}` every ten seconds, including when no fleet events arrive, and `TELEMETRY_UPDATED` with authorized instance CPU/memory samples and the runtime summary. Event frames include currently scoped analytics; both frontends consume updates and refetch on governance events. Runtime summaries use persisted lifecycle intervals; CloudWatch telemetry freshness is exposed separately. FinOps values are configured-rate estimates, not billed usage or AWS credits.

The CRIU socket streams status text after committing hibernation/snapshot/events. With AWS disabled it reports simulated operations; with AWS enabled it reports the result of the SSM/CRIU path. Closing the terminal does not undo the purge. Logout, stop, shift cutoff and purge emit targeted SESSION_TERMINATED. This WebSocket does not stream the checkpoint image.

Anomaly response: `{status:"ANOMALY_TRIGGERED",off_hours_threat:boolean,context:"Off-Hours Threat"|"In-shift CPU spike"}`. Only powered-on instances can be tested (409 otherwise). Shift checks use SHIFT_TIMEZONE (UTC default; Compose Asia/Kolkata), start-inclusive/end-exclusive boundaries, overnight support, and equal boundaries as 24 hours. Exempt/snoozed nodes are authorized outside shift. Celery checks every 30 seconds.

## Setup and verification

No dummy fleet or default credentials are created. Bootstrap once with `docker compose exec backend python bootstrap_admin.py ADMIN-001 "Chief Architect" platform` and enter a 12+ character password. Sign in at the admin dashboard and provision team leads/employees. Current startup does not seed demo records. Six local legacy demo instances and related snapshots/events were removed on 2026-09-20 with a backup; see README.md. Legacy users without credentials cannot authenticate. Both services share DB_DIR=/app/db in Compose. Native development defaults to backend/db.

Backend tests: `cd backend` then `../.venv/Scripts/python.exe -m unittest test_integration -v` (requires httpx). Frontend: `npm --prefix frontend run build`.

Pricing references: https://aws.amazon.com/ec2/pricing/on-demand/ and https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-archive-pricing.html .

## Sign-up update

The login screen now includes Sign Up. Managers/Admins use **Invite employee** to create a one-use code with a 24-hour expiry.

- `POST /api/invitations` (authenticated management): `{user_id,team_id,role,instances}` -> HTTP 201 `{invitation_token,user_id,expires_at}`; expires_at is Unix seconds. Managers can invite only employees in their own team; admins may invite employees/team leads. Workspace specs match `/api/employees`. Share the code with the intended user; it is returned only at creation.
- `POST /api/auth/signup` (public): `{invitation_token,user_id,name,password}` -> HTTP 201 `{success,access_token,token_type,user,instance_ids}`. Password length 12–128. Role and team come only from the invitation; extra request fields are rejected. Account, workspaces, session and invitation consumption commit atomically. New workspaces are hibernated.
- Signup errors: 400 invalid/expired/used/wrong-user code, 409 existing user, 422 invalid fields. Ordinary invitation signup cannot create administrators. The dedicated `/api/auth/signup/chief-architect` route creates only the first administrator and returns 409 once one exists.

See EMPLOYEE_APP_HANDOFF.md for the complete employee-app implementation instructions.

## First administrator and frontend scope

`POST /api/auth/signup/chief-architect` accepts `{user_id,name,password}` without an invitation and returns HTTP 201 with the authentication payload. It rejects extra fields and uses a SQLite immediate transaction to serialize first-admin creation. An existing administrator or user ID returns 409. The employee portal exposes this flow; `bootstrap_admin.py` is also available.

The command center is this repository's `frontend/`; the employee portal is a separate sibling project at `../The-Downscale-Client/`. Both keep tokens in memory. CORS permits localhost:5173. The command center now has responsive fleet cards and owner-aware search. Its WebSocket reconnect uses a fixed 1.5-second retry without focus refresh; the portal uses exponential backoff and focus reconciliation.

See [project status](PROJECT_STATUS.md) for recorded backend, portal, migration, and browser validation. Documentation-only updates do not rerun those suites.

## Snapshot/demo API additions

`GET /api/instances` adds `demo_available` and `timezone` at the top level. Fleet items add `demo_enabled`, `demo_time`, and `timezone`. Snapshot items add `created_at` (UTC ISO timestamp or null for legacy), `simulated_at` (offset-aware demo timestamp or null), and `legacy_date` (filename-derived date or null).

`POST /api/instance/demo` requires bearer authentication, authorized instance scope, and server `DEMO_MODE=1` (otherwise 403). Request:

```json
{"instance_id":"i-...","enabled":true,"simulated_time":"2026-09-20T18:00","cpu":99.8,"activity":"running","evaluate_now":true}
```

`simulated_time` is optional; naive values mean the server shift timezone and offset-aware values are converted to it. CPU must be finite and 0-100; activity is `running` or `idle`; extra fields are rejected. Returns `{instance, outcome}`. Updating a stopped/hibernated instance does not wake it. CPU/activity affect powered-on instances. Immediate evaluation hibernates powered-on out-of-shift instances, creates a snapshot, and emits normal termination/fleet events. Disabling demo clears the override and evaluates real shift time.

New filenames use `SNAPSHOT_[name]_[YYYYMMDD_HHMMSS]_[unique suffix].IMG`. Snapshot IDs remain the authoritative identity. Use actual creation time for ordering and display demo time separately. No historical memory-image restore is performed.

## Current client presentation

The vault renders one card per instance. Its dropdown contains every retained snapshot for that instance, ordered newest first by actual creation time, with a filename-derived date fallback for legacy records. The newest snapshot is selected initially; selecting an older record updates its details. Equal or unknown timestamps use a stable snapshot-ID tie-breaker, not an invented capture order. Search matches names, instance IDs, and filenames while preserving each matching workspace's full dropdown history. Grouping does not delete records. Restore wakes the workspace rather than loading the selected historical memory image.

The API remains a flat scoped snapshot list. UUID identifies each record; instance ID identifies each grouped card. Timestamp formatting uses the server timezone. Admin labels are Add employee, Invite employee, Hibernate fleet, and Sign out; their REST contracts are unchanged. The portal's dark theme and admin's larger neutral/green theme use the same API.

## Employee station inbox, support, and session telemetry

The separate employee station at `../The-Downscale-Client/` uses the same bearer-authenticated API and `/ws/fleet` socket. New shared API routes are:

- `GET /api/employee/inbox`: returns unexpired global/team announcements visible to the employee, eligible shift-ending notices, and that employee's completed support-request responses.
- `POST /api/support/requests`: creates a persisted `overtime`, `storage`, or `issue` request for the authenticated employee. Workspace association is authorized by the API; a client-supplied owner is not accepted.
- `POST /api/support/requests/{request_id}/decision`: Team Leads and Chief Architects can update request status/respond. Team Leads are restricted to requests in their team; inaccessible records return 404.
- `POST /api/announcements`: Team Leads can post to their team; Chief Architects can select a team or post globally.
- `GET /api/instance/session-state/{instance_id}`: returns the workspace state, SSM live-inspection availability, process/tmux data when available, and the latest recorded RAM/checkpoint metadata. Local mode explicitly returns unavailable inspection; it does not fabricate a shell, process list, RAM footprint, snapshot size, or pane count.

Support requests and announcements are stored in the shared SQLAlchemy database. The SQLite migration adds their tables and the instance telemetry fields; PostgreSQL creates the same metadata through SQLAlchemy. `SUPPORT_REQUEST_CREATED`, `SUPPORT_REQUEST_UPDATED`, and `ANNOUNCEMENT_CREATED` cause authorized clients to refresh inbox data.

The Fleet WebSocket additionally emits:

- `TELEMETRY_UPDATED` every 10 seconds with authorized instance IDs, state, CPU, memory in MB/percent, and the persisted observation timestamp. Missing CloudWatch Agent readings remain `null`.
- `FINOPS_UPDATED` every 10 seconds with the current scoped configured-rate projection. It is an estimate, not billed usage or a credit balance.
- `PONG` with the client's `sent_at` and server time for `PING` frames. The employee portal uses the matching response to show round-trip latency.

These endpoints and messages are covered by backend tests and mocked portal tests. SSM, CloudWatch Agent, live deployment CORS/WSS, and actual AWS service behavior remain unvalidated against a live AWS account.
