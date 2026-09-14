# INTEGRATION REPORT FOR AGENT 2

## Authentication and isolation

All REST endpoints except the two login endpoints require `Authorization: Bearer <access_token>`. Roles are persisted server-side: `employee` (own instances), `manager` (assigned team), `admin` (entire fleet). Client role claims are never accepted. Snapshots, analytics, mutations and event delivery use the same scope. Unauthorized instance IDs return 404; management-only actions return 403 for employees.

- `POST /api/auth/login`: `{user_id,password}` ? `{success,access_token,token_type,user:{id,name,role,team_id}}`. Authenticates without waking a workspace; tokens expire after eight hours.
- `GET /api/me`: authenticated user identity.
- `GET /api/instances`: `{fleet,analytics,snapshots}` within caller scope. Use this to reconcile state after connecting/reconnecting.
- `POST /api/login`: `{user_id,password,instance_id?}` authenticates and wakes an owned workspace within shift. Select `instance_id` when several exist (otherwise 409). Returns token/user plus `user_id,instance_id,instance_name,shift`.
- `POST /api/employees`: Manager/Admin provisioning, atomically creates a user and 1–20 initially hibernated instances. Example:

```json
{"user_id":"EMP-100","name":"Alex","password":"choose-a-unique-password","team_id":"platform","role":"employee","instances":[{"name":"Alex Workspace","instance_type":"t3.medium","shift_start":"09:00","shift_end":"18:00"}]}
```

Returns HTTP 201 `{user,instance_ids}`; duplicate user ID ? 409. Managers can only create employees within their team. Admins may also create `manager` accounts for any team.

Existing authenticated mutation endpoints: `/api/shift/update` (`instance_id,shift_start,shift_end`, management only), `/api/instance/state` (`instance_id,target_state`: running/hibernated/stopped), `/api/instance/anomaly-simulate` and `/api/logout` (`instance_id`). Logout hibernates the specified workspace. Failures use HTTP error status and `{detail}`.

## FinOps formulas

USD current-state projections, not historical invoices or live AWS price quotes. Configured compute rates: t3.medium=0.0416/hour; c5.xlarge=0.1700/hour; r5.large=0.1260/hour.

- compute_hourly = sum(rate[type] for running or idle instances). Idle means powered on. Hibernated/stopped contribute zero.
- compute_daily = compute_hourly × 24.
- snapshot_gb = sum(retained snapshot size_mb) / 1024 (size_mb stores MiB).
- snapshot_monthly = snapshot_gb × SNAPSHOT_GB_MONTH_RATE (default $0.05).
- total_daily = compute_daily + snapshot_monthly / 30.
- daily_savings = (all-allocated-instance hourly baseline - compute_hourly) × 24 - snapshot_monthly / 30.
- downscale_rate = hibernated non-exempt instances / all non-exempt instances × 100; empty denominator gives zero.

Snapshots remain billable after wake. CRIU is simulated; each new hibernation records 34.2 MiB, independently retained (no incremental block deduplication). Filenames: `SNAPSHOT_[sanitized Instance_Name]_[YYYYMMDD].IMG`; UUID snapshot IDs distinguish repeated dumps. EC2 ancillary charges and live metered usage are outside this estimate.

## WebSockets

Connect `/ws/fleet` or `/ws/criu-dump/{instance_id}` and immediately send `{"token":"<access_token>"}` as the first frame (10-second deadline). Credentials must not be put in URLs. Invalid/expired authentication closes with 4401; unauthorized CRIU requests close with 4403/4404.

Fleet frames are JSON (replaces the old bare FLEET_UPDATED string):

```json
{"type":"FLEET_UPDATED","instance_id":null,"reason":"connected"}
{"type":"FLEET_UPDATED","instance_id":"i-...","event_id":123}
{"type":"SESSION_TERMINATED","instance_id":"i-...","event_id":124}
```

On SESSION_TERMINATED, close the active workspace session only if instance_id matches; refetch fleet. Events are persisted transactionally and delivered only to authorized owners/team leads/admins, including changes from Celery. Live delivery polls every 500 ms. Reconnect and refetch: historical events are not replayed on a new connection.

CRIU socket streams text logs after committing the hibernation/snapshot/events. Closing the terminal does not undo the purge. Logout, stop, shift cutoff and purge all emit targeted SESSION_TERMINATED.

Anomaly response: `{status:"ANOMALY_TRIGGERED",off_hours_threat:boolean,context:"Off-Hours Threat"|"In-shift CPU spike"}`. Only powered-on instances can be tested (409 otherwise). Shift checks use SHIFT_TIMEZONE (UTC default; Compose Asia/Kolkata), start-inclusive/end-exclusive boundaries, overnight support, and equal boundaries as 24 hours. Exempt/snoozed nodes are authorized outside shift. Celery checks every 30 seconds.

## Setup and verification

No dummy fleet or default credentials are created. Bootstrap once with `docker compose exec backend python bootstrap_admin.py ADMIN-001 "Chief Architect" platform` and enter a 12+ character password. Sign in at the admin dashboard and provision team leads/employees. Legacy fleet records remain preserved; legacy users without credentials remain locked. Both services share DB_DIR=/app/db in Compose. Native development defaults to backend/db.

Backend tests: `cd backend` then `../.venv/Scripts/python.exe -m unittest test_integration -v` (requires httpx). Frontend: `npm --prefix frontend run build`.

Pricing references: https://aws.amazon.com/ec2/pricing/on-demand/ and https://docs.aws.amazon.com/ebs/latest/userguide/snapshot-archive-pricing.html .

## Sign-up update

The login screen now includes Sign Up. Managers/Admins use **Invite to Sign Up** to create a one-use code with a 24-hour expiry.

- `POST /api/invitations` (authenticated management): `{user_id,team_id,role,instances}` ? HTTP 201 `{invitation_token,user_id,expires_at}`; expires_at is Unix seconds. Managers can invite only employees in their own team; admins may invite employees/team leads. Workspace specs match `/api/employees`. Share the code with the intended user; it is returned only at creation.
- `POST /api/auth/signup` (public): `{invitation_token,user_id,name,password}` ? HTTP 201 `{success,access_token,token_type,user,instance_ids}`. Password length 12–128. Role and team come only from the invitation; extra request fields are rejected. Account, workspaces, session and invitation consumption commit atomically. New workspaces are hibernated.
- Signup errors: 400 invalid/expired/used/wrong-user code, 409 existing user, 422 invalid fields. Signup does not create public administrator accounts.

See EMPLOYEE_APP_HANDOFF.md for the complete employee-app implementation instructions.
