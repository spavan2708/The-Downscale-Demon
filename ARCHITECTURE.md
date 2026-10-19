# Architecture

Source review: 2026-09-20.

## Target five-step lifecycle data flow

```text
Client
  |
  | HTTP request
  v
[1 Edge Proxy & Buffering]
API Gateway / Lambda -> SQS (request ID + bounded payload)
  |                         |
  | instance ready          | hold until warm-up completes
  +-------------------------+
  |
  v
[2 State Preservation & Hydration]
Wake EC2 -> attach checkpoint EBS -> validate/restore CRIU RAM + terminal history
  |
  v
[3 Shift RBAC & Anomaly Guard]
Employee -> Team Lead -> Chief Architect authorization
Shift window + CPU/RAM anomaly assessment -> allow or isolate
  |
  v
[4 Safe Downscale & Storage Unmount]
On shift end/logout: pause file descriptors -> quiesce -> flush locks/I/O
  -> checkpoint -> unmount/detach EBS
  -> AWS SDK ec2.stop_instances
  |
  v
[5 FinOps Analytics Engine]
Real-time active usage vs 24x7 baseline -> savings estimate -> WebSocket stream
```

The guard is the policy boundary for both wake and downscale actions. Buffered requests are replayed only after the instance is ready and the request remains authorized; the edge must correlate the queued request with its response and enforce payload, timeout, retry, and idempotency limits. The restore step requires a compatible kernel, CPU feature set, CRIU version, and checkpoint layout. Socket restoration is best-effort and application/protocol dependent; it is not a general guarantee. The safe-downscale step must confirm unmount/detach completion before stopping the instance. FinOps values are estimates until reconciled with AWS billing data.

## Current local runtime (implemented prototype)

```text
Admin browser -> nginx :3000 -> FastAPI :8000
Employee portal :5173 -------> FastAPI :8000
                                  |
                              SQLite volume
                                  |
Redis broker <-------------- Celery worker + beat
```

nginx serves `frontend/dist` and proxies `/api/` and `/ws/` to the backend. The sibling portal uses `VITE_API_BASE_URL` and derives its WebSocket URL from that value.

Compose leaves AWS operations disabled. When explicitly enabled, the backend's `/proxy/{instance_id}/{path}` path queues a bounded request envelope in SQS, starts the bound EC2 instance, waits for EC2 system/instance status checks, confirms EBS attachment, restores the latest CRIU checkpoint through SSM, then forwards the held request. Downscale runs remote CRIU via SSM, verifies the mount source, unmounts and confirms EBS detach before stopping EC2. CloudWatch CPU/memory metrics feed the scheduler; a quarantine security group and optional Slack webhook provide isolation/alert delivery. This code does not provision API Gateway/Lambda, SQS queues, EC2/EBS resources, IAM policies, SSM/CloudWatch agents, or health-check targets. The opt-in path has mocked tests only and is not a deployed or AWS-certified data path.

## Target component responsibilities and communication

| Step | Component | Responsibility and handoff |
| --- | --- | --- |
| 1 | Edge Proxy & Buffering | Accept HTTP traffic for an unavailable workspace, enqueue bounded request envelopes in SQS, trigger/observe warm-up, and replay with request/response correlation when readiness is confirmed. |
| 2 | State Preservation & Hydration | Start the assigned EC2 instance, attach checkpoint EBS storage, validate checkpoint/runtime compatibility, restore RAM and terminal history with CRIU, attempt compatible socket restoration, then report readiness to the edge. |
| 3 | Shift RBAC & Anomaly Guard | Enforce the Employee -> Team Lead -> Chief Architect role hierarchy and shift window for lifecycle operations; inspect off-hours CPU/RAM signals and isolate an anomalous workspace. |
| 4 | Safe Downscale & Storage Unmount | Stop accepting new work, quiesce processes through the configured CRIU operation, flush storage, create the checkpoint, confirm unmount/detach, then call AWS SDK `ec2.stop_instances`. |
| 5 | FinOps Analytics Engine | Compare tracked active runtime with the configured 24x7 baseline, calculate modeled compute avoidance, and publish runtime and metric updates to authorized clients over WebSockets. |

Lifecycle envelopes carry workspace and request correlation IDs and expiration; SQS message retention, redrive policy, idempotent replay, client timeout, and duplicate-delivery behavior must be configured and verified in AWS. Each lifecycle stage reports failure instead of signaling readiness or shutdown success prematurely. AWS credentials and role assignments must remain server-side.

## Backend modules

| File | Responsibility |
| --- | --- |
| `backend/app.py` | REST routes, provisioning, invitations, WebSocket authentication and streaming |
| `backend/auth.py` | PBKDF2 password hashes, opaque bearer sessions, role and instance authorization |
| `backend/database.py` | SQLAlchemy models, SQLite setup, additive migrations, state interval and actor-attributed event records |
| `backend/engine.py` | Shift rules, observed runtime/cost summaries, simulated or gated AWS lifecycle operations, CRIU/EBS metadata, request proxying and serialization |
| `backend/scheduler.py` | Celery shift evaluation and gated CloudWatch anomaly polling every 30 seconds |
| `backend/bootstrap_admin.py` | Interactive administrator provisioning |

Tables: users, instances, snapshots, sessions, events, invitations, support requests, announcements, and runtime intervals. Session and invitation tokens are stored as SHA-256 hashes. Sessions expire after eight hours; invitations after 24 hours. Invitation redemption uses a conditional unused/unexpired UPDATE in the same transaction as account and workspace creation. First-admin signup uses SQLite `BEGIN IMMEDIATE`. Runtime tracking starts at migration time for pre-existing instances; historical runtime is not inferred.

