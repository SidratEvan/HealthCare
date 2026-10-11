# Administration completion — Phase 8B Batch 5B

11 October 2026. Branch `feat/console-redesign-admin-management`, based on the founder-approved Batch 5A commit `ca15cd65bdd1335df9d25848d03efafe5d318a08`. The founder explicitly authorized Batch 5B and subsequently authorized accelerated completion of all approved interfaces without additional module approvals. Work continues locally; no push or deployment.

## What hospital managers can do

Administration now has five working sections in the same branded workspace: Today, Reports, Staff & Desks, Doctors and Settings. Today and Reports retain their Batch 5A components, calculations, periods, downloads and printing.

- **Staff & Desks:** find staff by name/email, role and account status; see the actual hospital, roles, desk memberships and Bangladesh sign-in time; open a person panel to change roles, activate/deactivate another account, reset its password or reset enabled two-factor verification. The existing one-time password handover and administrator self-protection remain. Each of the seven actual roles has a short Bangla/English explanation. Desk names, doctor memberships and receptionist memberships remain editable. The access table explains the existing queue policy.
- **Doctors:** find the hospital's doctors by name/BMDC number, department and status; see their actual desk memberships, rooms, fees and schedule counts. The person panel retains fee/room changes, activation, weekly chamber creation/removal and their separate server results. Supported unverified identity fields have their own editor. Verified and shared identities remain governed by existing server restrictions. Departments retain add/edit/remove and dependency refusal. There is no inferred link between a doctor and a staff account.
- **Settings:** seven understandable groups under patient-facing, everyday and occasional settings: contact/location, public description/branding/privacy, operating rules, wards/beds, emergency capabilities, registration identity and SMS reporting. The existing readiness checklist and request-for-review workflow remain on the home page. Disabled modules retain their explanatory notice and hide the corresponding groups/navigation; Import remains an existing guarded link.

Editors retain their own explicit fields and existing API operations. The shared Batch 1 shell, theme, Help, locale controls, cards, buttons, Radix sheets, freshness line and toasts supply presentation. No dependencies or new clinical policies were added. Help preserves edits and selected files. The hospital name, logo and colour refresh after server-confirmed changes.

## V1 preservation map

| Original settings tab | Integrated location and retained operations |
| --- | --- |
| Profile | Settings home checklist/review; contact/location; description, colour/logo and publishing/privacy; queue/payment/SMS rules; registration identity; monthly SMS outcomes and cap. |
| Departments | Doctors → Departments: add, rename/change code and remove when the server permits. |
| Doctors | Doctors list/person panel: add or affiliate by BMDC, fee/room, activation, identity restrictions, weekly chambers and individual removal. |
| Beds | Settings → Wards and beds: ward add/edit/remove, bed labels/ranges, kind and nightly price, bed edits/removal with existing guards. |
| Capabilities | Settings → Emergency capabilities: existing supported services, availability/capacity updates and their own source age. |
| Staff | Staff & Desks: staff add, actual roles, self-protection, account activation, password/2FA reset and one-time handover; desk add/edit/remove and doctor/receptionist assignments. |

The API-action inventory from the original `HospitalSettings.tsx` was compared with the extracted editors: none is missing. Existing correction and public-face components retain their additional edit/delete/publishing operations. The simplified prototype does not remove those controls.

## Saving and desk safety

Changes show an unsaved indicator and a review of their before/after values. Access and operational changes identify the hospital/person or configuration affected and describe their consequence. Cancel keeps the draft. Navigation, person-panel closure and browser unload protect unfinished work; Close waits while a write and its read-back are finishing. Failed writes keep edits; offline writes are disabled and never queued. Latest-request guards reject delayed reads. If a newer server value conflicts with a dirty editor, saving stops until the administrator explicitly discards/reviews the stale draft.

Receptionist desk changes are separate API writes. The panel reads all desk before-images before review, preserves unaffected staff/doctors and unchanged assignments, then writes changed desks in sequence. A rejected or uncertain response stops the sequence. Results distinguish completed, rejected, uncertain and not-attempted desks from what a fresh server read actually confirms. Recovery requires a new read/review and writes only remaining differences. There is no silent rollback, automatic write retry or blanket “all saved” message.

Separate backend safety commit: `9b2337e` — `fix(admin): refuse stale desk membership replacements (FR-REC-32, FR-ADM-11, DB-P1)`. The existing PATCH accepts an optional full `expected` before-image. Its transaction locks the own-hospital desk, reads current names/memberships in a fresh statement, compares unordered member sets and refuses a conflict with `422 SETTINGS_NOT_ALLOWED / desk_changed` before mutation/audit. Existing role, tenant and member validation remain authoritative. Legacy callers remain compatible. No endpoint, permission framework, schema migration or production infrastructure was added.

