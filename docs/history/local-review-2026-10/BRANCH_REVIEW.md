# Which branch has the latest code?

Checked 16 October 2026, after a successful `git fetch --all --prune`.

**No remote branch includes all the newest hospital-app and company-site work.**
The histories diverged after `ca88c47`; newer commit dates alone do not establish
which application is most complete. This corrects the earlier assumption that
`mvp` contained all current application work: the earlier setup/audits examined
`mvp`, not the separate console-redesign/audit lineage.

| Branch | Commit | Contents / use |
|---|---|---|
| `audit/pilot-readiness-2026-10-12` | `b7bee62` | Most complete reviewed candidate for running the redesigned hospital platform: console redesign plus later queue/privacy/environment/deployment fixes. Full release readiness is not established. Selected for this local preview |
| `audit/f17` | `d97dc34` | Newest hospital-code change, but commit explicitly says staff refresh fix is WIP, unfinished and unverified. Five auth/client/test source files differ from the selected candidate. Not selected for normal startup |
| `mvp` | `cd2a676` | Newer approved company-site design; lacks the separate integrated hospital console redesign and subsequent audit fixes |
| `chore/site-design-zips` | `7816631` | Newest commit timestamp; `mvp` plus three design ZIP archives. Application source is identical to `mvp`, so this is not a newer application implementation |
| `feat/console-redesign-platform-import-national` | `97f578c` | Consolidated console redesign baseline. Selected pilot-readiness branch contains it plus later fixes |
| `audit/independent-97f578c` | `226fc41` | Independent audit artifacts; backend/frontend/shared/database source matches `97f578c` |
| `main`, `demo` | `99e4c5e` | Released 9 October demo, before the console redesign. Remote default branch remains `main` |

All names above refer to `origin/<branch>`. Neither `main` nor `mvp` contains
every other branch. Some feature/backup branches represent alternate designs or
partial work and should not be merged simply to collect every commit.

## Running the current preview

From the original repository root:

```powershell
.\run-latest.ps1
.\run-latest.ps1 -Background
.\run-latest.ps1 -Stop
```

The hospital platform runs from an isolated Git worktree:

```text
V:\STARTUP\HealthCare\.local\latest-app
local branch: preview/latest-app
upstream: origin/audit/pilot-readiness-2026-10-12
base: b7bee62
```

The company website is served from the original checkout's newer `mvp` site.
This is an explicitly combined local preview using two checkouts; no integration
branch or production release was created. The original local changes, audit files
and environment are preserved. No push or public deployment was performed.

| Component | Address | Source |
|---|---|---|
| Patient | http://localhost:3000 | `b7bee62` worktree |
| Redesigned hospital console | http://localhost:3100 | `b7bee62` worktree |
| API readiness | http://localhost:4000/readyz | `b7bee62` worktree |
| Company website | http://localhost:3200/en | Original `mvp` checkout |

Local runtime additions in the isolated worktree: the existing run/setup helpers,
a generated-secret `.env` copy, selection of the original company-site directory,
and the same missing-Tailwind dependency correction needed by the original clean
install. These additions are not upstream commits. Its dependency lockfile is
updated for that dependency correction. The copied helpers are development tools,
not an assertion of upstream release readiness.

The selected branch has no migration or seed differences from the original
`mvp` checkout, so the existing local demo database is reused and preserved.
The launcher still verifies migrations/schema and runs the API as the limited
local database role. Do not run both launchers on the same ports simultaneously.

The old `.\run.ps1` remains available for the original `mvp` preview. The latest
wrapper stops that original preview before starting its own apps.

Verified during this setup: all 591 worktree dependencies installed from the local
store, existing 61 migrations already applied, schema invariants hold, limited API
role prepared, and all four endpoints returned HTTP 200. Fresh Chromium visits
rendered patient, console picker and company-site pages with no page errors during
that check; `/readyz` reported ready at schema 0063. Evidence is in the original
checkout's `.local/latest-startup.log` and `.local/latest-browser.log`. This is a
startup/browser smoke check, not the unfinished full release gate.

## Important implication for the previous audit

Some findings from the `mvp` audit are already addressed in this other lineage:
`fcc92b4` passes live SMS/payment settings through the self-hosted stack;
`be85999` sanitizes patient queue-write responses;
`0b08285` scopes replay keys to their chamber; `6fcc75b` refuses production
Supabase storage where no adapter exists. Do not use the previous `mvp` findings
as an unchanged defect list for `b7bee62`. The selected branch's own audit/reports
and pending verification also need review before any release.