## Authorization and synchronization

Admins see all instances, managers see instances owned by users in their assigned team, and employees see their own. REST requests carry `Authorization: Bearer <token>`. WebSockets receive the token in the first JSON frame within ten seconds. Invalid/expired socket credentials close with 4401.

`GET /api/instances` returns scoped fleet, snapshots, and analytics. Team Leads and Chief Architects also use `/api/governance/overview` for team-scoped workforce controls, pending support requests, audit events, runtime intervals, and cost summaries. Access blocking deletes sessions and prevents future authentication; authorized sockets close when their token is revalidated. Chief Architect workspace deletion confirms the exact name and, with AWS enabled, detaches but retains EBS data before terminating EC2. Transactional events drive `FLEET_UPDATED` and targeted `SESSION_TERMINATED`; the fleet socket polls persisted events every 500 ms. A global fleet update after deletion prompts both clients to refetch. See [integration report](INTEGRATION_REPORT.md) for endpoint contracts.

## Shift and billing behavior

The backend uses `SHIFT_TIMEZONE` (UTC default; Asia/Kolkata in Compose). Boundaries are start-inclusive/end-exclusive, overnight shifts are supported, and equal boundaries mean 24 hours. Exempt or snoozed instances bypass shift restrictions. Updating a shift hibernates a powered-on instance if it falls outside the new window. State transitions close a persisted runtime interval and begin a new one; totals classify isolated/running/idle as active and stopped/hibernated as hibernated. The scheduler stores CloudWatch CPU/memory observations separately. Rate-based lifetime avoided compute is modeled savings, not AWS-issued credits or a billing-ledger result.

With AWS disabled, CRIU remains a simulation that records metadata and streams terminal text. With AWS enabled, remote CRIU dump/restore runs through SSM against the configured process and attached checkpoint volume; it requires a compatible OS/kernel/CRIU, sufficient SSM permissions, a supported process tree, and verified device/mount configuration. Compute estimates include running, idle, and isolated instances. Rates can be supplied using `EC2_HOURLY_RATES_JSON`; there is no live AWS Price List or Cost Explorer ingestion, and projected savings are not awarded credits.

## Frontend structure

The command center uses `frontend/src/App.jsx` for tabs, forms, fleet fetching, and actions. `context/AppContext.jsx` owns in-memory authentication and fetch helpers. `components/InstanceCard.jsx` and `fleet.css` implement the responsive fleet cards. `TerminalStream.jsx` displays simulated purge logs. `command.css` supplies the command-center layout, typography, forms, and dialogs. All admin styling is bundled locally; the Tailwind CDN dependency has been removed.

The employee portal is a separate React app. `../The-Downscale-Client/src/context/AppContext.jsx` owns in-memory authentication, REST access, fleet refresh, WebSocket reconnect, ping/pong latency, telemetry, and inbox refresh signals; `src/App.jsx` renders the employee station and its feature views. The admin command center uses `frontend/src/components/GovernanceDashboard.jsx` for the executive summary, fleet matrix/resource/cost charts, employee lockout and overtime controls, and audit history. Its styling is maintained separately from the employee app. Neither app uses React Router or React Query. Both keep access tokens in memory, not localStorage.

## Persistence and deployment

Docker backend and worker share `/app/db`; native development uses `backend/db` unless configured otherwise. These are separate databases. The September 20 cleanup changed only the running Docker data and did not add deletion-on-startup behavior. See [README](README.md) for the backup and retained records.

## Snapshot timestamps and demo clock

Additive migrations add nullable `snapshots.created_at` / `simulated_at` and `instances.demo_enabled` / `demo_time`. Startup serializes migrations with SQLite `BEGIN IMMEDIATE`. Legacy snapshot timestamps remain null; the API extracts only a date from old filenames.

`engine.instance_now()` uses the instance's fixed simulated time only when both `DEMO_MODE=1` and `demo_enabled` are true. The shared `in_shift()` function makes REST wake/shift/anomaly checks and Celery use the same effective clock. Actual snapshot creation uses UTC wall time. `POST /api/instance/demo` authorizes the target through `require_instance`, validates CPU/activity/time, persists overrides, emits a fleet event, and can run shift evaluation immediately. It does not grant exemption or snooze privileges.

`components/SnapshotVault.jsx` and its CSS exist in both frontend projects. The portal additionally uses `components/DemoControls.jsx`. They remain separate build artifacts; keep shared snapshot rendering consistent when changing the API. For employee portal-specific snapshot vault implementation, see [its architecture](../The-Downscale-Client/ARCHITECTURE.md).

## Current presentation and snapshot grouping

`command.css` is loaded after fleet and snapshot styles to apply the admin's 18px base type, 16px buttons, responsive header, underlined navigation, shift columns, and savings-first analytics. The employee station has a separate responsive dark theme and employee-focused navigation; admin styles are not shared with it. See the employee portal's [architecture](../The-Downscale-Client/ARCHITECTURE.md) for its components, API context, and live-data behavior.

The vault renders one card per instance. Its dropdown contains every retained snapshot for that instance, ordered newest first by actual creation time, with a filename-derived date fallback for legacy records. The newest snapshot is selected initially; selecting an older record updates its details. Equal or unknown timestamps use a stable snapshot-ID tie-breaker, not an invented capture order. Search matches names, instance IDs, and filenames while preserving each matching workspace's full dropdown history. Grouping does not delete records. Restore wakes the workspace rather than loading the selected historical memory image.

The snapshot API still returns a flat list; grouping and selection live in `SnapshotVault.jsx` in each frontend. The admin supplies an `onRestore` callback; the portal displays history and starts workspaces through its own picker. There is no snapshot-ID restore endpoint.
