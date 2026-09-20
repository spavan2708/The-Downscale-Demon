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

The command center uses `frontend/src/App.jsx` for tabs, forms, fleet fetching, and actions. `context/AppContext.jsx` owns in-memory authentication and fetch helpers. `components/InstanceCard.jsx` and `fleet.css` implement the responsive fleet cards. `TerminalStream.jsx` displays simulated purge logs. Other command-center styling uses the Tailwind CDN loaded in `frontend/index.html`.

The employee portal is a separate React app using local state/refs in its own `src/App.jsx`, native fetch/WebSocket, and build-time Tailwind. Neither current app uses React Router or React Query. Both keep access tokens in memory, not localStorage.

## Persistence and deployment

Docker backend and worker share `/app/db`; native development uses `backend/db` unless configured otherwise. These are separate databases. The September 20 cleanup changed only the running Docker data and did not add deletion-on-startup behavior. See [README](README.md) for the backup and retained records.
