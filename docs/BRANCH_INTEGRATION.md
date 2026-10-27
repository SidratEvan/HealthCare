# Master consolidation — 27 October 2026

## Decision

The owner requested a branch with all current, compatible application work and a
working, organized local setup. `master` was created from `6d29a7f`, the head of
`migration/django-drf`, after `git fetch --all --prune` succeeded. No existing
branch, stash or preview worktree was deleted or reset. `main`, `mvp` and `demo`
were not moved. Public deployments and remote databases were not changed.

**Latest integrated source: migration/django-drf.** It includes `mvp` at
`cd2a676`, the approved company website, the console redesign/audit lineage at
`b7bee62`, subsequent MARKS readiness fixes, the Django port and the JavaScript
frontend conversion. It is 72 commits ahead of mvp and 52 ahead of the older
preview at b7bee62. A timestamp alone was not used to choose a branch.

## What master contains

- Patient PWA, all hospital staff consoles and company website from one checkout.
- Console foundation, access, reception, registration, consultation, administration,
  wards, emergency, laboratory, pharmacy, onboarding, imports and national layer.
- Doctor signing/draft safety, authentication-refresh corrections, queue/privacy
  audit fixes and the demo-phone allowlist already integrated in the baseline.
- Django/DRF + Socket.IO API; original Express/Socket.IO API retained for rollback.
- JavaScript/JSX browser code; TypeScript domain/i18n, database tools and Node API.
- SQL migrations/seeds, tests, deployment/backup tools and design evidence.
- Missing company-site design ZIP archives, cherry-picked from `7816631`.
- Previously stashed local-runner work adapted for Django/Node, plus preserved
  historical reports/PDF and unique independent audit probes/results.

## Branch inventory

All remote refs below were inspected. “Unique commits” counts commits on that ref
absent from the migration baseline; it does **not** imply missing application code.
Release merge nodes and work later copied/squashed can have unique commit IDs.

| Remote branch | Head | Unique commits | Relationship to baseline |
| --- | --- | ---: | --- |
| `origin/audit/f17` | `d97dc34` | 1 | Reviewed separately; see decisions below |
| `origin/audit/independent-97f578c` | `226fc41` | 1 | Reviewed separately; see decisions below |
| `origin/audit/pilot-readiness-2026-10-12` | `b7bee62` | 0 | Already included in migration baseline |
| `origin/backup/claude-refine-f0d9b80` | `f0d9b80` | 1 | Reviewed separately; see decisions below |
| `origin/backup/codex-cinematic-8c563ec` | `8c563ec` | 0 | Already included in migration baseline |
| `origin/backup/pre-audit-stash-2026-10-12` | `4cc31f5` | 2 | Reviewed separately; see decisions below |
| `origin/chore/site-design-zips` | `7816631` | 1 | Reviewed separately; see decisions below |
| `origin/demo` | `99e4c5e` | 30 | Reviewed separately; see decisions below |
| `origin/feat/company-site` | `d148e30` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-access` | `4e1da68` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-admin-dashboard` | `ca15cd6` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-admin-management` | `b20ffd9` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-doctor` | `dba5e19` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-foundation` | `8d81ce8` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-lab-pharmacy` | `2224e4c` | 2 | Reviewed separately; see decisions below |
| `origin/feat/console-redesign-platform-import-national` | `97f578c` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-reception` | `5f6e440` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-registration` | `ec9cbf2` | 0 | Already included in migration baseline |
| `origin/feat/console-redesign-ward-emergency` | `d623c07` | 1 | Reviewed separately; see decisions below |
| `origin/feat/medlivebd-company-site` | `ef089c5` | 0 | Already included in migration baseline |
| `origin/feat/site-audience-gateway` | `0720a73` | 0 | Already included in migration baseline |
| `origin/feat/site-brand` | `940858d` | 0 | Already included in migration baseline |
| `origin/feat/site-cinematic-connected-care` | `8c563ec` | 0 | Already included in migration baseline |
| `origin/feat/site-cinematic-refine` | `f0d9b80` | 1 | Reviewed separately; see decisions below |
| `origin/feat/site-codex-final` | `ab112e6` | 0 | Already included in migration baseline |
| `origin/feat/site-final-premium-redesign` | `9b5cc04` | 0 | Already included in migration baseline |
| `origin/feat/site-premium` | `669aa80` | 0 | Already included in migration baseline |
| `origin/fix/console-doctor-consultation-safety` | `7033db6` | 0 | Already included in migration baseline |
| `origin/fix/release-audit-2026-10-11` | `8eec772` | 0 | Already included in migration baseline |
| `origin/fix/site-image-refinements` | `cbd1d7f` | 0 | Already included in migration baseline |
| `origin/fix/site-mobile-menu` | `f41c34e` | 0 | Already included in migration baseline |
| `origin/main` | `99e4c5e` | 30 | Reviewed separately; see decisions below |
| `origin/migration/django-drf` | `6d29a7f` | 0 | Already included in migration baseline |
| `origin/mvp` | `cd2a676` | 0 | Already included in migration baseline |

