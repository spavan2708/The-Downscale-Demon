# Known issues and limitations

Reviewed against local source on 2026-09-20.

## Confirmed limitations

| Area | Current behavior | Follow-up |
| --- | --- | --- |
| Admin native development | Relative API/socket URLs use the Vite origin, but `vite.config.js` has no backend proxy | Add `/api` and `/ws` proxying or use Docker on port 3000 |
| Admin styling | Most existing screens depend on an external Tailwind CDN; fleet cards have bundled CSS | Bundle shared styles for a self-contained deployment |
| Admin live updates | Reconnect uses a fixed 1.5-second timer; no page-focus refresh; incoming JSON is parsed without a guard | Add backoff, reconciliation and defensive parsing |
| Admin request lifecycle | In-flight fleet requests are not cancelled and may complete after session changes | Guard stale responses |
| Admin errors | Structured FastAPI errors are JSON-stringified | Render readable field messages, as the employee portal does |
| Production transport | Compose configures HTTP/WS, with no TLS termination | Configure HTTPS/WSS before public deployment |
| Snapshot simulation | No real CRIU dump/download or remote workspace connection exists | Keep simulation explicit in UX and scope |
| Account sign-out | Clients clear memory; `/api/logout` hibernates a workspace but does not revoke the bearer token | Add revocation if required |
| Database scale | Backend and worker share SQLite; contention under load has not been characterized here | Load-test and evaluate migration when warranted |

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
