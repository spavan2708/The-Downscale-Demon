# Project status

Updated 2026-09-20. Status describes inspected code and explicitly recorded checks; no percentage-complete estimate is assigned.

## Implemented

- Authentication, invitation signup, first-admin signup, and manager/admin provisioning.
- Server-side role filtering, shift-gated wake, overnight shifts, and scheduled hibernation.
- Fleet WebSocket updates and targeted session termination events.
- Simulated CRIU terminal output and retained snapshot metadata.
- Current-state compute/storage estimates and savings projections.
- Command-center fleet, shifts, vault, analytics, provisioning and invitation interfaces.

## Completed in the latest UI/data change

- Responsive fleet cards with labeled metadata, status badges, CPU meters, and separate actions.
- Search by name, instance ID, or owner, with a no-match state and fleet totals.
- Corrected damaged separators and added a mobile viewport declaration.
- Removed the command center's undefined `resetFleet()` button.
- Removed six demo instances, seven related snapshots, and 17 related events from the live Docker database; retained both employee `001` workspaces and the administrator.
- Saved a pre-cleanup SQLite backup and verified retained records and database integrity.
- Rebuilt the local distribution and running Docker frontend.

## Validation recorded

The latest UI change passed `npm --prefix frontend run build` and Docker frontend build/recreation. A Playwright browser smoke check with mocked authentication/fleet responses verified two cards, search, no-match feedback, no page runtime errors, and no horizontal overflow at 1280px and 390px. The deployed page served the rebuilt bundle. Database cleanup assertions verified preserved records, two remaining instances, and SQLite integrity `ok`.

These checks do not constitute a full real-account end-to-end run. Backend unit/integration suites and the sibling portal suite were not rerun for the UI/data change or this documentation update.

## Remaining work

See [known issues](KNOWN_ISSUES.md): native admin development proxy, stronger command-center reconnect/error handling, TLS deployment, and broader concurrency/production validation. The sibling employee portal's UI was not changed by the command-center card redesign.