### Decisions for divergent branches

| Branch/work | Decision and reason |
| --- | --- |
| `main`, `demo` @ `99e4c5e` | Older release line. All 30 unique commits are release merge nodes (`git log --no-merges baseline..origin/main` is empty; `git cherry` reports no missing nonmerge patches). Current source comes through mvp. Do not replace newer source with the release tree. |
| `feat/console-redesign-lab-pharmacy` | Its backend safety/frontend work was integrated through `dea893f` and `9afb1d8` in the consolidation lineage. The baseline has later safety fixes and JavaScript conversion. Preserve current implementations rather than merging the old TypeScript paths again. |
| `feat/console-redesign-ward-emergency` | Same integration lineage; wards/ER are already implemented and subsequently converted/fixed. Old commit identity is not absent functionality. |
| `audit/f17` @ `d97dc34` | Explicit WIP: “Tests not run; do not merge as is.” Current source already includes transactional refresh rotation and newer client/session fixes (`b82376a`); Python refresh-race equivalents exist. Do not apply the unfinished patch over them. |
| `backup/claude-refine-f0d9b80`, `feat/site-cinematic-refine` | Rejected alternate site design, explicitly superseded by approved final premium design. Retained on original refs, excluded from active site. |
| `chore/site-design-zips` | Three unique ZIP archives added via cherry-pick. No application source change. |
| `audit/independent-97f578c` | Unique raw probes/results preserved under `docs/history/independent-audit-97f578c`. Older audit screenshots do not overwrite approved evidence restored by `5e11a42`. |
| `backup/pre-audit-stash-2026-10-12` | Old index/stash screenshot snapshot. Original ref preserved; no code to add, no replacement of current screenshots. |
| Local stash `On mvp: !!GitHub_Desktop<mvp>` | Useful runner files recovered and adapted; three reviews and existing PDF archived under `docs/history/local-review-2026-10`. Generated temporary PDF renders/old exit files were not promoted to active source. Stash remains intact. |
| Local `preview/latest-app` worktree | Uncommitted runner/Tailwind changes preserved in place. Corresponding useful changes integrated into master; its old source is superseded by migration baseline. |
| Local `chore/local-runner`, `mvp` | Both point to `cd2a676`, already an ancestor of baseline. Their uncommitted/stashed runner additions are accounted for separately above. |

## Organization and local-run corrections

The root README identifies the consolidated branch and provides runnable commands.
`docs/LOCAL_DEVELOPMENT.md` explains both APIs, test databases, demo access and
troubleshooting. `docs/history/README.md` labels old evidence so it cannot be read
as today's result. The five product/architecture source documents retain their
authority; historical stack descriptions should be read alongside the accepted
Django migration report.

`run.ps1` owns the four service process trees, generates missing local secrets,
installs pinned dependencies, supports Docker/WSL/existing Postgres, migrates and
verifies, seeds only an empty demo, and starts either API under the limited role.
Its stop path verifies command line and start time before terminating a process.
Date comparisons handle both PowerShell string and DateTime JSON parsing.

On this machine the working demo cluster is at **localhost:5433**. The old .env
selected another instance on 5432, and the old Django process had connection
timeouts. The ignored local environment now uses 5433. The launcher supports
custom local ports; no other database's password/configuration was changed.

The Django compatibility harness now builds and serves the same database even
when its local port differs. Root Vitest loads test database overrides before
worker creation. The UI package directly declares its already-used Tailwind
dependency, with the lockfile updated. `.local` and archived probes stay out of
lint/format traversal. No credentials, dependency trees or local logs are committed.

