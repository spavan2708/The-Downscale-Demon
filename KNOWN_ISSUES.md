# Known issues and limitations

Reviewed against local source on 2026-10-19.

## Five-step lifecycle mitigations and remaining validation

The backend now contains disabled-by-default mitigations for the lifecycle failures below. These are **implemented code paths, not verified production fixes**: no live ALB/API Gateway/SQS/EC2/EBS/CRIU environment was used in tests. The issues remain open for deployment acceptance until failure cases are reproduced and the mitigations are tested on AWS.

| Failure mode | Implemented mitigation | Acceptance evidence still required |
| --- | --- | --- |
| Requests reach a sleeping instance and clients see a 502 during warm-up | Opt-in `/proxy` path queues a bounded request envelope in SQS, waits for EC2 status health and CRIU hydration, forwards the held request, and acknowledges its queue message after an upstream response | Cold-start/load tests, request timeout limits, duplicate/expired message behavior, queue redrive/retention, response delivery, and warm-up/upstream failure recovery |
| EBS reports `VolumeInUse` or remains attached during shutdown | Opt-in downscale verifies the mounted device and attachment, syncs storage, dumps with CRIU, confirms unmount and detach, then calls `ec2.stop_instances` | Interrupted I/O/lock tests, live detach confirmation, retries, partial-failure recovery, and proof stop never precedes safe detach |

This roadmap does not make arbitrary HTTP requests replay-safe, guarantee restoration of open TCP sockets, or guarantee that AWS credits cover all charges. Those behaviors need explicit contracts and verification.

## Confirmed limitations

| Area | Current behavior | Follow-up |
| --- | --- | --- |
| Admin native development | Relative API/socket URLs use the Vite origin, but `vite.config.js` has no backend proxy | Add `/api` and `/ws` proxying or use Docker on port 3000 |
| Admin live updates | Reconnect uses a fixed 1.5-second timer and does not refresh on page focus | Add backoff and focus reconciliation |
| Admin request lifecycle | In-flight fleet requests are not cancelled and may complete after session changes | Guard stale responses |
| Admin errors | Structured FastAPI errors are JSON-stringified | Render readable field messages, as the employee portal does |
| Governance runtime | Database runtime intervals begin at migration time for existing instances and record API/scheduler-observed transitions; earlier runtime is not reconstructed, and out-of-band EC2 state changes are not an authoritative billed-uptime record | Reconcile with AWS state observations and AWS Cost and Usage data before treating hours or savings as billing-grade |
| FinOps credits | The executive dashboard's preserved-credit number is configured-rate avoided compute, not actual AWS promotional credits or invoice savings; managed cost charts omit ancillary charges | Reconcile with billing exports and keep projected savings distinct from credit balances |
| Workspace termination | The new endpoint detaches and retains EBS volumes while terminating EC2; AWS termination behavior is mock-tested only | Confirm retention/deletion policy, IAM permissions, and detach/termination failure recovery in an isolated AWS account |
| Employee lockout | Session revocation is immediate and persists if a downscale fails; the API surfaces a 503 with affected workspace details in that case | Review the failure, confirm the account remains blocked, and retry downscale after remediation |
| Production transport | Compose configures HTTP/WS, with no TLS termination | Configure HTTPS/WSS before public deployment |
| Snapshot/restore transport | Local mode remains simulated; the opt-in SSM/CRIU path has only mocked lifecycle tests and no live compatibility validation | Verify SSM permissions, kernel/CRIU support, process/socket behavior, mount mapping, image integrity, and recovery before production |
| Employee session inspection | The portal can request SSM process/tmux inspection only when AWS lifecycle is enabled; local mode returns unavailable, not a remote shell | Validate SSM permissions/identity and explicitly scope any future interactive terminal transport |
| Employee inbox and telemetry | Helpdesk/announcement data is persisted and scoped, while telemetry depends on scheduler observations and CloudWatch Agent memory metrics | Exercise authorization and event refresh on a deployed API; verify real CPU/memory samples and freshness |
| Account sign-out | Client sign-out clears local memory; workspace `/api/logout` hibernates a workspace but does not revoke the account bearer token. Governance lockout separately revokes all stored sessions | Add user-initiated server-side token revocation if required |
| Database scale | Backend and worker share SQLite; contention under load has not been characterized here | Load-test and evaluate migration when warranted |

