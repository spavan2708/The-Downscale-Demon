# Project status — five-step cloud lifecycle roadmap

Reviewed 2026-10-19. This page summarizes current implementation and recorded verification, not a completion percentage.

## Roadmap alignment

Existing features are foundations or local emulations aligned to the pipeline; they do not mean the AWS production step is complete.

| Pipeline step | Existing aligned work | Production gap |
| --- | --- | --- |
| 1. Edge Proxy & Buffering | Feature-gated `/proxy` route enqueues bounded request metadata in SQS, starts EC2, waits for instance/system status health, then forwards and acknowledges after a response | No AWS API Gateway/Lambda deployment, live queue policy/consumer validation, distributed concurrency/idempotency proof, or live warm-up/load tests |
| 2. State Preservation & Hydration | Feature-gated EBS attachment checks, SSM-driven CRIU restore, and SQLAlchemy snapshot metadata for RAM, checkpoint reference, and process tree | No verified OS/kernel/CRIU compatibility matrix, live checkpoint integrity test, open-socket guarantee, or AWS recovery drill |
| 3. Shift RBAC & Anomaly Guard | Employee/Team Lead/Chief Architect authorization, shift-gated operations, 30-second CPU/RAM polling, >85% off-hours isolation, Slack alerts, team-scoped access lockout, session revocation, and forced downscale | No live CloudWatch Agent/metric verification, quarantine-group review, alert-delivery SLA, or production threat-detection tuning |
| 4. Safe Downscale & Storage Unmount | Feature-gated SSM CRIU dump, I/O sync, mount-source verification, unmount/detach checks, stop, and Chief Architect stack termination; termination retains detached EBS data | No live lock-contention/failure recovery, account-level detach/termination evidence, or operator approval runbook |
| 5. FinOps Analytics Engine | Configured-rate AWS cost estimates, active-vs-24x7 projections, persisted state-runtime intervals, latest CloudWatch telemetry, fleet WebSocket updates, and governance charts | No AWS Price List/Cost Explorer reconciliation, actual invoice ingestion, awarded-credit ledger, or live billing accuracy validation |

## Completed local emulation components

- FastAPI service, SQLite persistence, Redis/Celery worker and beat, and nginx-hosted admin app in Docker Compose.
- Employee/admin authentication flows, invitation signup, first-admin creation, role-scoped fleet access, and workspace selection.
- Shift checks, scheduled cutoff, simulated anomaly flags, targeted WebSocket events, and client reconnect/reconciliation.
- Simulated snapshot records with timestamps, demo clock and CPU/activity controls, and grouped snapshot history in both clients.
- Configured-rate compute/snapshot estimates and the existing analytics UI.
- Executive governance dashboard with state-colored fleet map, resource/cost SVG charts, per-workspace active/hibernated runtime, employee access lockout, overtime decisions, shift controls, and actor-attributed audit events.
- Chief Architect-only workspace termination API with server-enforced exact-name confirmation, EBS detach, EC2 termination, and retained detached volume data.
- Database state intervals begin on migration for existing workspaces; their prior runtime is not reconstructed. Runtime savings are modeled compute avoidance, not an AWS credit balance.
- Employee station with server-backed workspace actions, shift/runtime status, inbox/helpdesk APIs, checkpoint history, ping/pong latency, and optional SSM/CloudWatch telemetry. Unknown values remain unreported rather than seeded.
- Disabled-by-default AWS lifecycle adapters for edge buffering/forwarding, EC2/EBS/SSM/CRIU lifecycle, CloudWatch anomaly metrics, quarantine isolation, and periodic FinOps WebSocket updates.
- Previously recorded unit, integration, browser, and build results below; these are historical results, not live AWS verification.

## Current implementation details

- Backend authentication, single-use invitations, first-admin signup, provisioning, and scoped fleet access.
- Shift-gated wake, overnight schedules, 30-second scheduler evaluation, and targeted WebSocket termination/fleet events.
- Simulated CRIU snapshots with actual UTC creation time, optional demo time, and date-only legacy fallback.
- Per-workspace demo clock, CPU and running/idle controls, server capability gating, and immediate evaluation through the employee portal.
- Grouped snapshot history in both apps: one card per instance, newest-first dropdown, searchable history, and larger text.
- Admin command center with locally bundled styling, a responsive governance dashboard, scoped management actions, charts, and audit rows.
- Plain admin action labels: Add employee, Invite employee, Hibernate fleet, and Sign out. Hibernate fleet retains the former Kill Switch behavior.
- Employee portal with a responsive dark enterprise station, server-backed lifecycle/inbox/session state, and visible unavailable-data states.