## Comparison with the approved prototype

Reference: the unchanged `admin-v1` folder under `C:\Users\sidra\Desktop\MedLiveBD-Console-Audit\design-mockups`. The integrated React pages follow its five-entry navigation, bilingual identity/Help, staff and doctor tables, person panels, desk editor/access table, grouped settings, review confirmations and tablet composition.

Intentional adaptations use actual V1 contracts: all seven facility roles remain; existing temporary-password/2FA actions are retained; no invitation/recovery workflow is invented; desk changes have independent receipts; hospital review remains platform-owned after submission; verified/shared doctor identity restrictions remain. Additional original settings controls are kept in their relevant group. The access table describes actual staff memberships, rather than inventing a per-user doctor-account relationship. Tables scroll inside their cards on smaller tablets, keeping all actions reachable.

## Actual React captures

The capture inventory contains 67 PNGs from synthetic local fixtures. It includes both languages, all seven settings groups, person/desk panels, access/departments, empty searches, Help, dirty navigation, validation, offline/failure recovery and concurrent changes. Each section is captured at 1440 × 900, 1024 × 768 and 768 × 1024; additional 200% CSS-scale captures check page overflow while retaining horizontal table scrolling. Full-page images can be taller than the viewport. This is a Chromium scale check, not a claim of cross-browser native zoom certification.

| Integrated view | Bangla | English |
| --- | --- | --- |
| Staff list | [Desktop](staff-desktop-bn.png) | [Desktop](staff-desktop-en.png) |
| Staff person panel | [Panel](staff-person-bn.png) | [Panel](staff-person-en.png) |
| Desk assignment review | [Review](staff-desk-review-bn.png) | [Review](staff-desk-review-en.png) |
| Desks and access | [Desks](desks-bn.png), [access](access-bn.png) | [Desks](desks-en.png), [access](access-en.png) |
| Doctor list and person | [List](doctors-desktop-bn.png), [person](doctor-person-bn.png) | [List](doctors-desktop-en.png), [person](doctor-person-en.png) |
| Settings home | [Home](settings-home-bn.png) | [Home](settings-home-en.png) |
| Tablet landscape | [Staff](staff-landscape-bn.png), [Doctors](doctors-landscape-bn.png), [Settings](settings-landscape-bn.png) | [Staff](staff-landscape-en.png), [Doctors](doctors-landscape-en.png), [Settings](settings-landscape-en.png) |
| Tablet portrait | [Staff](staff-portrait-bn.png), [Doctors](doctors-portrait-bn.png), [Settings](settings-portrait-bn.png) | [Staff](staff-portrait-en.png), [Doctors](doctors-portrait-en.png), [Settings](settings-portrait-en.png) |
| 200% scale | [Staff](staff-scale-200-bn.png), [Doctors](doctors-scale-200-bn.png), [Settings](settings-scale-200-bn.png) | [Staff](staff-scale-200-en.png), [Doctors](doctors-scale-200-en.png), [Settings](settings-scale-200-en.png) |

Failure and recovery examples: [partial desk failure](desk-partial-failure-en.png), [desk recovery](desk-recovered-en.png), [invalid rules](rules-invalid-en.png), [failed save](rules-failed-en.png), [offline](rules-offline-en.png), [confirmed save](rules-saved-en.png), [concurrent profile change](profile-concurrent-change-en.png).

## Authorization and recovery evidence

The dedicated six-case `adminDeskSafety.routes.test.ts` and original six-case `hospitalDesks.routes.test.ts` passed together; the complete repository gate also includes them. The new cases assert own-hospital ownership, rejection of foreign staff, all six other facility-role refusals, platform-admin refusal, anonymous refusal, legacy compatibility, reordered member sets, removed/renamed desks, no audit on a refused stale replacement, and two simultaneous competing replacements with exactly one success. These are real route/database tests, not frontend permission assertions.

The browser's partial-save case deliberately refuses the second of three desk writes. It verifies that the first write stays accepted, the third is not attempted, the panel reports rejection/pending outcomes, a reviewed recovery writes only the remaining two differences, and a final authorized API read contains the intended memberships. The pure recovery test additionally covers a thrown write and failed read, then later authoritative receipt reconciliation without replaying writes.

## Verification attempts and corrections

The unchanged baseline passed workspace TypeScript/lint/formatting and seven focused API files / 121 tests. The exact baseline API argument list was not retained in its log; no reconstructed command is claimed. Subsequent verification has preserved failures rather than counting incomplete commands as passing.

