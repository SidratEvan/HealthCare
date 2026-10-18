# Administration — Phase 8B Batch 5A

11 October 2026. Real React Today and Reports on `feat/console-redesign-admin-dashboard`, based on the founder-approved Doctor integration `dba5e19b9b49bdbe92eb1b925e9cfe9cc5a669c3`. The founder explicitly authorized Batch 5A. Stop for review here; Batch 5B has not begun. No push, merge or deployment.

## What changed

- Today is the initial page: five existing operational counts, reliable attention signals, today's chamber board grouped by existing reception desks, and the existing daily report figures. Data is read on opening and every minute. The page describes a polling snapshot, carries the Bangladesh date and ages, warns about older information, retains figures on failure and offers retry. No patient roster, names, serials or clinical details are fetched for the board.
- Attention uses recorded scheduled starts that have passed at the captured server time, paused chambers with waiting bookings, missing room/desk assignments and a clearly described five-minute bed-record age reminder. The latter is an informational age check, not the hospital's configurable public/clinical stale policy. No current delay is inferred from cumulative declared delay. Ended/cancelled chambers do not raise active-chamber attention. Actions inspect the relevant row or open existing settings; queue intervention remains with Reception.
- Reports keeps every original section, calculation, chart, table, explanatory note and null treatment. The four inclusive Bangladesh periods are Today, 7, 30 and 90 days; Reports initially selects 30 days. All nine categories remain: overview, trends, loss/recovery, revenue, staff, beds, referrals, feedback, forecast. Revenue exposes doctor, department, payment-method and service CSV breakdowns. Each section retains its own original freshness source.
- Loaded dates remain explicit when a requested period fails. CSV uses those loaded dates, including across Bangladesh midnight, and is disabled during period loading or offline. A single captured clock defines both default date bounds. Latest-request guards prevent older responses overwriting a newer period. Print shows the selected report, loaded dates, figures and timestamps, without navigation or export controls.
- Batch 1 supplies hospital branding, theme, header, bilingual navigation, language controls and page-specific Help. Tables scroll within their panels on tablets; their numeric columns stay accessible. Administration CSS is opt-in. Staff & Desks, Doctors and Settings navigate to the existing V1 staff, doctors and facility panes. Only the initial `tab` URL selection was added; settings forms, writes, role assignments and permissions remain the existing implementation.

## Backend and authorization

Separate backend commit: `2db64a2` — `feat(admin): add bounded hospital chamber summary (FR-ADM-12, FR-SEC-11, DB-P1)`.

Test-only fixture correction: `0cfce0408d079eef75b3d35d2360557d17e9397b`. It places eligible chamber fixtures at the current Dhaka day start so accumulated API-suite sessions do not push them beyond the board limit. The separate 251-session truncation assertion remains.

The existing `GET /api/v1/admin/overview` is extended; no new route or authorization privilege. `requireAuth` and `requireRole('hospital_admin')` remain on the route, and hospital scope is taken from the authenticated principal. The service supplies the Bangladesh date. The additional repository statement selects at most 251 own-hospital, non-deleted sessions for that date, returns the first 250 ordered by planned start/id, and signals truncation. It joins the selected bookings and desk assignments in sets; there is no per-chamber API request, queue replay or N+1 query. Existing overview totals retain their original logic and cover the whole hospital even if the board is truncated. RLS and existing export auditing remain in effect.

Returned board fields are session id, bilingual doctor/department/desk labels, room, recorded status, planned/actual start times, cumulative declared delay and waiting/seen/no-show counts. No patient/booking identifiers, names, phone numbers, diagnosis, intake or clinical records. Waiting includes booked or waiting bookings, including patients who have not arrived; ended/cancelled remaining bookings are excluded from the original headline waiting total. Multiple desk memberships repeat a row in each group, never in the headline totals.

The new 12-case API file verifies all recorded states/counts without relying on a queue cache, principal scope despite a supplied hospital query parameter, yesterday/deleted exclusions, own-hospital multi-desk membership, all six other facility-role refusals, anonymous/patient/national refusal, the Dhaka New Year boundary, and one statement/250-row bound with 251 inserted sessions. Existing admin API and domain arithmetic tests are retained.