## Recorded verification

| Scope | Recorded result |
| --- | --- |
| Backend demo behavior | 5 tests passed: authorization/gating, input validation, cutoff, timestamps, clock reset, scheduler behavior, and legacy-date handling |
| Backend integration | 18 tests passed, including governance runtime, lockout, confirmed termination, SDK failure reporting, and periodic FinOps WebSocket delivery |
| First-admin signup | 1 test passed |
| Employee portal | All 11 Playwright tests passed, including lifecycle, reconnect, demo, helpdesk, and signup flows; REST/socket responses were mocked |
| Builds | Both frontend production builds passed; updated backend/worker/admin images were built and recreated during the relevant implementation changes |
| Admin visual refresh | Mocked browser checks passed for all four tabs at 1440px, 390px, and 320px, shift editing, and provisioning-dialog layout with no overflow or runtime errors |
| Migration | Legacy data preserved with nullable timestamps; SQLite integrity check returned `ok` |

The latest recorded verification passed `test_integration.py` (18 tests), `test_demo.py` (5 tests), and `test_chief_signup.py` (1 test); backend compilation and both frontend production builds passed. All 11 employee-portal Playwright tests passed. A browser run with mocked API responses exercised overtime approval, employee lockout, shift update, and confirmed workspace deletion and verified each request method/path/body. AWS calls were mocked or disabled; no live AWS account was used.

## Checklist: switch to live AWS ($100 credit tier)

Treat the credit amount as an account-specific limit, not a guarantee of free use. Confirm the current AWS offer, service eligibility, expiration, and payment terms in the account before creating resources. Do not proceed until each gate is checked:

- [ ] Confirm account ownership, MFA, root-user protection, billing access, and the exact credit balance/expiry/eligible services.
- [ ] Set a low monthly AWS Budget and billing alerts below the available credit; review EC2, EBS, API Gateway, Lambda, SQS, data transfer, logs, and tax/other charges.
- [ ] Define and review the threat model, data classification, retention policy, supported instance/OS/CRIU matrix, regions, and recovery objectives.
- [ ] Provision least-privilege IAM roles for the edge, lifecycle controller, instance operations, EBS operations, and read-only billing inputs; never embed credentials in images or clients.
- [ ] Deploy an isolated test environment with network boundaries, TLS/WSS, secrets management, audit logs, encryption, and an explicit teardown/rollback procedure.
- [ ] Implement and test bounded SQS request payloads, expiry, duplicate delivery/idempotency, response correlation, client timeout behavior, and warm-up failure handling.
- [ ] Validate real CRIU checkpoint compatibility and restore on supported EC2 configurations; test checkpoint integrity, EBS attach/detach, filesystem consistency, failure recovery, and socket limitations.
- [ ] Exercise shift/RBAC denial and CPU/RAM anomaly isolation with audit evidence; ensure an isolation failure cannot be reported as success.
- [ ] Verify the safe-downscale sequence under interrupted I/O and lock contention; stop EC2 only after checkpoint verification and confirmed unmount/detach.
- [ ] Compare FinOps estimates with AWS Cost and Usage data; label estimates separately from billed amounts and verify WebSocket authorization/reconnect behavior.
- [ ] Run staged load, resilience, security, and cost tests; obtain operational approval before exposing live employee traffic.

**Current gate:** AWS code paths are present but remain disabled by default. Keep AWS deployment disabled until the unchecked account, infrastructure, queue, CRIU/EBS, security, FinOps, and live acceptance gates above have evidence.

## Data operations on 2026-09-20

The local Docker cleanup removed six demo instances, seven associated snapshots, and 17 associated events, preserving employee `001`, both `hail` workspaces, and the existing administrator. The later snapshot/demo migration preserved two users, two instances, and four snapshots present at that time, with all pre-migration values verified unchanged. These are historical counts; subsequent user activity can create more snapshots or change instance state.

Backups and retained IDs are documented in [README](README.md). Current code does not seed demo records or restrict future provisioning to those IDs. Snapshot grouping and the admin redesign do not modify stored data.

## Remaining work

See [known issues](KNOWN_ISSUES.md) for native admin API proxying, stronger admin request/reconnect handling, modal keyboard behavior, TLS, SQLite load validation, and simulation limitations.
Also see the employee workspace portal's [KNOWN_ISSUES.md](../The-Downscale-Client/KNOWN_ISSUES.md) for portal-specific limitations including session view scope, UI scope, and test scope differences.
