# The Downscale Demon

FastAPI service and React admin command center for shift-aware workspace management, simulated hibernation/snapshots, and current-state cost estimates.

Documentation reviewed against local source on 2026-09-20.

## Projects and entry points

| Component | Location | Local URL |
| --- | --- | --- |
| API | `backend/` | http://localhost:8000 |
| Admin command center | `frontend/` in this repository | http://localhost:3000 via Docker |
| Employee workspace portal | `../employee-workspace-portal/` | http://localhost:5173 via Vite |

The two frontends are separate applications using the same API and database. Compose builds the admin frontend, not the sibling employee portal.

## Run locally

With Docker Desktop and Docker Compose available, run from this repository:

```powershell
docker compose up -d --build
```

Compose starts Redis, FastAPI, a Celery worker with beat, and the nginx-hosted admin frontend. API and worker share the `db_data` volume at `/app/db`. Compose uses `SHIFT_TIMEZONE=Asia/Kolkata`.

For native backend development, create/activate a Python environment, install `backend/requirements.txt`, then run `uvicorn app:app --reload` from `backend/`. Native SQLite defaults to `backend/db/downscale.db`, independently of the Docker volume. Redis and Celery must also run to evaluate scheduled shift cutoffs.

The admin Vite config currently has no API/WebSocket proxy; `npm --prefix frontend run dev` alone does not provide a working same-origin backend connection. Use the Docker URL or configure a development proxy. See the sibling portal README for its configurable API URL.

## Accounts and workspaces

No default credentials or demo fleet are seeded by current startup code. Create the first administrator through the employee portal's Chief Architect Sign Up, or use:

```powershell
docker compose exec backend python bootstrap_admin.py ADMIN-001 "Chief Architect" platform
```

The script prompts for a password. First-admin API signup is rejected once an administrator exists. Managers/admins can provision users and workspaces or generate single-use invitations through the command center. Ordinary signup requires an invitation; role and team are assigned server-side.

## Admin UI

The fleet uses responsive cards with separate instance ID, owner, machine type, shift, CPU meter, and status badge. Search matches name, instance ID, or owner. Cards expose wake, management CRIU purge, and anomaly actions according to state/access. Other tabs provide shift editing, retained snapshots, and analytics. Edit `frontend/src/`, then rebuild; `frontend/dist/` is generated output.

```powershell
npm --prefix frontend run build
docker compose up -d --build --no-deps frontend
```

## Local data cleanup on 2026-09-20

Six legacy demo instances, seven associated snapshots, and 17 associated events were removed from the running Docker database. References to demo owners `EMP-902`, `EMP-404`, and `MGR-101` were removed; no corresponding user/session/invitation rows existed at cleanup. Employee `001` and the existing administrator were preserved.

| Retained instance | Name | Owner | Type | Shift |
| --- | --- | --- | --- | --- |
| i-004c8efa0059492ba | hail mary | 001 | t3.medium | 09:00 - 18:00 |
| i-5628f31fd2a6447d8 | hail santa | 001 | r5.large | 23:00 - 07:00 |

This is a dated local-operation record, not a seed list or a restriction on future users. The native database was empty. Backup: `backend/db/before-demo-cleanup-20260920-032751.db`, also retained at `/app/db/before-demo-cleanup-20260920-032751.db` in the Docker volume. The backup contains pre-cleanup data and authentication records; keep it out of version control.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Project status and validation](PROJECT_STATUS.md)
- [Known issues](KNOWN_ISSUES.md)
- [API integration report](INTEGRATION_REPORT.md)
- [Employee app handoff](EMPLOYEE_APP_HANDOFF.md)
- [Contributing](CONTRIBUTING.md)