## Comparison with the approved prototype

The reference is the approved `admin-v1` folder under `C:\Users\sidra\Desktop\MedLiveBD-Console-Audit\design-mockups`. It is unchanged. Production follows its branded header, five-entry icon rail, separate Today/Reports headings, five summary cards, attention list, desk-grouped chamber table, daily figures, four period controls, CSV/print actions and nine report tabs.

Intentional adaptations:

- Prototype totals, sample alerts and simulated export/print are replaced by actual authorized API data and working browser downloads/print.
- The complete V1 metrics and charts remain, so several report panels have more detail than the prototype. Reports has a visible title, exact loaded dates and original freshness explanations.
- Table rows show planned and actual start, all five session states, actual counts and cumulative declared delay; no unrecorded “current delay” or patient-level information is invented.
- A row can belong to several existing desks; unassigned chambers have their own group. There is no unsupported desk/department report filter or new patient drill-down.
- Staff & Desks, Doctors and Settings use their existing V1 screens pending Batch 5B. Their prototype forms are not substituted for functioning operations.
- Null beds are described as unavailable because the existing endpoint does not distinguish an absent module, no in-service beds and a withheld/unpublished count. Emergency's null retains its existing absent-service meaning. A recorded zero remains zero.

## Actual React captures

Synthetic local data only. The browser suite signs in through the real staff login and required two-factor setup, uses the real picker and restricted production API, and captures the integrated React components. Timestamp/error/loading test images intentionally exercise controlled older timestamps or request failures; ordinary Today/Reports images use actual local API/database results.

There are **51 PNG captures and nine A4 PDFs**, collected from the final rebuilt production applications. Desktop is 1440 x 900, tablet landscape 1024 x 768, tablet portrait 768 x 1024. All nine report categories were also visited and checked for page overflow at both tablet sizes in both languages. Keyboard navigation, 200% CSS scaling and axe checks passed with normal CSP. The attention list shows its full item count and scrolls within its panel; all items remain reachable by keyboard. Its count tiles use valid definition-list markup.

| Screen | Bangla | English |
|---|---|---|
| Today desktop | [Capture](today-desktop-bn.png) | [Capture](today-desktop-en.png) |
| Today complete page and chamber board | [Capture](today-full-bn.png) | [Capture](today-full-en.png) |
| Today tablet landscape | [Capture](today-landscape-bn.png) | [Capture](today-landscape-en.png) |
| Today tablet portrait | [Capture](today-portrait-bn.png) | [Capture](today-portrait-en.png) |
| Today Help | [Capture](today-help-bn.png) | [Capture](today-help-en.png) |
| Reports tablet landscape | [Capture](reports-landscape-bn.png) | [Capture](reports-landscape-en.png) |
| Reports tablet portrait | [Capture](reports-portrait-bn.png) | [Capture](reports-portrait-en.png) |
| Reports Help | [Capture](reports-help-bn.png) | [Capture](reports-help-en.png) |
| Reports 200% scaling | [Capture](reports-scale-200-bn.png) | [Capture](reports-scale-200-en.png) |

| V1 report | Bangla | English | Print capture | A4 PDF |
|---|---|---|---|---|
| Overview | [Capture](reports-today-bn.png) | [Capture](reports-today-en.png) | [Capture](print-today-en.png) | [PDF](print-today-en.pdf) |
| Trends | [Capture](reports-trend-bn.png) | [Capture](reports-trend-en.png) | [Capture](print-trend-en.png) | [PDF](print-trend-en.pdf) |
| Loss and recovery | [Capture](reports-loss-bn.png) | [Capture](reports-loss-en.png) | [Capture](print-loss-en.png) | [PDF](print-loss-en.pdf) |
| Revenue | [Capture](reports-revenue-bn.png) | [Capture](reports-revenue-en.png) | [Capture](print-revenue-en.png) | [PDF](print-revenue-en.pdf) |
| Staff | [Capture](reports-staff-bn.png) | [Capture](reports-staff-en.png) | [Capture](print-staff-en.png) | [PDF](print-staff-en.pdf) |
| Beds | [Capture](reports-beds-bn.png) | [Capture](reports-beds-en.png) | [Capture](print-beds-en.png) | [PDF](print-beds-en.pdf) |
| Referrals | [Capture](reports-referrals-bn.png) | [Capture](reports-referrals-en.png) | [Capture](print-referrals-en.png) | [PDF](print-referrals-en.pdf) |
| Feedback | [Capture](reports-feedback-bn.png) | [Capture](reports-feedback-en.png) | [Capture](print-feedback-en.png) | [PDF](print-feedback-en.pdf) |
| Forecast | [Capture](reports-forecast-bn.png) | [Capture](reports-forecast-en.png) | [Capture](print-forecast-en.png) | [PDF](print-forecast-en.pdf) |