- Earlier repository-gate attempts caught an import-group ordering error, a missing confirmation title and a formatting error in the adapted module test. These were corrected before the successful `pnpm.cmd verify --maxWorkers=1` run: **164 files / 8,027 tests, exit 0, 899.81 seconds**, with workspace TypeScript, lint and formatting passing in the same command.
- Browser debugging caught bilingual accessible-name selectors, a corrupted synthetic label, a person Close action pressed during read-back, portrait grid overflow and exact textbox labels that included a required-field marker. The controls/selectors were corrected while preserving the underlying assertions. One development run was interrupted after editing during execution caused a temporary compiler error; it is not passing evidence.
- A fixed unsaved notice covered a Save button; the notice now participates in page flow. The final management cases verify invalid/cancelled/failed/offline saves and actual confirmed read-back.
- At 200% CSS scale, absolute screen-reader labels inside the horizontally scrolling table contributed to page overflow. A management-only positioned scroll container retains the labels and confines their layout. Both languages now pass the page-overflow assertion; normal tablet checks remain.
- The first completed 20-case selection passed nine cases before the original branding test failed: read-back had recalculated secondary shades from a contrast-darkened main colour, leaving Save enabled. The editor now retains the canonical saved theme. The next selection passed nine cases before the same test's final API poll waited while the new review dialog was still open. The adapted test now completes that review before polling; its original patient-facing description, colour, logo and removal assertions remain.
- The review-corrected selection passed twelve cases, then the original facility-setup helper timed out waiting for Add doctor while still in Departments; seven cases were unrun. The helper now explicitly returns to the people list before adding. Source review also caught a legacy query subgroup being passed to unrelated sections. Valid original deep links now apply only to their initial section; unknown tabs open Settings home. Both language cases exercise deep links and subsequent primary navigation.
- The navigation-corrected selection passed all five new cases, then the old setup helper tried to open Capabilities while still in Wards/beds; seven cases were unrun. Settings transitions now return to their home first. The next eight-case remainder reached staff creation, then waited for a password with its review still open: a read-only `textContent()` call does not invoke Playwright's locator handler. A visible-handover assertion now completes the review before reading that one-time value. No password values are included in this package.
- A 27-case development attempt passed all seven original Administration cases and three new management cases, then failed the obstructed Save check, leaving sixteen unrun. Its command is not represented as green. Several failed development attempts also emitted trace-archive teardown errors; those errors do not turn a failed run into a pass. No test retries, configuration exclusions or dependency changes were added.
- Additional E2E TypeScript still reports the unchanged `e2e/import-mapping.spec.ts:308` `suggestedByModel` on `never`. Additional root/tooling TypeScript still reports the four unchanged `passWithNoTests` properties in `vitest.config.ts:36,59,94,107`. Workspace checks and runtime gates are reported separately; those two additional checks are not green.

## Remaining backend and release limits

The corrected focused V1 browser command (`hospital-settings`, `publish-controls`, `sms-month`, `staff-2fa`, `--max-failures=1`) passed **8/8 in 3.9 minutes**, including complete empty-facility setup and one-time-password handover. All five new management cases, four module-visibility cases and three branding cases passed in the preceding selections; those selections also contained the disclosed helper failures above and are not counted as green commands. Six desk-recovery unit cases passed after the recovery refinement. The earlier 8,027-test repository gate predates the final navigation/helper refinements; one consolidated gate is reserved for completion of all remaining modules under the new policy.

- Doctor accounts still have the existing hospital-wide clinical authorization policy. No account-to-clinician mapping or narrower authorization is claimed. The policy remains a separate founder/data-owner decision before the dependent clinical launch.
- Under existing V1 policy, a receptionist with no assigned desk can access hospital-wide queues; doctor/admin roles bypass the reception desk limit. Removing the last assignment is therefore explicitly consequential. This batch does not redefine that policy.
- Multi-desk changes are not atomic. One accepted desk can remain changed when a later desk is refused. Reconciliation reports that state; recovery does not undo valid work.
- Guarded callers prevent stale desk replacements. Legacy PATCH callers omitting `expected` retain last-write-wins compatibility. Ordinary profile/rules/doctor/identity writes also lack a backend conditional version; frontend conflict detection cannot make simultaneous server writes atomic or versioned.
- Unfinished forms exist in memory. Reload/browser closure has a warning but does not durably retain drafts or one-time passwords. There is no management offline outbox.
- Local synthetic tests and founder screenshots do not establish real provider, backup/restore, deployment or clinical-use readiness. Complete release browser suites and real-hospital approval remain separate gates.

Pre-existing untracked `docs/reports/` and ignored `.claude/settings.local.json` are excluded from this batch. Remaining modules proceed in the worktrees recorded in [the continuation checkpoint](../CONSOLE_REDESIGN_CHECKPOINT.md). The existing source fingerprint predates the last navigation/helper corrections and is historical, not a fingerprint of the final consolidated gate.