CI now triggers on master alongside main/mvp and has a Django job for selected
API compatibility, Python safety and deterministic queue parity. Existing Node
verification and browser jobs remain. GitHub's default branch is unchanged.

## Verification of this consolidation

Results are updated when commands finish. Logs are local evidence in `.local/`;
historical results in the migration report are not counted as fresh runs.

| Check | Result |
| --- | --- |
| Fetch and branch inventory | Passed |
| Frozen dependency install | Passed after old app processes were stopped |
| Local migrations | Existing 61 ledger entries current, latest schema 0063 |
| Schema invariant verification | Passed |
| Limited API role | Created/verified; requests use healthcare_local_api |
| Launcher start and stop | All four services reached readiness; owned stop passed |
| Chromium smoke | Patient, console and site HTTP 200, no page errors; API ready/schema 0063 |
| Workspace type checking | Passed; changed API test checked again |
| ESLint | Passed across repository; changed files checked again |
| Prettier | Passed |
| Production builds | Passed for all workspaces, including three Next.js apps |
| Unit/API/schema suite | 172 files, 8,147 passed / 1 Windows TCP harness failure; entire affected file passed 10/10 after repair |
| Node API contract suite against Django | 1,924 passed / 11 failed: ten documented Node-process spy cases plus the same TCP harness failure; repaired file and CI selection retest below |
| Django contract retest after harness repair | 4 files / 85 tests passed: pilotAudit, queue.routes, tenantScope and demo.routes |
| Python safety and parity | 220/220 passed, including equivalents for the ten spy cases |
| Two-device queue browser canary against Django | 5/5 passed, under-two-second delivery included, disposable healthcare_master_e2e |
| Website static export and browser tests | Export built; 30/30 passed in both languages, including axe, responsive menu, reduced motion and no-JavaScript rendering |
| Node fallback launcher | All four apps started, Node /readyz HTTP 200, owned stop passed |

Two test-infrastructure defects were repaired during validation. The site browser
config ran its preview script relative to the tests directory; it now explicitly
uses the site root and refuses unrelated existing listeners. The malformed-input
audit opens thousands of HTTP requests; ephemeral listeners/connections exhausted
Windows ports (`EADDRINUSE`/`ETIMEDOUT`). It now owns one listener and reuses an HTTP
connection, with cleanup in finally and every original assertion retained. The
entire Node audit file passed 10/10 after repair. No API behavior, auth or tenant
rule was changed to make these tests pass.

The ten remaining failures in the broad Django contract run are the exact
Node-process instrumentation cases documented by the accepted migration; their
Python equivalents passed. They were not skipped or suppressed. This is not a
claim of a wholly green 1,935-case original Node suite against Python.

The initial broad test attempt was interrupted during local-port diagnosis and
restarted with explicit local test URLs. It is not counted as a completed run.

## Limits and release gates

“Consolidated” means compatible current work collected and verified as recorded;
it does not mean every historical experiment was made active. No real patient
data is used. Previous audit/production-readiness decisions remain in
`audit/marks-readiness-2026-10-18.md` and `django-migration/final-report.md`.

This integration does not activate paid providers, target-server operations or a
public release. Full development/built/production browser suites on the final
release commit, target-hardware rehearsal/restore and unresolved audit decisions
remain required before real patients. Any unrun suite is stated explicitly below
in the final results; a smoke check cannot substitute for it.

The full development, built/offline and production browser suites were **not**
rerun during this consolidation; the fresh browser evidence is the five-case
Django queue canary, the 30-case exported website suite and the startup smoke.
The full 8,148-case Node and 1,935-case Django contract suites were not repeated
after the test-only TCP repair; the complete affected file was rerun against both
APIs, plus the Django CI selection. No known application test failure was hidden.

## Handover

`master` is the ongoing development base. Branch future tasks from it and merge
verified changes back; the release branches remain unchanged. Local startup is
`./run.ps1 -Background` (Auto now reuses the configured reachable local database),
and stop is `./run.ps1 -Stop`. The final session leaves the Django configuration
running. All committed runtime/setup changes are reproducible from this checkout.
The remote default remains main; publishing master does not switch deployments.