State captures: [empty hospital with unavailable services](today-empty-en.png), [older snapshot](today-stale-en.png), [retained overview after failure](today-error-en.png), [report loading](reports-loading-en.png), [failed requested period retaining its actual dates](reports-retained-error-en.png), and [offline report retaining its figures](reports-offline-en.png). Revenue prints across two A4 pages; the other eight PDFs have one page each. PDF headers, EOF markers, page counts and A4 page boxes were checked. Print assertions verify selected content and period in the rendered page; they do not claim independent PDF text extraction.

The [exact modified-file inventory](modified-files.txt) covers this entire batch relative to the approved base, including its separate backend commits. [Verification evidence](verification-evidence.json) fingerprints source, browser assertions, captures, production build ids and local logs. [The pre-run source snapshot](verification-source.json) was captured before the final corrected production build.

## Verification

| Check | Actual result |
|---|---|
| Unchanged baseline | Workspace TypeScript, lint and formatting passed; five relevant API/domain files / 63 tests and all seven original Administration browser cases passed. |
| Focused implementation checks | Nine files / 4,340 targeted foundation/domain/i18n/API tests passed. The final dedicated chamber API file passed all 12 cases; the new presentation/date/signal file passed all 13 cases. |
| Final `pnpm.cmd verify --maxWorkers=1` | **162 files / 7,861 tests passed in 805.81 seconds**, exit 0, including all unit, UI, API and schema projects. Workspace TypeScript, root lint and formatting passed in the same isolated run. |
| Final production build and browser checks | `pnpm.cmd exec playwright test -c playwright.prod.config.ts e2e/production/admin-workspace.prod.spec.ts e2e/production/two-device-queue.prod.spec.ts`: **12 passed in 7.2 minutes**, exit 0. The harness built shared domain/i18n, compiled API and both Next applications before starting them; production readiness, demo-off, restricted database role, real staff login/MFA, both languages, all report/CSV/print/date/state/layout cases and the under-two-second canary passed. No retry or new exclusion. |
| Existing workflow regression coverage | The completed broader production run passed **53 of 57 cases in 21.9 minutes**, including all **51 unaffected regression cases**: 24 Doctor workspace/safety/midnight cases, nine Reception cases, twelve Registration cases and six production configuration/canary cases. Its four Administration failures and corrected rerun are described below; the broader command is not represented as green. |
| Final original Administration browser regression | `pnpm.cmd exec playwright test e2e/admin-dashboard.spec.ts`: **seven passed in 5.1 minutes**, exit 0. Existing assertions are retained; the helper enters Reports for its original 30-day view and the Now case enters Today. |
| Additional E2E TypeScript | Exit 2: the unchanged `e2e/import-mapping.spec.ts:308` has `suggestedByModel` on `never`. No new Administration file error. |
| Additional root/tooling TypeScript | Exit 2: the existing four project-level `passWithNoTests` properties in `vitest.config.ts:36,59,94,107` fail the installed Vitest types. This batch only adds the new app test include. Runtime suites and workspace TypeScript are separate checks. |