The confirmed limitations above describe the current default/local behavior and unvalidated production boundaries. See [project status](PROJECT_STATUS.md) for the step-by-step AWS implementation gaps and credit-tier readiness checklist.

## Behavior to understand

Changing a shift can immediately hibernate a running/idle instance outside the new window. This is present server behavior, not evidence of a missing `in_shift()` check. The anomaly flag deliberately identifies off-hours activity; an in-shift CPU spike is not labeled an off-hours threat.

The legacy `/api/login` still combines authentication and workspace wake. New clients should use `/api/auth/login`, then select a workspace and call `/api/instance/state`.

## Corrections to earlier documentation

- `system_now()` already reads `SHIFT_TIMEZONE`; timezone drift was not reproduced in this review.
- Invitation redemption already uses a conditional UPDATE and checks its affected-row count within a transaction. `synchronize_session=False` alone is not evidence of double redemption. Additional concurrent-redemption validation remains useful.
- `test_chief_signup.py` checks competing first-admin creation, not invitation redemption.
- Manager/admin invitation generation already exists in the command center.
- SQLite contention is a risk to measure, not proof of database corruption.

## Resolved on 2026-09-20

Cluttered command-center fleet metadata, damaged separators, the undefined reset-fleet action, and the six legacy demo instances were addressed. Demo snapshots/events were removed with a backup; see [README](README.md). This cleanup does not restrict future legitimate provisioning.

Portal-specific notes: Demo controls require `DEMO_MODE=1` and an owned workspace with `demo_available: true` (see employee portal [KNOWN_ISSUES.md](../The-Downscale-Client/KNOWN_ISSUES.md)). Admin native development still needs Vite proxy configuration or Docker on port 3000.

## Snapshot/demo limitations

- Exact legacy snapshot times cannot be recovered from date-only filenames. Existing records display `time not recorded` rather than a guessed timestamp.
- Restore wakes a workspace and restores the newest compatible checkpoint only when the AWS lifecycle path is enabled; selecting older vault metadata does not select that image. Local mode remains simulated.
- Demo settings persist per workspace until disabled and are visible to authorized users. The regular scheduler still evaluates every 30 seconds; use immediate evaluation to skip that delay.
- CPU/activity controls apply to powered-on workspaces. They do not wake a hibernated workspace. Set an in-shift clock, then use Start / Restore and apply metrics.
- Demo CPU > 85 outside shift flags an anomaly; the scheduler polls CloudWatch CPU and memory when AWS is enabled and isolates if either exceeds 85. Without AWS, it uses simulated CPU and has no memory metric. Network thresholds and CPU-based idle timeouts are not implemented.
- `DEMO_MODE` defaults off outside Compose. Keep its value consistent between API and worker. Disabling it ignores saved demo clocks; turning a workspace toggle off also clears that workspace's saved override.

## Current UI behavior and remaining gaps

The executive governance dashboard, state-colored fleet matrix, CPU/memory and hourly-cost charts, employee lockout, pending overtime controls, and audit view are implemented. Admin styling is bundled; CDN availability is no longer a dependency. The employee portal intentionally retains a separate dark theme. The admin's Hibernate fleet action is the previous Kill Switch operation under a clearer label.

Modal dialogs declare dialog semantics, but focus trapping, Escape-to-close, and focus restoration are not implemented. The recent responsive/browser checks do not establish a full accessibility audit.

Snapshots recorded before timestamp support cannot be ordered precisely within the same known date; the dropdown uses a stable ID tie-breaker. Selecting a historical snapshot changes displayed metadata, not which process-memory image is restored. See the [README troubleshooting section](README.md#missing-demo-controls-or-stale-ui) if demo controls or refreshed screens are missing.
