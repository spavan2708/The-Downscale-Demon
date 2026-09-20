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

These checks do not constitute a full real-account end-to-end run. Backend unit/integration suites and the sibling portal suite were not rerun for the UI/data change during that earlier fleet change.

## Remaining work

See [known issues](KNOWN_ISSUES.md): native admin development proxy, stronger command-center reconnect/error handling, TLS deployment, and broader concurrency/production validation. The sibling employee portal's UI was not changed by the command-center card redesign.

## Latest snapshot/demo update

Implemented bundled navigation styling, searchable snapshot cards in both apps, actual/optional simulated timestamps for new snapshots, and honest date-only display for legacy records. Added per-workspace demo time, CPU/activity controls, immediate shift evaluation, server capability gating, and command-center demo labels. Both frontends include mobile viewport declarations.

Validation: 5 new backend demo tests, 7 integration tests, and 1 first-admin test passed. The legacy-schema migration check preserved existing data with nullable timestamps. All 9 existing portal tests passed after updating the redesigned vault selector; the new demo browser test also passed. Admin browser checks covered tab spacing, snapshot search, restore requests, timestamps, and layouts at 1280px/390px without overflow or runtime errors. Both frontend builds and Docker builds passed. Live read-only verification confirmed two workspaces, four snapshots, and demo disabled on both instances after migration.

Backend, worker, and admin frontend were recreated locally. Portal Vite serves updated source on port 5173. Mocked browser flows plus backend tests do not constitute live mutation testing on the retained user workspaces.

## Grouped snapshot history

The vault now shows one card per instance in both apps. A snapshot-history dropdown lists retained captures newest first by actual creation time (legacy records use the known filename date), with the latest selected initially. Selecting an older capture updates the details without creating duplicate workspace cards. Main vault text is 16px, secondary labels are 14px, and workspace headings are 22px. Search matches workspace names, IDs, and filenames while retaining the full history dropdown. No snapshot records are deleted by grouping.

## Command-center visual refresh

The admin UI now uses larger sans-serif text (18px base, 16px action labels), a neutral background, restrained green accents, and responsive spacing. The header uses plain action names; the previous Kill Switch label is now Hibernate fleet with the same behavior. Shifts have dedicated workspace/hour/action columns and overnight guidance. Analytics presents daily savings prominently and separates remaining values with rules rather than individual boxes. Forms, dialogs, fleet cards, and snapshot details follow the same typography. All styles are bundled locally, with no Tailwind CDN dependency.

Validation: production build and Docker frontend rebuild passed; browser checks with mocked API responses exercised all four tabs at 1440px, 390px, and 320px, shift editing, and the provisioning dialog without horizontal overflow or runtime errors. The employee portal design and backend behavior were not changed by this refresh.