All twelve downloaded CSVs were compared byte-for-byte against the authorized backend CSV for the exact loaded period and checked for the V1 filename/header column order. These are the eight non-revenue reports and all four revenue breakdowns. The displayed overview seen count was compared with the same backend dashboard result. Each of nine reports called the real print action, retained its loaded period and own section, and hid navigation/export controls in print media; actual PDFs and print images were saved. Four period lengths, latest-response ownership, pending/failed/offline export behavior, loading, measured zero versus unavailable, multiple desks, five chamber states and real row counts were asserted.

For calculation preservation, the complete section implementation block from `TodaySection` through the original report helpers was compared with the approved-base `AdminDashboard.tsx`. After normalizing whitespace and replacing the new scrolling `ReportTable` wrappers with their original table elements, the blocks are equal. No V1 calculation, chart series, threshold or explanatory note in that block was changed. Backend report queries and exports are unchanged.

Failures and reruns are preserved in the evidence manifest:

- The first production attempt was stopped after two setup timeouts: the existing single-role staff picker had already navigated to Administration when the test tried to click its transient button. The test now waits for that actual automatic navigation. This attempt is incomplete, not a passing run.
- The completed broader run had four Administration failures. Axe identified invalid definition-list children in the new tiles; the markup was corrected. Two bilingual cases shared synthetic desk names; each now owns distinct names and cleans up only its own desks. An error selector matched both the report alert and Next's route announcer; it now scopes to the report. An empty-facility fixture assumed enabled Emergency would be unavailable, whereas its correct value is zero; the absence fixture now explicitly disables that module. Assertions, role policies, CSP, timing limits and report semantics were retained. The final fresh build passed all six Administration cases plus the six canary/configuration cases.
- An earlier full repository run exposed three new chamber tests whose fixtures fell beyond the earliest-250 board bound after other API fixtures accumulated. Their planned start is now explicitly today's Dhaka midnight, keeping them inside the intentionally bounded board. While investigating, a focused API run was mistakenly started against the same API test database and invalidated the full run. That run was stopped and discarded; the final full gate runs alone against that database. The independent production browser database was not shared with it.
- Early static checks caught Date/string formatting, strict test typing/import boundaries and a file being edited during lint. Those were corrected and rerun. The two unrelated additional tooling TypeScript failures above remain visible; they are not counted as passing checks.

Tests use synthetic localhost `healthcare_dev`, `healthcare_api_test` and `healthcare_test` only. Production browser configuration uses `DEMO_MODE=false`, the limited `healthcare_api` database role, SMS logging, payments off, temporary local files and static travel time. No real patient records, hospital assignments or external-provider messages were used. All runtime implementation and assertion files match the source captured before the final production run. Of 17 recorded files, 16 match byte-for-byte; the sole later difference restores the original package-description punctuation in `shared/ui/package.json`, leaving its tested exports unchanged. That metadata-only correction passed formatting separately and is identified in the final manifest.

## Preserved behavior and remaining limits

Reception reconciliation, Registration receipt/uncertain-write protections and Doctor C1/C2/encounter/signing/date protections are untouched. Authentication, role selection, Ward/ER/Laboratory/Pharmacy operations, existing settings write operations and the unresolved hospital-wide Doctor authorization policy are unchanged. No schema, migration, dependency or production configuration changes.

The board is a counts snapshot, not a subscription or management intervention surface. Booked/waiting is not a measured corridor occupancy count. Its 250-row bound and incomplete attention coverage are visible. The selected sessions/counts and original overview aggregates are separate reads and can change during concurrent activity. Desk assignments are by doctor, not a session-specific staff roster.

V1 limitations remain: daily summary data can be up to five minutes old; referrals/feedback timestamps are the newest recorded row rather than connectivity evidence; several service revenues are uncharged in this version; absent/unmeasured averages and insufficient forecast samples remain unavailable; forecast uses the existing rolling 84-day history independently of the selected report period. The current bed count comes from existing published capacity rather than a new internal census. This batch is not a full-application release or clinical-use approval.

Unrelated pre-existing `docs/reports/` and `.claude/settings.local.json` are not modified or staged. Earlier batch screenshots regenerated by regressions are restored to their committed versions before committing this review.
