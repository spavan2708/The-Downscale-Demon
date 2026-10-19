# Project status — five-step cloud lifecycle roadmap

Reviewed 2026-09-20. This page summarizes current implementation and previously recorded verification, not a completion percentage.

## Roadmap alignment

Existing features are foundations or local emulations aligned to the pipeline; they do not mean the AWS production step is complete.

| Pipeline step | Existing aligned work | Production gap |
| --- | --- | --- |
| 1. Edge Proxy & Buffering | Feature-gated `/proxy` route enqueues bounded request metadata in SQS, starts EC2, waits for instance/system status health, then forwards and acknowledges after a response | No AWS API Gateway/Lambda deployment, live queue policy/consumer validation, distributed concurrency/idempotency proof, or live warm-up/load tests |
| 2. State Preservation & Hydration | Feature-gated EBS attachment checks, SSM-driven CRIU restore, and SQLAlchemy snapshot metadata for RAM, checkpoint reference, and process tree | No verified OS/kernel/CRIU compatibility matrix, live checkpoint integrity test, open-socket guarantee, or AWS recovery drill |
| 3. Shift RBAC & Anomaly Guard | Employee/Team Lead/Chief Architect authorization, shift-gated wake/proxy operations, 30-second CPU/RAM polling, >85% off-hours isolation, and optional Slack alerts | No live CloudWatch Agent/metric verification, quarantine-group review, alert-delivery SLA, or production threat-detection tuning |
| 4. Safe Downscale & Storage Unmount | Feature-gated SSM CRIU dump, I/O sync, mount-source verification, unmount check, EBS detach wait, and AWS `ec2.stop_instances`; local mode remains simulated | No tested production process-quiesce hook, lock-contention/failure recovery, live detach/stop ordering evidence, or operator approval runbook |
| 5. FinOps Analytics Engine | Configurable AWS On-Demand rate projections, active-vs-24x7 baseline, and scoped `FINOPS_UPDATED` WebSocket payloads consumed by both clients | No AWS Price List/Cost Explorer reconciliation, actual invoice ingestion, awarded-credit ledger, or live billing accuracy validation |

## Completed local emulation components

- FastAPI service, SQLite persistence, Redis/Celery worker and beat, and nginx-hosted admin app in Docker Compose.
- Employee/admin authentication flows, invitation signup, first-admin creation, role-scoped fleet access, and workspace selection.
- Shift checks, scheduled cutoff, simulated anomaly flags, targeted WebSocket events, and client reconnect/reconciliation.
- Simulated snapshot records with timestamps, demo clock and CPU/activity controls, and grouped snapshot history in both clients.
- Configured-rate compute/snapshot estimates and the existing analytics UI.
- Disabled-by-default AWS lifecycle adapters for edge buffering/forwarding, EC2/EBS/SSM/CRIU lifecycle, CloudWatch anomaly metrics, quarantine isolation, and periodic FinOps WebSocket updates.
- Previously recorded unit, integration, browser, and build results below; these are historical results, not live AWS verification.

## Current implementation details

- Backend authentication, single-use invitations, first-admin signup, provisioning, and scoped fleet access.
- Shift-gated wake, overnight schedules, 30-second scheduler evaluation, and targeted WebSocket termination/fleet events.
- Simulated CRIU snapshots with actual UTC creation time, optional demo time, and date-only legacy fallback.
- Per-workspace demo clock, CPU and running/idle controls, server capability gating, and immediate evaluation through the employee portal.
- Grouped snapshot history in both apps: one card per instance, newest-first dropdown, searchable history, and larger text.
- Admin command center with locally bundled styling, 18px base text, neutral surfaces, green accents, responsive header, structured shift rows, and savings-first analytics.
- Plain admin action labels: Add employee, Invite employee, Hibernate fleet, and Sign out. Hibernate fleet retains the former Kill Switch behavior.
- Employee portal with dark styling, visible unavailable-demo feedback, fixed development port, and its own workspace lifecycle.

## Recorded verification

| Scope | Recorded result |
| --- | --- |
| Backend demo behavior | 5 tests passed: authorization/gating, input validation, cutoff, timestamps, clock reset, scheduler behavior, and legacy-date handling |
| Existing backend integration | 7 tests passed |
| First-admin signup | 1 test passed |
| Employee portal | All 10 Playwright tests passed after snapshot grouping, including newest-first selection and history switching; REST/socket responses were mocked |
| Builds | Both frontend production builds passed; updated backend/worker/admin images were built and recreated during the relevant implementation changes |
| Admin visual refresh | Mocked browser checks passed for all four tabs at 1440px, 390px, and 320px, shift editing, and provisioning-dialog layout with no overflow or runtime errors |
| Migration | Legacy data preserved with nullable timestamps; SQLite integrity check returned `ok` |

Historical results above were recorded during earlier implementation work. For the current lifecycle refactor, `test_integration.py` (11 tests), `test_demo.py` (5 tests), `test_chief_signup.py` (1 test), backend compilation, both frontend builds, and all 10 employee-portal Playwright tests passed. AWS calls were mocked or disabled; no live AWS account was used.

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
