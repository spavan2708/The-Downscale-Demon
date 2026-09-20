# Architecture

Source review: 2026-09-20.

## Runtime layout

```text
Admin browser -> nginx :3000 -> FastAPI :8000
Employee portal :5173 -------> FastAPI :8000
                                  |
                              SQLite volume
                                  |
Redis broker <-------------- Celery worker + beat
```

nginx serves `frontend/dist` and proxies `/api/` and `/ws/` to the backend. The sibling portal uses `VITE_API_BASE_URL` and derives its WebSocket URL from that value.

## Backend modules

| File | Responsibility |
| --- | --- |
| `backend/app.py` | REST routes, provisioning, invitations, WebSocket authentication and streaming |
| `backend/auth.py` | PBKDF2 password hashes, opaque bearer sessions, role and instance authorization |
| `backend/database.py` | SQLAlchemy models, SQLite setup, additive legacy-user migrations |
| `backend/engine.py` | Shift rules, hibernation, snapshot metadata, serialization and billing estimates |
| `backend/scheduler.py` | Celery shift evaluation every 30 seconds |
| `backend/bootstrap_admin.py` | Interactive administrator provisioning |

Tables: users, instances, snapshots, sessions, events, invitations. Session and invitation tokens are stored as SHA-256 hashes. Sessions expire after eight hours; invitations after 24 hours. Invitation redemption uses a conditional unused/unexpired UPDATE in the same transaction as account and workspace creation. First-admin signup uses SQLite `BEGIN IMMEDIATE`.

## Authorization and synchronization

Admins see all instances, managers see instances owned by users in their assigned team, and employees see their own. REST requests carry `Authorization: Bearer <token>`. WebSockets receive the token in the first JSON frame within ten seconds. Invalid/expired socket credentials close with 4401.

`GET /api/instances` returns scoped fleet, snapshots, and analytics. Transactional events drive `FLEET_UPDATED` and targeted `SESSION_TERMINATED`; the fleet socket polls persisted events every 500 ms. Reconnection requires a fresh fleet fetch because historical events are not replayed. See [integration report](INTEGRATION_REPORT.md) for endpoint contracts.

## Shift and billing behavior

The backend uses `SHIFT_TIMEZONE` (UTC default; Asia/Kolkata in Compose). Boundaries are start-inclusive/end-exclusive, overnight shifts are supported, and equal boundaries mean 24 hours. Exempt or snoozed instances bypass shift restrictions. Updating a shift hibernates a powered-on instance if it falls outside the new window.

CRIU is a simulation that records snapshot metadata and streams terminal text; it does not save or download real process memory. Compute estimates include running and idle instances. Retained snapshots remain billed after wake. Estimates use configured rates and a 30-day month, not live provider invoices.

## Frontend structure

The command center uses `frontend/src/App.jsx` for tabs, forms, fleet fetching, and actions. `context/AppContext.jsx` owns in-memory authentication and fetch helpers. `components/InstanceCard.jsx` and `fleet.css` implement the responsive fleet cards. `TerminalStream.jsx` displays simulated purge logs. `command.css` supplies the command-center layout, typography, forms, and dialogs. All admin styling is bundled locally; the Tailwind CDN dependency has been removed.

The employee portal is a separate React app using local state/refs in its own `src/App.jsx`, native fetch/WebSocket, and build-time Tailwind. Neither current app uses React Router or React Query. Both keep access tokens in memory, not localStorage.

## Persistence and deployment

Docker backend and worker share `/app/db`; native development uses `backend/db` unless configured otherwise. These are separate databases. The September 20 cleanup changed only the running Docker data and did not add deletion-on-startup behavior. See [README](README.md) for the backup and retained records.

## Snapshot timestamps and demo clock

Additive migrations add nullable `snapshots.created_at` / `simulated_at` and `instances.demo_enabled` / `demo_time`. Startup serializes migrations with SQLite `BEGIN IMMEDIATE`. Legacy snapshot timestamps remain null; the API extracts only a date from old filenames.

`engine.instance_now()` uses the instance's fixed simulated time only when both `DEMO_MODE=1` and `demo_enabled` are true. The shared `in_shift()` function makes REST wake/shift/anomaly checks and Celery use the same effective clock. Actual snapshot creation uses UTC wall time. `POST /api/instance/demo` authorizes the target through `require_instance`, validates CPU/activity/time, persists overrides, emits a fleet event, and can run shift evaluation immediately. It does not grant exemption or snooze privileges.

`components/SnapshotVault.jsx` and its CSS exist in both frontend projects. The portal additionally uses `components/DemoControls.jsx`. They remain separate build artifacts; keep shared snapshot rendering consistent when changing the API. For employee portal-specific snapshot vault implementation, see `../employee-workspace-portal/ARCHITECTURE.md`.

## Current presentation and snapshot grouping

`command.css` is loaded after fleet and snapshot styles to apply the admin's 18px base type, 16px buttons, responsive header, underlined navigation, shift columns, and savings-first analytics. The employee portal retains its dark Tailwind theme; the admin refresh does not automatically restyle the sibling application. See the employee portal's [Grouped snapshot history](#grouped-snapshot-history) section for portal-specific details.

## Current presentation and snapshot grouping

`command.css` is loaded after fleet and snapshot styles to apply the admin's 18px base type, 16px buttons, responsive header, underlined navigation, shift columns, and savings-first analytics. The employee app retains its dark Tailwind theme; the admin refresh does not automatically restyle the sibling application.

The vault renders one card per instance. Its dropdown contains every retained snapshot for that instance, ordered newest first by actual creation time, with a filename-derived date fallback for legacy records. The newest snapshot is selected initially; selecting an older record updates its details. Equal or unknown timestamps use a stable snapshot-ID tie-breaker, not an invented capture order. Search matches names, instance IDs, and filenames while preserving each matching workspace's full dropdown history. Grouping does not delete records. Restore wakes the workspace rather than loading the selected historical memory image.

The snapshot API still returns a flat list; grouping and selection live in `SnapshotVault.jsx` in each frontend. The admin supplies an `onRestore` callback; the portal displays history and starts workspaces through its own picker. There is no snapshot-ID restore endpoint.
