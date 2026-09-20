# Project status

Reviewed 2026-09-20. This page summarizes current implementation and previously recorded verification, not a completion percentage.

## Current implementation

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

These results were recorded during implementation. This documentation-only refresh checks Markdown consistency, encoding, and links; it does not rerun application suites or claim live-account end-to-end coverage.

## Data operations on 2026-09-20

The local Docker cleanup removed six demo instances, seven associated snapshots, and 17 associated events, preserving employee `001`, both `hail` workspaces, and the existing administrator. The later snapshot/demo migration preserved two users, two instances, and four snapshots present at that time, with all pre-migration values verified unchanged. These are historical counts; subsequent user activity can create more snapshots or change instance state.

Backups and retained IDs are documented in [README](README.md). Current code does not seed demo records or restrict future provisioning to those IDs. Snapshot grouping and the admin redesign do not modify stored data.

## Remaining work

See [known issues](KNOWN_ISSUES.md) for native admin API proxying, stronger admin request/reconnect handling, modal keyboard behavior, TLS, SQLite load validation, and simulation limitations.
Also see the employee workspace portal's [KNOWN_ISSUES.md](../employee-workspace-portal/KNOWN_ISSUES.md) for portal-specific limitations including session view scope, UI scope, and test scope differences.
