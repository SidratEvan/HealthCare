# Findings register — pilot-readiness audit (12 October 2026)

Audited code: `fix/release-audit-2026-10-11` at `8eec772` (the newest Patient App,
Console and API; not yet in `mvp`). Audit branch: `audit/pilot-readiness-2026-10-12`.
All evidence comes from synthetic seeded data on localhost databases (`FR-SEC-08`).

**Severity** is the real-world risk if the item reaches a hospital with real
patients, not how hard it is to fix.
**Kind:** *Verified defect* (reproduced by a test or command recorded here),
*Static defect* (read in the code, not reproduced), *Decision* (correct code,
open policy question), *Infrastructure* (outside the code, or deployment-time).

Statuses are updated in place as remediation proceeds; the history is in git.

| ID | Severity | Kind | Area | Title | Status |
|---|---|---|---|---|---|
| [F-01](#f-01) | High | Verified defect | API, patient privacy | A patient's cancel, late and undo were answered with the staff copy of the whole queue | **Fixed** `be85999`, retested |
| [F-02](#f-02) | Low | Verified defect | Queue engine | A replay key was honoured in a chamber it was never used in | **Fixed** `0b08285`, retested |
| [F-03](#f-03) | Low | Verified defect | Queue API | `POST /sessions/:id/next` has no expected-patient guard | Open (documented; no screen uses it) |
| [F-04](#f-04) | Medium | Static defect | Configuration | `STORAGE_PROVIDER=supabase` boots in production but no adapter exists | **Fixed** `6fcc75b`, retested |
| [F-05](#f-05) | High | Verified defect | Self-hosted stack | Compose drops the SMS URL and receipt secret (and bKash/Nagad), so switching SMS on stops the API | **Fixed** `fcc92b4`, retested |
| [F-06](#f-06) | Low | Verified defect | Tooling | `pnpm lint` runs out of memory on the default Node heap | **Fixed** `d7cbbb7`, retested |
| [F-07](#f-07) | Medium | Infrastructure | Hosting | Backups are not encrypted; host hardening and off-host alerting are not set up | Open |
| [F-08](#f-08) | High (lab module) | Decision | Laboratory | Real lab orders are priced from the demonstration price list (prior C11) | Awaiting owner |
| [F-09](#f-09) | High (clinical module) | Decision | Doctor | Every doctor at a hospital can read every patient record there (prior C9) | Awaiting owner |
| [F-10](#f-10) | Medium (national) | Decision | National | Benchmarks suppress below five observations, not five facilities (prior C10) | Awaiting owner |
| [F-11](#f-11) | Medium | Infrastructure | Operations | Until SMS is live, no patient can book online or sign in on the real-data stack | Documented |
| [F-12](#f-12) | Low | Verified defect | Queue API | A patient's own undo is refused (404), contrary to the route's comment | Open (fails closed) |
| [F-13](#f-13) | Low | Static defect | Patient app | The patient's 30-day refresh token is kept in `localStorage` | Accepted risk, documented |
| [F-14](#f-14) | Low | Verified defect | Test reliability | The 344-case development browser run is not stable on this machine | Open |
| [F-15](#f-15) | Low | Verified observation | API capacity | A burst of 150–240 phones subscribing at once queues on the 10-connection database pool | Documented |
| [F-16](#f-16) | Medium | Decision | Data protection | Clinical records have no retention or erasure policy | Awaiting owner and legal advice |

---

## F-01

**A patient's cancel, late and undo were answered with the staff copy of the whole queue.**

- **Severity:** High. **Module:** API (`queue.controller.ts` `send()`, `booking.controller.ts` `cancelBooking`).
- **What:** `POST /bookings/:id/cancel`, `POST /bookings/:id/late` and `POST /events/:id/undo` are callable by a patient or by anyone holding a tracking link. They answered with `QueueState` exactly as reception holds it: every patient's record ID, every booking ID, and what reception typed about other patients (priority and cancellation reasons). The socket channel and `GET /bookings/:id` deliberately send the anonymised patients' copy (`patientViewOf`, plan I2c), so these three answers were the gap.
- **Evidence:** `pilotAudit.routes.test.ts` › *F-01*. A guest who declared they were late received, among others, `"priority":{"reason":"বয়স্ক, শ্বাসকষ্ট — audit probe (ডেমো)"}` for serial 3 and the `patientId` of serials 1–4 (run log `probe-run3`). The patient app ignores the body, so nothing on screen showed it; anyone with a forwarded SMS link and a script could read it.
- **Real-world impact:** another patient's health remark and stable record identifiers disclosed to any patient in the same chamber; the record IDs are the identifiers the rest of the API is keyed on.
- **Reproduce (synthetic):** book as a guest, open the tracking link, have reception move another patient forward with a reason, then `POST /bookings/:id/late` with the link's token.
- **Fix:** non-staff callers are answered with `patientViewOf(...)` (tickets in place of booking IDs, nil patient IDs, no typed reasons); staff answers are unchanged.
- **Regression tests:** `pilotAudit.routes.test.ts` › *F-01* (late, cancel, undo, staff control); `liveSerial.routes.test.ts` updated to find the patient's own row by its ticket, as the app does.

## F-02

**A replay key was honoured in a chamber it was never used in.**

- **Severity:** Low. **Module:** `queue.service.ts` `findReplay`, `applyBatch`; `booking.service.ts` `cancelBooking`.
- **What:** a `clientEventId` already used in chamber X, sent with an action for chamber Y, was answered `200 duplicate` with **X's queue**, and Y's action was silently dropped. The offline batch path (`/sync/events`) reported such an entry as *accepted* with X's sequence number.
- **Evidence:** `pilotAudit.routes.test.ts` › *F-02* (first run: `answeredWithFirst === true`). Across hospitals the database's row policies already stopped it (the cross-hospital case passed before the fix).
- **Impact:** requires a key collision (client keys are random UUIDs), so unlikely; but when it happens an action is lost while the console believes it succeeded, and two paths (`cancelBooking`, `acceptSlotDetailed`) run with server scope for patients, where row policies do not help.
- **Fix:** the expected chamber is a required argument of `findReplay`; a key from another chamber is `422 IDEMPOTENCY_KEY_REUSED`, and a conflict in a batch.
- **Regression tests:** `pilotAudit.routes.test.ts` › *F-02* (online, offline batch, cross-hospital).

## F-03

**`POST /sessions/:id/next` has no expected-patient guard.**

- **Severity:** Low. **Module:** `queue.controller.ts` `callNext`.
- **Evidence (scratch probe, not committed):** with serial 1 in the chamber, two simultaneous `/next` calls (or a second on a stale screen) finished serial 2 with a 30-second consultation and called serial 3: `1:done 2:done 3:in_chamber`.
- **Why Low:** no shipped screen calls this route. Reception sends explicit *finish X / call Y* events, and the same race on that path was refused (`BOOKING_SETTLED`, `PATIENT_IN_CHAMBER`); Doctor's *Sign & Next* uses the guarded variant (`expectedBookingId`). Only a future integration or script is exposed.
- **Recommendation:** before any integration uses it, accept an optional expected booking (the service already supports it) or retire the route. Not changed in this audit: it would add API surface no screen needs.

## F-04

**`STORAGE_PROVIDER=supabase` boots in production but no adapter exists.**

- **Severity:** Medium. **Module:** `env.ts`, `adapters/storage.ts`.
- **What:** the environment schema accepts `supabase` and asks for its keys; `storage()` then returns `UnconfiguredStorageAdapter`, which refuses every write. `env.test.ts` called that configuration "a valid production environment".
- **Impact:** a server configured that way boots healthy and then refuses every lab report and patient document.
- **Fix:** production refuses `STORAGE_PROVIDER=supabase` at boot with the reason; `local` is the real-data setting (as `deploy/docker-compose.yml` already uses).
- **Regression test:** `env.test.ts` › *refuses Supabase Storage*.

## F-05

**Compose drops the SMS URL and receipt secret (and bKash/Nagad), so switching SMS on stops the API.**

- **Severity:** High (it takes the hospital's whole deployment down on the day SMS is switched on). **Module:** `deploy/docker-compose.yml`.
- **What:** DEPLOY.md §S3 tells the operator to put `SMS_PROVIDER=http`, `SMS_API_URL` and `SMS_DLR_SECRET` in `deploy/.env`. Compose passed only `SMS_PROVIDER`, `SMS_API_KEY` and `SMS_SENDER_ID` to the API. `env.ts` refuses to boot under `http` without the other two. `BKASH_*`, `NAGAD_*` and `SMS_MONTHLY_CAP` were not passed at all.
- **Evidence:** `docker compose -f deploy/docker-compose.yml --env-file <probe env> config` rendered the API environment without `SMS_API_URL`, `SMS_DLR_SECRET`, `SMS_MONTHLY_CAP`, `BKASH_BASE_URL`, `NAGAD_BASE_URL` (probe env uses fake values only). A Codex audit worktree recorded the same three keys missing.
- **Fix:** compose passes all of them; `deploy/.env.example` lists them.
- **Regression test:** `deployment.test.ts` › *the self-hosted stack passes every setting DEPLOY.md asks for*.

## F-06

**`pnpm lint` runs out of memory on the default Node heap.**

- **Severity:** Low (tooling). **Evidence:** baseline `pnpm verify` ended in ESLint `FATAL ERROR: … JavaScript heap out of memory`, exit 134; the same lint passed with a 3 GB heap. CI runs `pnpm lint` with no heap setting; whether CI hits this was **not verified** (no CI access from this session).
- **Fix:** the root `lint` and `lint:fix` scripts run ESLint with a 4 GB heap.

## F-07

**Backups are not encrypted; host hardening and off-host alerting are not set up.**

- **Severity:** Medium. **Kind:** Infrastructure.
- **What:** `deploy/backup.sh` writes a plain `pg_dump` and a plain `tar.gz` of uploaded reports, locally and to `BACKUP_SECOND_DIR`. Encryption at rest therefore depends entirely on the disks. DEPLOY.md does not cover full-disk encryption, SSH key-only access, firewall rules, OS security updates, or who may reach the server remotely. `/readyz` reports backup health, but no alert is wired (DEPLOY.md says so plainly: "somebody has to look each morning").
- **Recommendation (no paid service needed):** full-disk encryption on the server and on the second backup disk (LUKS); SSH keys only, no password login, `ufw` allowing 22/80/443 only; unattended security updates; a free uptime checker on `/readyz` that alerts on a non-empty `attention`; a written list of who holds remote access. Optionally encrypt the dump before copying with `age` (a small, free tool), which would need the owner's go-ahead as a new dependency on the server.
- **Status:** not implemented in code. These are pre-patient-data conditions.

## F-08

**Real lab orders are priced from the demonstration price list** (prior finding C11).

- **Severity:** High *if* the laboratory module is enabled for real patients; none for a reception-only pilot. **Kind:** Decision.
- `lab.service.ts` `DEMO_TEST_PRICES` is the catalogue whatever `DEMO_MODE` says; orders copy those prices, and reports and revenue read them.
- **Needs from the owner:** keep Laboratory switched off for the first pilot, or agree how a hospital's own catalogue and prices are supplied. Prices are commercial content and stay out of the repository (CLAUDE.md §1.2).

## F-09

**Every doctor at a hospital can read every patient record there** (prior C9).

- **Severity:** High for clinical use; a policy question, not a bug. Doctor accounts are not linked to clinician rows, so "only my patients" cannot be enforced today. Every read is audited.
- **Needs from the owner and the hospital:** accept hospital-wide clinical access for the pilot in writing, or keep the Doctor workspace out of the first pilot.

## F-10

**National benchmarks suppress below five observations, not five facilities** (prior C10).

- **Severity:** Medium, national layer only; not used in a hospital pilot. Needs a suppression rule from the owner before real figures are published.

## F-11

**Until SMS is live, no patient can book online or sign in on the real-data stack.**

- With `DEMO_MODE=false`, a guest booking must prove its phone with a code (`guestPhoneCheckRequired()`); with `SMS_PROVIDER=log` the code never reaches a phone. Patient accounts sign in by the same code.
- The pilot therefore runs at the counter only until an SMS aggregator is live. `deploy/.env.example` claimed "a patient then follows their serial from the link the booking screen shows"; it now says what is true. No code change: turning the check off would let anyone book under anyone's number.

## F-12

**A patient's own undo is refused (404).**

- `queue.routes.ts` says a patient has the same ten-second undo as reception, but `requireEvent` reads `queue_events` under the patient's database scope, which holds none, so the patient gets `404`. The patient app never offers undo, so nobody is affected and it fails closed. Left as is; recorded so nobody relies on the comment.

## F-13

**The patient's 30-day refresh token is kept in `localStorage`.**

- Script injection on the patient origin could read it. Mitigations already present: a strict CSP, no `dangerouslySetInnerHTML` anywhere in the apps (searched), refresh bound to the device's user agent, rotation with reuse detection. Accepted as a documented risk for a PWA without cookies.

## F-14

**The 344-case development browser run is not stable on this machine.**

- **Evidence:** the baseline run on `8eec772` ended 313 passed, 33 failed (1.5 h). Thirty-one failures were one event: the console's `next dev` server exited with Windows status `0xC0000409` after case ~294, and every later case that opened the console got `ERR_CONNECTION_REFUSED`. The other two (`console-access.spec.ts:84`, `emergency-burn.spec.ts:98`) failed under the long run and **passed when re-run alone** on the same code (7/7 with a warm-up spec, 4.8 min). The burn case failed in the same second the patient dev server reported a full Fast Refresh reload.
- **Impact:** none on patients; development-mode servers, not the built product. But a gate that fails for reasons other than the product trains people to ignore it (CLAUDE.md §6: a flaky test is a bug).
- **Recommendation:** run the long suite against built apps (as `test:e2e:prod` already does), or split it into two runs that each start fresh servers; give `console-access.spec.ts:84` (1.7–1.8 min alone) more headroom or split it.

## F-15

**A burst of phones subscribing at once queues on the database pool.**

- **Evidence (load probe, local machine):** 150 then 240 patients' phones subscribed to one chamber at the same moment; while they subscribed, the API logged 44 "slow query" warnings (300–1,257 ms) on a 40-event queue log, which points to waiting for one of `DATABASE_POOL_MAX=10` connections rather than an expensive query. Every phone subscribed. Afterwards, ten advances reached **every** phone in 270 ms median / 594 ms worst (150 phones) and 567 / 709 ms (240 phones), well inside the two-second promise (`FR-PAT-31`).
- **Impact:** after a hospital Wi-Fi drop, reconnecting phones may wait a second or two for their first update. Not a correctness issue.
- **Recommendation:** the self-hosted stack already sets `DATABASE_POOL_MAX=20`; leave it, and watch `/readyz` latency during the dry run. No code change.

## F-16

**Clinical records have no retention or erasure policy.**

- Patient rows are soft-deleted; there is no workflow that erases a person's clinical record, and no stated retention period for visits, prescriptions or reports. Message bodies are kept 90 days and import staging 30 days.
- **Needs:** the hospital's and the company's legal advice on Bangladesh's data-protection requirements and medical-record retention, before the pilot agreement is signed. Not a code change until that advice exists.

---

## Retest evidence for the fixes (Phase 4)

| Finding | Before | After |
|---|---|---|
| F-01 | `pilotAudit` › late, cancel: response contained other patients' IDs and the priority reason | Same tests pass; the staff control still receives the staff copy; `liveSerial.routes` passes with ticket lookups |
| F-02 | Second chamber answered `200` with the first chamber's queue | `422 IDEMPOTENCY_KEY_REUSED`; batch entry reported as a conflict; cross-hospital case still passes |
| F-04 | `env.test` treated `supabase` as a valid production environment | Refused at boot with the reason |
| F-05 | Rendered compose environment **refused** by `env.ts` (`SMS_API_URL`, `SMS_DLR_SECRET`) | Same probe env renders all settings and **boots**; `deployment.test` checks 18 documented settings |
| F-06 | `pnpm lint` exit 134 (heap) | `pnpm lint` passes inside `pnpm verify` |

Affected API files after the fixes: 15 files, 802 tests, all pass (pilotAudit, liveSerial, env, deployment, queue, queueConflict, sync, standby, standbySelfServe, booking, myBookings, realtime, receptionSafety, doctorSafety, tenantMatrix).
