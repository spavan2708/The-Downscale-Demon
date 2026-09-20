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

## Snapshot vault and demo controls (2026-09-20)

Navigation tabs and snapshot cards now use bundled styles. Both frontends show searchable snapshot cards with creation time, demo time when used, size, panes, and a unique reference. Existing snapshots have only the filename date; their exact time is marked as not recorded. New snapshots store actual UTC `created_at`, optional offset-aware `simulated_at`, and a timestamp/unique-suffix filename.

The employee portal shows **Demo controls** after login for owned workspaces when the server advertises `demo_available`. Compose enables `DEMO_MODE=1` for both API and worker; native processes default to disabled. Select a workspace, enable the toggle, enter a date/time in the displayed server timezone, and apply. Use an in-shift time before Start / Restore. On a powered-on workspace, CPU and running/idle controls take effect immediately. **Apply & evaluate now** runs the shift cutoff without waiting for the scheduler.

The demo clock is fixed until changed and persists per workspace until disabled. Authentication/invitation expiry and actual snapshot creation time use real time. Turning demo off clears its clock, resets powered-on CPU/activity, and evaluates the real shift. Idle is still billable; CPU is not a scheduler cutoff threshold. Demo CPU >= 90 outside shift flags an anomaly. Exempt/snoozed workspaces continue to bypass shift cutoff.

Pre-migration backup: `/app/db/before-snapshot-demo-20260920-040033.db`. Both existing workspaces, two users, and four legacy snapshots were preserved; no live workspace was enabled for demo by the update.

## Grouped snapshot history

The vault now shows one card per instance in both apps. A snapshot-history dropdown lists retained captures newest first by actual creation time (legacy records use the known filename date), with the latest selected initially. Selecting an older capture updates the details without creating duplicate workspace cards. Main vault text is 16px, secondary labels are 14px, and workspace headings are 22px. Search matches workspace names, IDs, and filenames while retaining the full history dropdown. No snapshot records are deleted by grouping.

## Command-center visual refresh

The admin UI now uses larger sans-serif text (18px base, 16px action labels), a neutral background, restrained green accents, and responsive spacing. The header uses plain action names; the previous Kill Switch label is now Hibernate fleet with the same behavior. Shifts have dedicated workspace/hour/action columns and overnight guidance. Analytics presents daily savings prominently and separates remaining values with rules rather than individual boxes. Forms, dialogs, fleet cards, and snapshot details follow the same typography. All styles are bundled locally, with no Tailwind CDN dependency.

Validation: production build and Docker frontend rebuild passed; browser checks with mocked API responses exercised all four tabs at 1440px, 390px, and 320px, shift editing, and the provisioning dialog without horizontal overflow or runtime errors. The employee portal design and backend behavior were not changed by this refresh.
