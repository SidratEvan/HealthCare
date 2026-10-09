# Status

Where the build actually is, and what a new session needs to know that is not
already in `CLAUDE.md` or derivable from `git log`.

**Update this at the end of every step.** It exists so that handing the work to
a fresh session costs one file read instead of a re-explanation, and it is only
worth that if it is true.

Last updated: E1 `feat/import-spreadsheet` (8 October) — **an Excel `.xlsx` file is imported directly, as the owner decided** (below, *Merged in V1 completion*). Before that, R5 design note (8 October) — **the design for one doctor across several workplaces is written for the owner and waits for approval** (`docs/design/doctor-workplaces.md`, question 21); every other row of the plan that needs nothing from outside is built. Before that, R7 `feat/chamber-organisations` (8 October) — **an approved private chamber joins as an organisation, created by the platform only** (below, *Merged in V1 completion*); next R5, which begins with a design note for the owner. Before that, R4 `feat/reception-desks` (8 October) — **an administrator names reception desks and their doctors, and the picker opens a desk on its own chambers first** (below, *Merged in V1 completion*); next R7. Before that, R6 `feat/admin-overview` (8 October) — **the administrator's dashboard opens on the hospital now** (below, *Merged in V1 completion*); next R4. Before that, R1 `feat/arrival-windows` (8 October) — **a hospital may offer a preferred hour to arrive, chosen at booking, never a promise** (below, *Merged in V1 completion*); next R6. Before that, R3 `feat/patient-documents` (8 October) — **a signed-in patient keeps old papers under a profile, private, and a doctor sees them only under consent** (below, *Merged in V1 completion*); next R1. Before that, R2 `feat/prescriptions` (8 October) — **a doctor writes, signs and prints a prescription, and the patient sees and prints it** (below, *Merged in V1 completion*); next R3. Before that, J `chore/v1-release` (8 October) — **V1 is prepared for release and not released: the full gate passed with two test corrections, and `DEPLOY.md` §7 is the plan; `main`, `demo`, Supabase and the deploy wait for the owner's word.** E1 is blocked on question 19; priority 3 begins with R2. Before that, F3 `feat/noshow-prepay` (8 October) — **a hospital may ask a number with three no-shows to pay its next guest serial online first** (below, *Merged in V1 completion*); K3 and K4 merged before it; the next branch is E1. Before that, `chore/owner-decisions-8-october` (8 October) — **the owner's note of 8 October: finish V1 (K1, K2, H3, F3, E1), prepare J, and launch; `main`, `demo`, Supabase and real payments wait for his word** (`CLAUDE.md` §4.6; the post-pilot roadmap and the hospital UI review are `docs/PLATFORM_PLAN.md` §2, *Later*). Documents only. Before that, the patient redesign, Visual Direction 2 (`feat/patient-redesign`, 7–8 October) — **the patient app wears the design the owner approved, with the official MedLiveBD logo** (below, *Merged in V1 completion*); the next branch is still H3, documents first. Before that, I3 `feat/patient-rls-queue` (7 October) — **one patient is
kept from another by the database for bookings, payments and messages too**
(below, *Merged in V1 completion*); the next branch is H3, documents first.
Before that, I2d `feat/app-csp` (7 October) — **a page runs only the
scripts it was given a nonce for**. Before that, I2c `fix/serial-broadcast-ids` (7 October) —
**a patient's phone is sent a queue that names nobody**. Before that, I2b `chore/limits-secrets` (7 October) —
**one ceiling on everything asked without an account, a limit on bed
requests, and no two secrets alike**. Before that, I2 `chore/ops-signals` (7 October) — **`/readyz` says how the
whole deployment is doing**. Before that, I1 `chore/api-build` (7 October) — **the self-hosted API runs
compiled, from an image without the build tools**. Before that, `chore/v1-completion-plan` (6 October) — **the build goes on
to the complete V1: the plan is `docs/PLATFORM_PLAN.md` §2, *Now: V1
completion*, and `CLAUDE.md` §4.5** (below, *Now: V1 completion*). Documents
only. Before that, `chore/pitch-release` (6 October) — **the V1 pitch build is
released as MedLiveBD: `main` and the public demo are `mvp` at `fa31157`
(and this branch's documents), Supabase has
migrations through 0038 and fresh demo data, and `demo` is the same commit**
(below, *Now: the V1 pitch build* and *Running the pitch demo*). The plan's
rule from here is the owner's: stop adding V1 features; what is next is his
own walk through the demo and whatever it turns up. Before that,
`chore/v1-direction` (5 October, evening) — **the feature
freeze is lifted and the product is one shared multi-hospital platform; the
V1 pitch build is what is being built** (below, *Now: the V1 pitch build*).
Documents only. Before that, `chore/pilot-candidate` (5 October) —
**`fb1d1d8` is the reception-pilot candidate, approved by the owner**; the
stop that came with it ("all product work is stopped until a hospital agrees
to pilot") **was lifted the same evening and no longer holds** (below,
*Pilot readiness*, for what is still true of it). Before that,
`chore/e2e-pilot-path` (5 October) — **P4: the pilot's own path
runs under the production configuration, and the answer is go, on three
conditions that are not code** (below, *Pilot readiness*). **Work has
stopped there, as the owner directed: nothing from the plan resumes until
he has read that section.** Before that, `fix/chamber-end-of-day`
(5 October) — **P3: a chamber can be
ended from the console, and not around a patient** (below, *P3*). Nothing
ended one before, so yesterday's chamber was the first offered the next
morning, on a card with no date. Before
that, `fix/console-demo-banner` (5 October) — **P2: a screen says it
is a demonstration only where the server says so** (below, *P2*). The line
was printed unconditionally on ten console screens and four of the patient
app's, so a hospital's own server would have told its staff that their
patients were display data. Before that,
`chore/requirements-5-october` (5 October) — **client-readiness
mode: feature work is frozen and the order is P2, P3, P4, then a go or no-go
for a supervised reception pilot** (below, *Now: client-readiness mode*;
`docs/PLATFORM_PLAN.md` §2). Documents only: the owner's decisions of that
day, written down before any of them is built. Before that,
`fix/console-ack-rollback` (5 October) — **a tap stays on the
reception console when its answer arrives before its broadcast** (plan 1.9b;
below, *Plan 1.9b*). The queue used to step back to the patient before, and
stay there while the socket said nothing. **Two things it leaves, neither
measured:** the ward board and the ER console have the same shape, and an
action is folded twice while the answer is the slower one (same section).
With it, `fix/materialise-test-midnight` and `fix/tests-past-midnight` —
**two tests that failed just after Dhaka midnight, every night** (below,
*Things learned the hard way*); the product was right both times, and one
question for the owner came out of it (a chamber that runs past midnight),
which he answered the same day (`FR-QUE-06`, `FR-PAT-39`).
Before that, `fix/console-key-race` (5 October) — **a key on the console is
answered by the screen as it stands, not by the one before the last redraw**
(plan 1.9a; below, *Plan 1.9a*). It was the one failure in CI's third run,
and **the fourth run (37350834049, `d1ca84a`) was the first in which all
three jobs passed**. Before that,
`chore/status-handover` (3 October) — **phase 1 is merged and
pushed through 1.9; 1.10 is next and starts with a design note for the
owner** (below, *Next: plan 1.10*). No product code changed. Before that,
`fix/log-sms-redaction` (3 October) — **a message leaves no
phone number, no text and no link behind it** (plan 1.9; below, *Plan 1.9*):
the `log` SMS provider writes one line naming the message and nothing else,
no link is stored in the outbox, and a message's words are cleared after 90
days. Before that, `fix/e2e-fast-runner` (3 October) — **the first CI run of the
browser suite failed six tests on GitHub's faster runner, and both causes
were in the suite, not the product** (below, *Plan 1.8*; decision 90): a
per-address limit that 150 simulated patients share, and a fixture that
could pick a name already taken. The canary passed there. Before that,
`chore/push-permission` (3 October) — **the owner gave standing
permission to push and merge to any branch** (`CLAUDE.md` §3.1, which now
says so in his words; a force-push still needs asking). Under it plan 1.8 was
merged as `4ece550` after the whole gate passed on it, and `mvp` and `demo`
were pushed there. No product code changed. Before that, `chore/e2e-ci`
(3 October) — **the browser suite runs in CI,
the canary first, and the canary and the counter also run against the
production configuration** (plan 1.8; below, *Plan 1.8*). Under that
configuration a patient still cannot book: there is no SMS provider. Before
that, `chore/ops-hardening` (3 October) — **on a hospital's server the
API no longer owns the database, nothing of ours runs as root, logs rotate,
and a backup is not a backup until it has been restored and copied
elsewhere** (plan 1.7; below, *Plan 1.7*). The role still bypasses row-level
security until 1.10, and nothing alerts anybody yet. Before that,
`feat/console-offline-load` (3 October) — **the console opens
with no network, on the queue it was last told** (plan 1.6; below, *Plan
1.6*). In the tab that was signed in; without names; the reception queue
only. Before that, `fix/e2e-outbox-close-race` (3 October) — **the outbox specs
wait for a blocked push to be refused before they close the page** (a test
fix; below, *Plan 1.5*, *Learned about the tests*). Before that,
`fix/offline-outbox-persist` (3 October) — **what a console
queued and could not send survives a reload, a crash and a power cut** (plan
1.5; below, *Plan 1.5*). The console still cannot *open* with no network;
that is 1.6. Before that, `fix/broadcast-after-commit` (3 October) — **a screen is told
about a queue write only once it is in the database** (plan 1.4b; below,
*Things learned the hard way*). Found by `lab-report.spec.ts` while 1.5 was
being verified. Before that, `fix/queue-pool-starvation` (3 October) — **a queue write no
longer needs a second database connection while it holds the chamber's
lock** (plan 1.4a; below, *Things learned the hard way*). Found by the
verification gate while 1.5 was being verified. Before that, `chore/e2e-memory-finding` (3 October) — **`demo` moved to
`10bbcd1` after a clean 144/144 browser run, and why two runs before it each
failed one test** (below, *Things learned the hard way*: the machine ran out
of memory, and the process that grows is Playwright's trace recorder, not the
product). No product code changed. Before that, `fix/sync-event-allowlist`
(2 October) — **the sync path
replays only what a counter can do offline** (plan 1.4; `BACKEND.md`
`SY-07`): eleven event types, each from a role its own route admits; undo,
offers, cancellation, ending a chamber and walk-ins are refused there and
keep their own routes. Before that, `fix/console-undo` (2 October) — **the
console's Undo undoes**
(plan 1.3): the toast and `Ctrl+Z` take back the whole tap through the real
undo route, or drop it if it was never sent. **Still missing against
`GR-02`:** the row buttons (done, late, absent, bring back, check-in) show no
undo toast of their own; `Ctrl+Z` is the only way to take those back. Before
that, `fix/console-resume` (2 October) — **a chamber paused from the
console is resumed from the console** (plan 1.2; decision 87): the pause
button reads আবার শুরু while paused, key `P`, with a banner and call-next off
for the length of the break. Before that, `fix/delay-on-arrival` (2 October)
— **a delay declared before the doctor arrives is used up by the arrival**
(plan 1.1; decision 86). The patient at the front of an empty chamber is told
"now", not "in half an hour", and cannot be marked absent before the time on
their phone. Before that, `chore/platform-plan` (2 October) — **the owner's implementation
brief became `docs/PLATFORM_PLAN.md`**: the order of work from here, branch by
branch, and the decisions it waits on (below, *The platform plan*). No product
code changed. Before that, `chore/handover` (2 October) — **a technical handover read from
the code, `docs/HANDOVER.md`, and what it found** (below, *Handover audit*). No
product code changed. Before that, `fix/guest-device-proof` — **a returning
guest proves the phone once per device** (decision 85, ruled). With it all four holes the security
review found are closed (below, *Security review*). Before that,
`fix/booking-payments-scope` — **a booking's payments are read by its owner
and its hospital only**. Before that, `fix/guest-booking-scope` — **a guest token
now opens only the booking it names**. Before that,
`fix/standby-phone-proof` — **a standby place and a bed request prove the
phone first, as a booking does**. Before that,
`fix/visit-doctor-only` — **only a doctor writes a visit, and a signed one is
final**. Before that, `chore/security-review` — **a
security review of the whole codebase found four holes to close before real
patient data**. Before that, `feat/staff-2fa` — **an
administrator signs in with a code
from their phone** (pilot step 28; below, *Step 28*). Before that,
`chore/self-host` — **the whole stack on a hospital's own
server, from one command** (pilot step 26; below, *Step 26*). Before that,
`feat/patient-otp` — **a patient proves a phone and finds what it holds**
(pilot step 25; below, *Step 25*). Before that, `feat/data-import`
— **a hospital imports what it already holds** (pilot step 24; below, *Step
24*). Before that, `feat/counter-registration`
— **walk-ins and the registration desk** (pilot step 23; below, *Step 23*).
Before that, `feat/hospital-settings`
— **a hospital sets itself up from `S-B-11`** (pilot step 22; below, *Step
22*). Before that, `feat/staff-auth` —
**staff sign in with their own accounts** (pilot step 21; below, *Step 21*).
Before that, `chore/pilot-scope` — **the
pilot build is in the documents**:
import requirements, auth un-deferred, steps 21–28 (below, *The Marks
handbook*). Before that, `fix/console-rail-billing` — **the rail's বিল no
longer opens the pharmacy; ফার্মেসি has its own item**. Before that, `fix/consult-overflow` —
**a patient forgotten in the chamber no longer freezes it** (below, under *Preparing the demo*). Before that,
`chore/status-marks-handbook` — **a Bangla handbook for Marks
Group, and what a real (non-demo) version for them would need** (below, *The
Marks handbook*). No product code changed. Before that, `fix/phone-entry-normalise` — **the booking and standby forms
refused a mobile number typed as 01…**, found rehearsing the first hospital
pitch (28 September), with what that rehearsal taught about preparing the
demo (below, *Preparing the demo for a
meeting*). Before that, `fix/console-rail-links` and `fix/demo-refresh-retry` — **the
first scheduled refresh emptied the demo, and the console rail did nothing
when clicked** (below, *The first scheduled refresh*). Before that,
`feat/demo-week` — **a week of demo for people to explore**:
eight days of booked sessions, and a daily reset of the deployed demo from
26 September to 2 October (below). With it, `fix/console-picker-friday`: the
picker hid four hospitals' ward, ER, lab and office every Friday. Before that,
`feat/language-switch` — **English, everywhere, behind a switch at the top of
both apps**. Before that, `fix/console-bangla-digits`, the
Render fixes, `fix/pitch-design` and step 20 — the design pass the owner
asked for after seeing the live demo, and the bugs found on it. Before
that, `fix/ci-node` (CI green again on Node 24) and `feat/gov-dashboard` —
**step 20, the last step in the build plan**. A government viewer opens `S-B-13` from the picker and sees capacity
by district, the emergency heat map, disease signals and an anonymised
benchmark, read as a database role that cannot open a single patient row.
Decision 5 (a national role has no facility) is implemented one way and needs
the owner's ruling, with seven more listed under open decisions (66–73).
Before that, `feat/standby-self-serve` (decision 62) and `feat/check-in`
(decision 61), after step 19.

---

## Build plan position (`CLAUDE.md` §4)

| Step | Branch | State |
| --- | --- | --- |
| 0 | `chore/scaffold` | merged |
| 1 | `feat/db-core` | merged — migrations 0001–0006 |
| 2 | `feat/domain-queue` | merged — reducer, ETA, rate, rules, replay |
| 3 | `feat/api-foundation` | merged — env, db, logger, middleware, errors, health |
| ~~4~~ | ~~`feat/auth-guest`~~ | **deferred, do not build** — see `CLAUDE.md` §4.1 |
| 5 | `feat/seed-demo` | merged — `database/seeds` 00–07 + `reset.ts` (`FR-DEM-*`) |
| 6 | `feat/queue-service` | merged — `appendEvent()`, 13 queue routes, realtime |
| 7 | `feat/ui-tokens` | merged — tokens, contrast checks, seven primitives |
| 8 | `feat/console-reception` | merged — sync protocol, offline queue, the console, Playwright |
| 9 | `feat/patient-booking` | merged — discovery, booking, guest booking, mock payment |
| **10** | **`feat/patient-live-serial`** | **merged — the pitch demo works.** `<LiveSerialCard>`, the session channel on the patient side, late/cancel, and the two-device canary |
| 11 | `feat/notifications` | merged — migration 0010, templates, the outbox, SMS/push adapters |
| 12 | `feat/doctor-console` | merged — migration 0007, `S-B-05`, the visit record, `FR-DOC-10` + audit. **E-prescriptions dropped**; `PRD.md` §9/§24/§26 and `APP_FLOW.md` B2 edited to match |
| 13 | `feat/wallet` | merged — `S-A-12`, the consent handshake (`BTN-A12-QR` → `BTN-B05-SCAN`), the access log and revoke. A pasted code stands in for the QR |
| 14 | `feat/beds` | merged — migrations 0008 + 0012, `S-B-06` the ward board, `<CapacityMirror>`, `S-A-11` bed search and bed requests, the ward's half of `FR-OFF-01` |
| 15 | `feat/emergency` | merged — migrations 0013 + 0016, `S-A-10`/`10b`/`10c`, `S-B-07` the ER console, the ward's ER half of `FR-BED-07`, `emergency-burn.spec.ts` |
| 16 | `feat/referrals` | merged — migration 0017, the referral state machine, both halves of the ER console, `referral.spec.ts` |
| 17 | `feat/lab-pharmacy` | merged — migrations 0011 + 0018, `S-B-08`, the stock half of `S-B-09`, `BTN-B05-TEST`, `TAB-A12-REP`, the medicine search, `lab-report.spec.ts`. **Dispensing dropped**; `PRD.md` §12 and `APP_FLOW.md` B5 edited to match |
| 18 | `feat/payments` | merged — migrations 0009 + 0019, the refund and settlement domain, the provider seam, `seed_08_money`, the refund statement on `MOD-A08-CANCEL`. **bKash and Nagad are not implemented**; the mock is the working provider (`CLAUDE.md` §1.1) |
| 19 | `feat/admin-dashboard` | merged — migration 0020, `S-B-10`, the standby card on `S-B-02` (`BTN-B02-OFFER`), CSV export with audit, `no-show-recovery.spec.ts`. **Average wait is not measured**: nothing records a patient arriving (decision 61) |
| 20 | `feat/gov-dashboard` | merged — migrations 0024–0026, `S-B-13`, `gov_reader`, `CHIP-B05-SIGNAL`, `seed_09_signals`, `gov-dashboard.spec.ts`. **Decision 5 implemented, not ruled**: national roles hold a null hospital. `FR-GOV-05` (shared health record) waits for a counterparty |
| **21** | **`feat/staff-auth`** | **merged — the pilot's first step** (`CLAUDE.md` §4.2). Migration 0027, `S-B-00` sign-in, `S-B-00c` first password, the picker narrowed to the person's own facility and roles, refresh rotation, lockout, `pnpm staff:create`, `staff-login.spec.ts` |
| **22** | **`feat/hospital-settings`** | **merged** — migration 0028, `S-B-11`, `/hospital/*`, the hourly session materialiser in the API, `pnpm doctor:verify`, `hospital-settings.spec.ts` |
| **23** | **`feat/counter-registration`** | **merged** — `S-B-03`, `MOD-B02-WALKIN`, `/registration/patients`, the walk-in replay fix, `counter-registration.spec.ts` |
| **24** | **`feat/data-import`** | **merged** — migrations 0029–0031, `S-B-14`, `/hospital/imports`, sets A–C, undo, the body-limit fix, `data-import.spec.ts` |
| **25** | **`feat/patient-otp`** | **merged** — migration 0032, `/auth/*`, `/guest/start`, `/guest/verify`, `/guest/claim`, the Profile tab, `patient-account.spec.ts` |
| **26** | **`chore/self-host`** | **merged** — `Dockerfile`, `deploy/` (compose, Caddy, backup, restore), local file storage, `PAYMENT_PROVIDER=off`, `GET /config`, `DEPLOY.md` Part S, `self-host.spec.ts` |
| 27 | `feat/sms-live` | **waits for an SMS aggregator account** (`CLAUDE.md` §4.2) |
| **28** | **`feat/staff-2fa`** | **merged** — migration 0033, `config/totp.ts`, `/staff/2fa`, `/staff/2fa/setup`, `/staff/2fa/enable`, `S-B-00b`, `S-B-00d`, the reset on `S-B-11`, `pnpm staff:reset-2fa`, `staff-2fa.spec.ts` |

**Every step in `CLAUDE.md` §4 is now merged** (4 deferred by design), and
every pilot step in §4.2 but 27, which waits for an SMS aggregator account.
What remains is the owner's: the open decisions below, applying migrations to
Supabase, and whether `mvp` goes to `main`.

### Now: V1 completion (owner, 6 October)

**Read `CLAUDE.md` §4.5, then `docs/PLATFORM_PLAN.md` §2, *Now: V1
completion*.** After the pitch release the owner wrote that development does
not stop there: build MedLiveBD to the complete V1, and leave undone only
what needs an account, credential, contract or approval he has not provided.
The plan's table is the remaining work, from an audit of the code that day.

**Completed** (before this plan; none of it is rebuilt): every hospital
console, the patient app with search, guest booking, phone verification, live
serial, records and consent, emergency search, the hospital-scoped app, the
organisation lifecycle and the platform administrator's screen, the template
and mapped imports with the model's suggestions and the warnings, the
reception console's offline queue, the self-hosted stack, CI with the browser
suites. Branches of this plan as they merge are listed under **Merged in V1
completion** below.

**Currently building** (owner, 8 October; `CLAUDE.md` §4.6): K1, K2, H3, K3, K4 and F3 are merged and J is prepared; E1 `feat/import-spreadsheet` is blocked on question 19; priority 3 is built (R2, R3, R1, R6, R4, R7) except R5, whose design note waits for the owner (question 21), then J prepared up to release, then priority 3 (`docs/PLATFORM_PLAN.md`, *The owner's approved product decisions*, which marks each decision built, partly built or missing). **Not without the owner's word:** moving `main` or `demo`, deploying, applying migrations to Supabase or resetting its data, real payments. The leave-home message still waits on question 13.

**H3 as it was found, for whoever builds it** (7 October; nothing is written yet). The plan's row reads as two adapters. What is actually missing is the whole of paying by being sent away and coming back, of which the adapters are the smaller part:

- `payment.service` `charge` handles a provider that does not settle on the spot by returning its `redirectUrl`, and then **keeps nothing of it**: the provider's reference is written only when the money has already moved, so a later callback cannot find the payment it is about (`findByProviderRef`). No provider but the mock has ever been through it.
- **The patient app does not follow a redirect.** Nothing in it reads `redirectUrl`, and there is no page to come back to.
- **bKash sends no signed webhook for a payment.** Its checkout returns the patient's browser to an address with a payment id and a status, and the merchant then asks bKash, server to server, to execute and confirm. `/webhooks/bkash` with an HMAC signature is the mock's own invention and fits no real flow; `adapters/payments/bkash.ts` already says what the real one has to do, and says it was left unwritten on purpose. Nagad signs with RSA keys in both directions.
- So the provider seam needs one more member (confirm a payment by asking the provider), the service needs a pending payment that remembers its reference and runs out, the API needs an address the patient returns to, and the app needs that page in its four states.
- `APP_FLOW.md` has no screen for any of this, and `hospital_settings.prepay_required` exists, which is what makes question 15 matter.
- **How it is to be built when it is:** as H2 was. Against stand-in providers that speak what bKash and Nagad publish, said plainly to be untried against either's own sandbox, with a sandbox checklist in `DEPLOY.md` that has to pass before a real taka moves. `CLAUDE.md` §4.5 asks for exactly that, and it is later than the file that declined to.

**Merged in V1 completion, newest last:**
- **E1 `feat/import-spreadsheet`** (8 October; the owner's answer to question 19) — an Excel `.xlsx` file is imported directly (`FR-IMP-22`). **Checked before adding:** `read-excel-file` 9.3.12 is MIT and maintained (published 7 October), its dependencies (`fflate`, `saxen`, `unzipper-esm`, `worker-f`) are MIT, and `pnpm audit` holds no advisory against any of them; it is in the console only and loaded only when a spreadsheet is chosen, so no other screen carries it. **The audit did find nine advisories, none of them this library's:** all are in Next.js 16.3.5, which both apps already run (one critical, `next/og`; three high), fixed in 16.3.8, within the range the apps already declare; that is its own branch, next. **What changed:** `sheetToCsv` and the file-kind checks in `shared/domain`; `readImportFile` in the console; the file input takes `.xlsx`; `SEL-B14-SHEET` when a workbook has several sheets with rows; `.xls`, unreadable and oversize files are each said in plain words. Dates come from the cell, never from how a sheet shows them, so `05/04/2025` is never guessed at. **Unchanged, by the owner's word:** the mapping, the model's suggestions, the check, the preview, approval, the audit, undo. **No migration, no API change.** Focused gate (the import screen): typecheck, lint, format whole; the import domain suite (106); `pnpm --filter @platform/console build`; in the browser data-import (with a genuine two-sheet workbook built by `e2e/support/xlsx.ts` from Node's own `zlib`, and an `.xls`) and import-mapping (8).
- **R7 `feat/chamber-organisations`** (8 October; the owner's decision 7; documents first in the same branch) — approved private chambers (`FR-ONB-11`, new). **What changed:** migration 0062 adds `chamber` to `facility_kind`; `FACILITY_KINDS` carries it and `APPLICABLE_FACILITY_KINDS` (the four the public may apply as) does not, so `POST /hospital-applications` refuses it and the application form does not offer it, while `POST /platform/hospitals` and the platform's create form do; its name is প্রাইভেট চেম্বার / Private chamber everywhere a kind is named (the national benchmark included). Once made, a chamber is a workspace like any other. **Left to the platform's own process, not decided here:** what it checks before approving a chamber. **No demo chamber:** the seed's six facilities are what every count in the suite and the demo stands on; the platform can create one from its screen. **Supabase needs 0039–0062 before the next release.** Focused gate (onboarding screens, an enum value): typecheck, lint, format whole; the application, platform, gov, shared and schema suites (5,627); in the browser hospital-application and platform-onboarding (7).
- **R4 `feat/reception-desks`** (8 October; the owner's decision 2b; documents first in the same branch) — reception desks (`FR-REC-32`, new). **What changed:** migration 0061 (`reception_desks`, `reception_desk_doctors`, the organisation's own rows under `app_org`). `GET /hospital/desks` (any member of the hospital's staff), `POST`, `PATCH` (names, or the doctors, which replace the list), `DELETE` (kept as removed), each change audited (`desk_added`, `desk_changed`, `desk_removed`, named in the platform's trail too); a doctor of another hospital and a name already used are refused. The settings screen's staff tab has `FRM-B11-DESKS`: each desk with a chip per doctor, saved per desk, removed after asking twice. The picker (`SEL-B01-COUNTER`, as the documents already named it) offers সব চেম্বার and each desk, remembered on the device per hospital; with a desk chosen the chambers are in two lists, the desk's first and every other after; nothing is hidden. Each chamber now carries its `doctorId`. **Decided here, raised as question 20:** a desk organises and does not restrict (decision 2a's common workspace; a receptionist covering another desk is never locked out). **Not built:** money per desk (`FR-REC-23`, the rest of question 10). **Demo data:** Padma has a ground-floor and a first-floor counter, its doctors split between them. **Supabase needs 0039–0061 before the next release.** Strict gate (a migration, tenancy): typecheck, lint, format whole; the desk, settings, tenant-matrix, demo, staff-auth, platform-health, shared and schema suites (6,084, then the schema suite again after the join table was given the `updated_at` every table carries, which `db:verify`'s invariant caught); in the browser the new reception-desks spec (it also caught the demo service dropping the desks from the picker's list), hospital settings, the rail, staff login and the canary.
- **R6 `feat/admin-overview`** (8 October; the owner's decision 8b; documents first in the same branch) — the hospital now, at a glance (`FR-ADM-12`, new; `CARD-B10-NOW`). **What was missing:** the dashboard reported the day and the range (`FR-ADM-01`–`10`) and said nothing about this minute. **What changed:** `GET /admin/overview` (hospital_admin, the caller's own hospital, counts only): doctors scheduled today and sitting now, patients waiting (the chambers' own count, `fn_chamber_counts`, not a second reading of the queue), today's appointments and how many seen, beds free of those in service with the ward's age (the published capacity), and the emergency desk's cases on the way and in the ER (the domain's own state groups). `beds` and `emergency` are null where the hospital keeps no ward or runs no desk, and the tile says so. The panel (`AdminNow`) sits above the date range and the reports, reads on opening and every minute, carries its own age and the beds' age, and keeps its last figures when a read fails. **No migration, no seed change:** the seed's chambers, wards and cases are what it counts. Focused gate (a read-only screen and one read): typecheck, lint, format whole; the overview, admin, tenant-matrix and i18n suites (4,372); in the browser admin-dashboard (with the new test) and hospital-modules (11).
- **R1 `feat/arrival-windows`** (8 October; the owner's decision 1c; documents first in the same branch) — a preferred hour to arrive (`FR-PAT-28`, new). **What changed:** migration 0060 (`hospital_settings.arrival_windows`, off by default; `bookings.arrival_window_start`; `fn_offers_arrival_windows`). `arrivalWindows` in `shared/domain` (one-hour windows from the chamber's planned start, the last cut at its end, twelve at most). `POST /bookings` takes `arrivalWindowStart` and keeps it only where the hospital offers windows and only if it is one of the chamber's (`ARRIVAL_WINDOW_NOT_OFFERED` otherwise, nothing written); the session list says `offersArrivalWindow`. The confirm step offers যেকোনো সময় (chosen by default) and each hour, with the line that it is a preference and not a set time and that the live serial says when to set off (`CHIP-A07C-WINDOW`); the success screen repeats the choice. The settings rules form has the switch. **Not touched, by design:** the queue, the reducer, the estimate. **Decided here, as small choices:** windows count from the chamber's start rather than the clock hour; the reception console does not show the choice yet. **Demo data:** Padma offers windows; the other five do not. **Supabase needs 0039–0060 before the next release.** Strict gate (booking, a migration): typecheck, lint, format whole; the booking, settings, discovery, no-show, tenant-matrix, domain, i18n and schema suites (4,649); in the browser the new arrival-window spec, guest booking, hospital settings, the account's serials and the no-show spec (27). **The canary failed once in that run** (2,930 ms against 2,000, then a setup timeout) with 1.7 GB of memory free and the whole run three times its usual length; alone on `mvp` it passed in 1.7 minutes and alone on this branch in 1.8 (5 of 5 each), so it was the machine, and this branch touches neither the queue nor the live serial. Written here rather than retried around.
- **R3 `feat/patient-documents`** (8 October; the owner's decision 4; documents first in the same branch) — a patient's own old papers (`FR-PAT-62`). **What was missing:** `patient_documents` existed since 0007 with nothing writing it. **What changed:** migration 0059 (`content_type`, `byte_size`, `uploaded_by_user`; `doc_type` one of prescription, report, discharge, other). `POST /me/documents` (own 12mb limit; Idempotency-Key), `GET /me/documents?patient=`, `DELETE /me/documents/:id` (kept as removed), `GET /patients/:id/documents/:docId/url`. A file is read by its **bytes**, not its name (`sniffDocument`: JPEG, PNG, WebP, PDF, up to 8 MB; `DOCUMENT_NOT_SUPPORTED` otherwise), and a paper cannot be dated after today. The Profile tab has, under each profile, the form and the list (`ProfilePapers`): open by a signed link minted at the tap, remove after asking twice, all four states. `S-A-12` says in one line that papers are kept under a signed-in profile. `GET /patients/:id/records` carries `documents`, each `patient_provided`, **only for the patient and a doctor under consent**; the patient panel lists them as রোগীর দেওয়া কাগজ, and a doctor's opening is an audited read the patient sees in their access log. **Decided here:** uploads are for a signed-in account only, never through a tracking link, so a forwarded SMS cannot add papers to somebody's record. **Found and fixed on the way, older than this branch:** a delivered lab report never opened from the patient's wallet. The store answers with a path under the API (`/files/…`) and the app opened it as its own address, a page that does not exist; the lab spec only checked that the address contained `/files/`. The app now resolves the path against the API (`fileHref`), and the spec fetches the file and checks it is a PDF. **Demo data:** twelve profiles under demo accounts hold one paper each (`documents/demo/`, the store's labelled placeholder; doctors' names invented and marked ডেমো). **Supabase needs 0039–0059 before the next release.** Strict gate (patient records, a migration, uploads): typecheck, lint, format whole; the clinical, documents, prescription, tenant-matrix, consent, lab, patient-auth, i18n and schema suites (4,663, and the seed suite 46); in the browser patient-account (with the paper flow), lab-report, wallet, doctor-console and app-shell (37). The seed first wrote twelve papers under one id (an uncorrelated `LATERAL` is evaluated once); the browser setup's reset caught it and the ids now come from the select list.
- **R2 `feat/prescriptions`** (8 October; the owner's decision 3; documents first in the same branch) — prescribing, written, signed and printed (`FR-DOC-04`, `FR-DOC-05`, `FR-DOC-07`). **What was missing:** prescribing had been dropped on 19 September; the tables and the formulary existed and nothing wrote them. **What changed:** `POST /visits` takes up to twenty medicine rows (name, and optionally strength, schedule in the `1+0+1` notation, days, a Bangla instruction), written in the visit's transaction and final once it is signed; `GET /formulary?q=` (doctor) finds a medicine by the start of its generic or brand name (not `/medicines`, which is the public stock search); every record read carries a visit's `medicines` and the doctor's `doctorBmdc`. The doctor's console has `TBL-B05-RX` with suggestions from the formulary as the doctor types (a name it does not carry is still taken), a wrong schedule or day count said under its field and holding the save, and `BTN-B05-PRINT` for the visit just signed, which reads the signed record back from the server. The patient panel, the records page (`BTN-A12-PRINT`) and the account page show the medicines and print **the same Bangla sheet** (`shared/ui` `PrescriptionSheet`, `shared/i18n` `prescriptionSheet`): hospital, doctor and BMDC number, patient where the screen knows them, date, diagnosis, medicines, advice, follow-up. The browser's print, which also saves a PDF; no PDF library. **Decided here, as small choices:** a schedule is three doses, each 0–9 or ½; the patient's own printout from a tracking link has no patient line, because the device does not keep the name. **Demo data:** the visits whose declared diagnosis is hypertension, a chest infection, diabetes or a headache carry a declared demo prescription from the formulary (`DEMO_ASSESSMENTS`); the rest end with advice, as many real visits do. **Not built:** a QR, dispensing, reminders. **No migration.** Strict gate (patient records, the queue through signing): typecheck, lint, format whole; the clinical, prescription, tenant-matrix, consent, bilingual, i18n, UI and schema suites (4,763, then the four that needed correcting: the panel's `absent` now names reports only, the matrix takes the query as a query, and two of the new tests asserted the wrong status and a token the link route does not take); in the browser doctor-console (with the new prescribing test), wallet (with the new print test), patient-account, patient-account-serials and the canary (25).
- **J `chore/v1-release`** (8 October) — **prepared, not released.** The full gate on `mvp`, once: `pnpm verify` 7,066 of 7,067, `pnpm build`, the browser suite 253 of 254 with the canary, `pnpm test:e2e:built` 3, `pnpm test:e2e:prod` 26. **What it found, both test corrections and neither a product fault:** `consolePoweredBy` (K4) carries the owner's wording, the same in both languages, and the Bangla-script check exempted only the product's name (`fix/powered-by-name`); and the publish-controls spec expected a number on a chamber line which, after the day's chambers end, says that nobody is sitting and no serial is open (`fix/publish-controls-clock`). Both re-run green. **Written:** `DEPLOY.md` §7, the release to the public demo: migrations 0039–0058, which rows four of them change, the reset the new screens need, the order, and the gap — the API now deployed books with `ON CONFLICT (booking_id)` on `guest_links`, whose unique index 0041 drops, so from the migration to the new API every booking on the demo fails; the plan suspends the Render service across it. **Raised:** questions 18 (the demo's database role) and 19 (E1's library). **Not done, by the owner's rule:** `main`, `demo`, Supabase, the deploy.
- **F3 `feat/noshow-prepay`** (8 October) — the second half of `FR-GST-14`. **What was missing:** the requirement said three no-shows on a number may require prepayment, set per hospital; nothing counted them and nothing could be set, and `hospital_settings.prepay_required` (`FR-PAY-02`) had no control on any screen. **What changed:** two settings (migration 0058), both off by default: whether this hospital asks for payment first from a number with three no-shows here, and over how many days (7 to 365, 90 unless it says). Counted at this hospital only (`FR-NET-02`), for a guest booking only, and never on a deployment that takes no payment online. A booking it applies to is paid online and held as H3 holds it, released if not paid; choosing the counter is refused with `details.reason` (`no_shows` or `hospital`), and the patient app says which in plain words, whether or not a code was asked first (it said "booking failed" after a code check before). The administrator sets both, and "online payment first for every serial", on the rules form of `S-B-11` where online payment exists. **Decided here, as small choices:** an account's booking is not asked (the requirement names "the next guest booking"). **No seed change:** both are off by default, as the documents say. **Supabase needs 0039–0058 before the next release.** **`demo` did not move.** Strict gate (bookings, payments, a migration): typecheck, lint, format whole; the payment, booking, standby, settings and schema suites (476); in the browser the new no-show spec, guest booking, phone proof, payment return, hospital settings and the canary (35).
- **H3 `feat/payment-adapters-ready`** (8 October; documents first in `chore/h3-payment-docs`) — paying by bKash or Nagad is built to the credential line (`FR-PAY-08`–`12`, question 15). **What was wrong:** a charge that did not settle on the spot kept nothing of itself, the patient app followed no redirect and had no page to come back to, a serial waiting for its payment had no deadline, a refund sent the provider our own payment id where the provider's reference belonged, and the bKash and Nagad adapters refused everything. **What changed:** an online attempt keeps the provider's id and a deadline (migration 0057: `provider_checkout_id`, `hold_until`, `failure_reason`, `checked_at`; `bookings.prepayment_required`; `hospital_settings.payment_hold_minutes`, 15 by default, on `S-B-11`'s rules where online payment exists); every step of every payment is an append-only `payment_events` row, read by the hospital's administrator (`GET /payments/:id/history`). The success screen shows a **held** serial with its countdown, what happens if it runs out, and the button to pay (`CARD-A07D-HOLD`); bKash or Nagad sends the patient back to `/pay/return` (`S-A-07p`), which asks the server, which asks the provider: **nothing in the return address is believed**, and an amount that is not the fee is not accepted. A second attempt keeps the first's deadline; one after it is refused. When a hold runs out, a timer in the API asks the provider once more, then turns the serial to the counter (`payment.counter` SMS) or, for a booking that had to be paid first, releases it through the queue (`payment.released` in place of the plain cancellation). Money that arrives late or twice is recorded and owed back in full (`paid_after_release`, `duplicate_payment`). The bKash adapter is its tokenized checkout as published (grant and refresh, create, execute, status, refund with both references); the Nagad adapter its published checkout (initialize and complete, RSA-sealed and signed with `node:crypto`, then verify), and Nagad refunds are **recorded by hand** with the panel's reference (`FR-PAY-12`), as cash and the counter always are. `PAYMENT_PROVIDER=mock` with `MOCK_PAYMENT_FLOW=redirect` sends the patient to a simulated page of the API's own, labelled as a simulation in both languages, never mounted in production. `/config` names the methods this deployment takes; card is offered only where a provider takes it, which no live deployment does. **Built and tested against stand-ins only:** neither adapter has met bKash or Nagad; `DEPLOY.md` (*bKash and Nagad*) has the sandbox checklist, ten items, that must pass before a real taka moves. **Not built:** an administrator's refund screen (refunds have been API-only since step 18; the history is API-only too), and a standby prepayment does not follow a redirect yet (a standby place holds no serial, so it has no hold). **Raised:** question 17, whose merchant account takes the money. **No real money can move:** there are no credentials, and `mock` is refused in production. **Supabase needs 0039–0057 before the next release.** **`demo` did not move.** Strict gate: `pnpm verify` whole (7,048), 37 browser tests with the canary, `pnpm test:e2e:prod` (26); details in the plan's H3 row.
- **Patient redesign, Visual Direction 2** (`chore/patient-design-docs`, then `feat/patient-redesign`; owner, 7 October) — the patient app in the design the owner approved, with the official MedLiveBD logo (`FRONTEND.md` §0.5, §1.3b; `APP_FLOW.md` S-A-02, S-A-07s, S-A-07b, S-A-10, S-A-19). Inserted ahead of H3 by the owner's instruction; H3 is untouched and next. **What changed:** the logo's blue, navy and teal for the patient app only (`shared/ui` `patient.css` and `PATIENT_COLOUR`; the consoles load neither and look as before); one header on every screen with the বাংলা | EN switch (the bar above the page is gone); one five-tab navigation (হোম · খুঁজুন · সিরিয়াল · রেকর্ড · আরও); every patient screen redrawn in it: home with the family illustration and three main actions, doctor search with specialties first and a doctors/hospitals switch, the doctor card and chambers, confirm and success, the live serial on the tint with now-serving beside ahead-of-you and the four visit steps, emergency with the problems as an icon grid shown at once, beds, medicines, records, standby, More. **Behaviour unchanged:** every API call, idempotency key, freshness line, honest-degradation rule and test id that survived stays; a session row still goes straight to confirm (the board drew a radio and a button; ten specs, the production canary among them, stand on the one tap). **Moved, not removed:** the quick needs and the specialty grid are on the search screen; specs follow them. **Fixed on the way:** the medicine screen coloured "আছে" with a token that never existed; the bed screen printed an English thana in a Bangla line. **Assets:** the logo is cut from the supplied artwork without altering it (`docs/design/brand`, master at native pixels; the app shows a 12 KB WebP); the family illustration was generated on the owner's Higgsfield free plan (no money) and ships as a 25 KB WebP. **Waiting on the owner:** a transparent master of the logo (the supplied file has a white ground, so the app multiplies it onto the page), and the dark version as its own file. **Not offered, because not built:** help and the hospital link on More, a notification bell, doctor photos, ratings. **No migration, no API change, no demo data change.** Strict gate, with the canary (the live serial screen and every patient screen): `pnpm verify` whole, twice (6,915; the palette's own test file `patient.test.ts` new); the whole browser suite against its own servers, 235 of 246 at first. The eleven were five things, each fixed here: a need chip that did nothing when tapped before hydration (a link now), a test id that collided with the portal spec's `pharmacy-` prefix, the gate's language switch inside its `<main>`, four specs still expecting the old green, one expecting search under the Home tab; and the hospital application's first visit to its form, which took over ten seconds to compile and passed when run again. Then those eight spec files again, 56 of 56, the canary among them; `pnpm test:e2e:prod` (26, the production canary and the CSP check over the patient pages); `pnpm test:e2e:built` (3). `pnpm db:reset` refused to run, rightly: `.env` names the Supabase database behind the public demo, which this work does not touch. **`demo` did not move and nothing was released or deployed,** as the owner asked; `demo` can follow on his word.
- **I3 `feat/patient-rls-queue`** — a person's bookings, payments and messages are their own at the database (`FR-SEC-11`, `FR-GST-05`, `FR-NET-02`; design in `DATABASE.md` §5.4). **What was wrong:** B3 kept the clinical record one person's; everything else (a booking, a payment, a message, a tracking link, a standby place, a profile, the queue's log) was reachable by any patient's connection, a link's and nobody's, and only the application kept them apart. **What changed:** migration 0056: an account reaches its own bookings, profiles, payments, links, standby places and messages and nobody else's; a link reaches its one booking, its profile and what was paid for it; nobody reaches none; none of the three reads the queue's log, state or offers. The queue still sees whole chambers, so when a person asks it to act (book, cancel, say they are late, join or answer a standby offer) or to say where they stand, it does that as the server, once the application has decided the request is theirs: one function, `asQueue`, which for a member of staff changes nothing. What leaves it for a person is I2c's copy that names nobody. The public's counts of a chamber (open serials, the picker's waiting figure) come through one database function, `fn_chamber_counts`, that gives numbers and no rows. Four more places act as the server on a credential just checked: a tracking token's lookup, the claim (its preview already did), filing a bed request, and a signed payment or SMS callback. **What a patient or a hospital sees:** nothing different. **Changed for a caller:** another person's booking, profile or payment asked for by id is 404, not 403, as another hospital's already was; seven assertions say so now. **Small choices:** the queue is elevated rather than rewritten around a database function, because a person's cancel or late moves every other booking's estimate and tells other phones, which no function handing back only counts could do; `guest_identities`, `users`, `device_tokens` and `otp_challenges` are left as they were (sign-in reads them before anybody is known, and the plan did not list them). **Supabase needs 0039–0056 before the next release.** **`demo` did not move.** Strict gate, with the canary (policies, the queue, realtime): `pnpm verify` whole (6,775; `tenancy.test.ts` 8 new, `tenantScope.test.ts` 2 new; the one failure of the first run was the migration list not naming 0056, now it does); in the browser the canary, guest-booking, guest-phone-proof, standby, no-show-recovery, patient-account-serials, patient-account, serial-past-midnight, one-action-once, ward-board, patient-search, publish-controls, console-cold-start, demo-label, hospital-scope, wallet, lab-report, emergency-burn, offline-console, check-in, sms-month and console-undo (125); `pnpm test:e2e:prod` (26). After the last browser test a dev server reported exit code 1 while being stopped, as once in H1; nothing failed by it.
- **`chore/v1-completion-plan`** — the direction written down: `CLAUDE.md` §4.5, the plan's table, and the requirements it adds (`FR-BRD-06`–`11`, `FR-ONB-09`–`10`, `FR-SUP-03`/`04`/`06` into V1). Documents only.
- **I2d `feat/app-csp`** — a page runs only the scripts it was given (`NFR-08`; moved from A7). **What was missing:** both apps sent a Content-Security-Policy that said nothing about scripts, so a piece of text that ever reached a page unescaped could run as code there. **What changed:** every page now carries a fresh nonce and a policy that allows the scripts carrying it, and the ones those load, and nothing else; an injected handler is refused by the browser. **The cost, decided:** every page is now rendered when it is asked for rather than built ahead, since a page built ahead has no nonce. Nothing measured shows a patient waiting longer for it, and nothing was measured either way. **Only scripts:** the API, the socket and hospitals' logos are other origins and are untouched; styles are as they were. In development the policy also allows what React's refresh needs. **Checked against the built apps,** where that allowance is gone: nine patient pages and the console's sign-in open and work with nothing refused. **No migration, no demo data.** **`demo` did not move.** Gate (every browser suite, as the plan says): `pnpm verify` whole (6,765); `pnpm test:e2e:built` (3); `pnpm test:e2e:prod` (26, with the new `csp.prod.spec.ts`); `pnpm test:e2e` 244 of 246 on the first run. **The two that failed were not this branch:** the standby offer passed every step and ran out of time closing the browser, and passes alone (25 s); the lab-to-wallet walk ran past its sixty seconds. That one was bisected and found to fail at I2b's merge as well, on a machine with 2.6 GB of 7.7 free, where it had passed at 51 s half an hour before: a walk across three apps sized at the edge of the limit, and the only such walk in the suite that had not declared two minutes. It now does, with the reason, and both specs pass together (9). Not retried around.
- **I2c `fix/serial-broadcast-ids`** — a patient's phone is sent a queue that names nobody (`FR-NET-02`, `FR-SEC-11`; handover 30). **What was wrong:** every phone following a serial was sent the chamber's queue exactly as reception holds it: every other booking's id and every other patient's record id, the reasons reception typed for a cancellation or a priority ("elderly, breathing difficulty"), and, on reconnecting, the log's raw events. **What changed:** reception and the doctor's screen hear the chamber in a room of their own; phones are sent the patients' copy, the same queue with each booking replaced by a ticket (a keyed hash that means nothing outside that chamber), no patient named, no typed reason, and no events, only the queue as it stands. A phone learns its own ticket with its booking and finds its row and estimate by it; Home's serial strip does the same. **What a patient sees:** nothing different. **Found on the way:** Home's strip found its row by booking id too, and under the new copy would have shown every current serial as past; it reads the ticket. **No migration, no screen, no demo data.** **`demo` did not move.** Strict gate, with the canary (realtime and the live serial screen): `pnpm verify` whole (6,765; `patientView.test.ts` 4 new, three in `realtime.test.ts` over a real socket: a phone that hears a tap holds no booking or patient id from the chamber, as the database lists them, and finds its own row by its ticket; a reconnecting phone is replayed no event; staff are shown the queue as it is); in the browser the canary, guest-booking, serial-past-midnight, patient-account-serials, no-show-recovery, standby, one-action-once and hospital-scope (45); `pnpm test:e2e:prod` (25).
- **I2b `chore/limits-secrets`** — the rate limits and secrets, read through once (`FR-SEC-05`, `FR-GST-14`, `FR-SEC-10`). **What was wrong:** every page a patient reads without an account (the searches, a hospital's page, a doctor's, the medicine search, a tracking link) had its own limit or none, so a script could read the database in a loop as fast as it liked; a bed request could be made without limit, filling a ward's board; and in production nothing stopped the tracking-link key or the second-factor key being the same as a token key, which makes one stolen secret two. **What changed:** one ceiling on everything asked without an account, 1,200 a minute per address across every route; ten bed requests per address in ten minutes, as joining a standby list; and the server refuses to start in production with any two of those four keys alike. **Small choices:** the ceiling is sized for a hospital's waiting room on one Wi-Fi, where every phone is one address and the busiest screen a patient leaves open asks twelve times a minute, so about a hundred phones at once; it does not count a signed-in caller (their own acts are limited) or the webhooks (an aggregator reports every message from one address, and each report is checked for its signature); it is stretched by `ADDRESS_RATE_LIMIT_FACTOR` like every limit on an address. **Read and left as they were:** the logger's list of what it never records, the request log's route patterns (a token in a path is never logged), the other secrets' rules. **Moved out, as I2d:** the apps' script-restricting Content-Security-Policy, which changes how every page is served and needs every browser suite. **No migration, no screen, no demo data.** **`demo` did not move.** Strict gate (limits and secrets: auth's ground): `pnpm verify` whole (6,758; the ceiling, the shared bucket and the bed request limit in `middleware.test.ts` and `bed.routes.test.ts`, the two secret rules in `env.test.ts`); `pnpm test:e2e:prod` (25, with the canary), which runs at factor one from a single address, the hardest case for the ceiling. The first `pnpm verify` stopped at lint on the test harness's own line.
- **I2 `chore/ops-signals`** — the server says how all of it is doing, at one address (`FR-SUP-06`, its last sentence). **What was missing:** a backup that failed was seen only by the backup's own container; a sender that could not send, or a timer that had stopped, only in a log line; the API's readiness said "ready" through all of it. **What changed:** the nightly backup now also writes each run's result into the database (migration 0055), which the API reads; `/readyz` keeps deciding readiness by the database alone, and beside it reports the last backup and the last good one, how many messages are due and unsent and how long the oldest has waited, and when each piece of the server's work on a clock last went through, with what is wrong named in fixed words (`backup_failed`, `backup_stale`, `backup_none`, `messages_overdue`, `worker_late`). `DEPLOY.md` S5 says how to point a free uptime checker at it. **Small choices:** none of it makes the server unready, since a failed backup is no reason to stop a reception desk; backups are "not watched" unless `BACKUP_MAX_AGE_HOURS` is set (the self-hosted stack sets 26 for both containers; the Supabase demo sets nothing, and its backups are Supabase's); the API's role may only read the backup record, so it cannot claim a backup that never happened; the backup's failure sentence is not in the public answer. The console and patient images now start `next` itself, so `docker stop` reaches the server itself (the console checked: 0.8 s, exit 143, the signal's own code, where the API under `pnpm` showed 137, the kill) (I1's note). **Not done, and not mine to do:** sending an alert needs an account somebody owns. **Checked by hand:** the backup script's new step against the database, with a failure sentence made of quotes and a statement (stored as text), and with the database unreachable (a warning, and the run goes on). **Demo data:** none; no screen. **Supabase needs 0039–0055 before the next release.** **`demo` did not move.** Strict gate (a migration, the API role, the workers beside the queue): `pnpm verify` whole (6,751; `deployment.test.ts` 10 and `readiness.routes.test.ts` 6 new, two in `tenancy.test.ts`, one in `apiRole.test.ts`); the first run failed on the schema's own rules (a table without a uuid key and the two timestamps), which the table now follows; `pnpm test:e2e:prod` with the canary and the counter (25), applying 0055 as it went; the console image built and stopped by hand.
- **I1 `chore/api-build`** — the API runs compiled, from an image with nothing in it the API does not run with (handover 21; `FR-SEC-07`). **What was wrong:** the self-hosted API ran its TypeScript through `tsx` at every start, from an image built on the whole workspace: the compiler, the test runner, the linter, the browser driver and both web apps' framework, 1.48 GB, on a hospital's server. **What changed:** `pnpm build:api` compiles the API and the two shared packages it reads; under the `compiled` export condition the running server reads their compiled output and never their source; the `api` image is built in a separate stage and keeps only the output and production dependencies, 809 MB. `pnpm test:e2e:prod` (CI's production job) now starts the API exactly as the image does. **Small choices:** what runs once and exits (`db:migrate`, `db:role`, `staff:create`) still runs from source through `tsx`, which is why `tsx` is now a runtime dependency of `database` as it already was of the API; the commands keep one name on a laptop and on a server. The Render demo keeps `tsx` (`DEPLOY.md` §6 says how to move it). **Checked by hand:** the image built; its migrate-and-role step applied all 52 migrations to an empty database and made the API's role; its server came up `healthy` as that role at schema 0054 with no error logged; `staff:create` ran inside it; none of `typescript`, `vitest`, `next` or Playwright is in it. **Found on the way, older than this branch, and fixed:** the server's graceful shutdown (`server.ts`: finish the tap in flight, tell every screen to reconnect, close the database) never ran in a container. `pnpm` was the first process, took `docker stop`'s signal and went, and the server was killed behind it: 1.5 seconds, exit 137, no "shutting down". The image now starts `node` itself; `docker stop` logs "shutting down" and "shutdown complete" and exits 0. **And a flaky test, found by the first gate:** six API test files signed as "the first platform administrator by name", and `platform.routes.test.ts` briefly makes a second one; a file that started inside that window signed as it, and the agreement test failed once in the whole suite and passed alone. They now take the seed's own (`seededPlatformAdminId`, by staff code). The same first run had one `ECONNRESET` opening a connection in that file's clean-up; Postgres logged nothing, it did not recur, and it is written here rather than retried around. **Left:** images are still built on the hospital's server (the handover's last clause); shipping built images needs a registry, an account outside the repository. The console and patient images still start under `pnpm`, so `docker stop` kills Next rather than closing it; they hold no write in flight, and it is I2's to tidy. **No migration, no demo data, no screen.** **`demo` did not move** (nothing a visitor sees changed). Strict gate (the image, a migration step, the queue's process): `pnpm verify` whole, twice (6,732; the first run is the flake above); `pnpm test:e2e:prod`, which builds and starts the compiled API, with the canary and the counter (25); the image by hand as above, after the PID-1 fix as well.
- **H2 `feat/sms-adapter-ready`** — an SMS aggregator can be switched on by settings, and its delivery reports are taken (`FR-NOT-06`). **What was missing:** the only provider that worked was the demonstration's, which sends nothing; the one setting meant for a real provider refused every message; nothing received a delivery report; and a hospital had a cap on its SMS and no way to see what had become of them. **What changed:** there is an adapter for an aggregator reached over HTTPS, which tells the sender from H1 whether a refusal is worth asking again; an address the aggregator reports delivery to, which believes only a correctly signed report and marks the one message it names delivered or failed, once; and on the hospital's settings, under the cap, **এই মাসের এসএমএস**: sent (against the cap where one is set), reached the phone, failed, held back, still waiting. **Honest about what it is:** no aggregator is chosen, so no company's API is implemented. What is built is everything that does not depend on which one it is, tested against a stand-in aggregator inside the test run. `DEPLOY.md` (*An SMS aggregator*) says what a real one must give, what this server sends and accepts, and that a real one will differ in its field names, which is then one file. **Small choices:** a message reported undelivered is failed and not sent again (a second SMS is a second charge for the same answer); a report is taken only for a message that is in the sent state, so a late or repeated one changes nothing; with the demonstration's provider "reached the phone" reads as a sentence, not as nought. **Activation waits on you (X1):** an aggregator account, its key, a registered sender ID. **Demo data:** none added; the screen shows the seed's week of confirmations. **Supabase needs 0039–0054 before the next release.** **`demo` did not move.** Strict gate (an address nobody signs in to, a migration, a new provider): `pnpm verify` whole (6,732; `smsDelivery.test.ts` 20 new, the two routes named in the tenant matrix and the module map); in the browser sms-month (new), hospital-settings, guest-booking, security-headers and the canary (32). The dev server's exit line did not appear in this run.
- **H1b `feat/queue-timers`** — an offer for a freed chair lapses on the clock (`FR-QUE-30`; handover 15). **What was wrong:** an offer is good for ten minutes, and when they were up it could no longer be taken, but it was only *recorded* as lapsed when somebody next opened that chamber's standby list. Until then reception's card went on showing the chair as on offer, and a chamber nobody was looking at kept a dead offer all evening. **What changed:** a timer in the server looks every thirty seconds and records the lapse, so reception's screen shows the chair as theirs to offer again within half a minute, without anybody refreshing anything. **Deliberately not changed, and asked (question 14):** what happens to the chair next. Today a *declined* offer goes to the next person on the list by itself, and a *lapsed* one comes back to reception, who press offer again. That was built and tested on purpose, so the timer keeps it. **Not built, and asked (question 13):** the leave-home alert as a message. The banner on the live serial screen is there and unchanged. **No migration, no demo data.** **`demo` did not move.** Strict gate, with the canary (a new writer to the queue's log): `pnpm verify` whole (6,686; `standby.routes.test.ts` 2 new); in the browser the canary, standby and no-show-recovery (10). **The canary failed once during this branch, outside its gate, and that is written down under *Things learned the hard way*:** 2,292 ms against 2,000, on the first run straight after the working tree was switched between two commits to compare them. It passed in the gate before and in six runs after.
- **H1 `feat/notification-worker`** — messages are sent by a sender that retries, not inside the request that caused them (`FR-NOT-06`, `FR-NOT-07`, `FR-GST-05`; handover 14). **What was wrong:** a receptionist's *next* waited for the SMS gateway before it answered; a gateway that refused once was never asked again, so one bad minute lost every message of that minute for good; and a report uploaded at night was recorded as held back and never sent in the morning. **What changed:** a request writes its messages and answers; a sender in the same process sends them. A failure is tried again after a quarter of a minute, then one minute, five, fifteen, and after the fifth the message is marked failed with what the gateway said, where the platform's health view (G2) counts it. A message held for quiet hours is sent at seven in the morning in Dhaka. Two processes never send the same message, and one a restart left unsent is sent by the next process. **The hard part, and how it was settled:** a link in a message is a credential and is never stored, so a message sent after a restart, or in the morning, has no link to send. The row now keeps what its link was *for* (never the link), and a fresh one is issued at that moment by the same code that issued the first: a new tracking link for a booking, a newly signed token for a standby place, a bed request or an emergency alert, the Records page for a report. Where none can be issued the message is failed and said to be; it is never sent with a hole where the link was. **Small choices:** five tries over about twenty minutes and no more, because a queue message an hour late is a wrong one; a message can be sent twice if the server dies in the instant between the gateway taking it and the row being marked, which is the cheaper mistake than never; a held message is counted against the monthly cap in the month it is sent; a push re-sent after a restart reaches an account's devices and not a guest's, and the SMS beside it goes. **Split from this branch:** the plan's H1 also listed timers for lapsing slot offers and the leave-home alert. They are queue behaviour, not sending, and are H1b, next. **For tests:** seven older tests read a message before it had gone and now wait for the sender (`notifications.settled()`); after every API test whatever it left queued is closed, or the next test's sender would send it. **No demo data needed:** the demonstration's messages go through the same sender to the log provider. **Supabase needs 0039–0053 before the next release.** **`demo` did not move:** it stays at F2c's merge, the last commit with a whole browser run behind it. Strict gate, with the canary (what every queue action hands over, a migration, a function that reads across the tenant line): `pnpm verify` whole (6,684; `sending.test.ts` 11, `notificationSender.test.ts` 11, `lab.routes.test.ts` 1 new); in the browser the canary, guest-booking, standby, no-show-recovery, lab-report, emergency-burn, offline-console, patient-account-serials and platform-health (60), which are the five required specs and every one that reads a message after an action. **Seen once and not again:** at the very end of that run, after the sixtieth test had passed and while the dev servers were being stopped, one of them reported exit code 1. Three further runs, two on this branch and one on `mvp`, did not show it. Nothing failed by it; if it comes back, it is the API's shutdown with a send in flight that is worth reading first.
- **G2 `feat/platform-health`** — the platform sees how each hospital is doing and what was done to it (`FR-SUP-06`, `FR-ONB-07`). **What was missing:** nothing told the platform which hospital was showing patients old figures, whose messages were failing, or whose counters kept losing their connection; and every act was audited with no screen to read the audit on. **What changed:** an opened workspace has a **health** block: each figure it publishes (beds, emergency services) with its age and whether a patient's screen is showing it as stale; the last seven days' messages by what became of them and the share that went; and the work that reached the server late, how much and how late. And a **trail of changes**, asked for with a button: the last fifty things done to the hospital's settings, state, imports and exports, each with when, who, and whether they were the hospital's or the platform's. In the list, a hospital with a failed message carries a chip, and every hospital showing a stale figure says which and how old on its row. **Decided here, after seeing it on the screen:** a stale figure is *ranked*, not flagged. The first version flagged it, and every one of the six hospitals carried the flag: by the ten-minute rule a patient's screen uses, most hospitals are stale most of the time, and a flag on every row says nothing. So the chip is kept for what is wrong beyond argument (a message that failed or is stuck; a published figure nobody ever confirmed), and staleness is an age on each row, to read one hospital against another. Late sync is shown and never flagged: a counter that kept working offline did its job. **Small choices:** the windows are seven days; an action is late past a minute, a message stuck past five; the delay is by the counter's own clock, capped at the week, and the screen says so; the trail is the organisation's only, kept clear of anything about a patient twice over (by the kind of row and by the row naming no patient). **Not built, and said:** the age of the last backup. It is the deployment's, not one hospital's, and the API cannot see the backup's status file; it goes with the health endpoints (plan I2). **Found while building:** `sync_cursors.last_sync_at` exists and nothing has ever written it, so sync lag is taken from the queue's own log instead; the table is unused. **Demo data:** Karnaphuli, two hundred kilometres from the rest, is the one with a poor line: a stretch of late work on its recent evening and one in four of its confirmations failed; every hospital has the last week's confirmations and the trail of how it was brought on. **Supabase needs 0039–0052 before the next release.** **`demo` did not move:** it stays at F2c's merge, the last commit with a whole browser run behind it. Strict gate (a migration, a function that reads across the tenant line, a new route's permissions, the seed every suite stands on): `pnpm verify` whole (6,660; `health.test.ts` 16, `platformHealth.routes.test.ts` 16, `tenancy.test.ts` 2 new). The first whole run failed four of the new tests and was right to: they said the ordinary hospital had no failed message and no late work, which is true of the seed and not of a database other suites are sending and syncing in; they now check each figure against the table's own count on either side of the read. In the browser platform-health (new), platform-agreement, platform-onboarding, hospital-modules, admin-dashboard, and the canary because the seed's queue history changed (26).
- **G1 `feat/platform-entitlements`** — the platform records where a hospital's agreement stands and reads what it has used (`FR-SUP-04`, the state half; `FR-SUP-03` was already there from C4). **What was missing:** the platform's screen could switch a hospital's modules and nothing else about its agreement: nowhere said whether a hospital was on trial, active, overdue or finished, and nothing showed how much it used the platform. **What changed:** on a workspace (`S-B-12`), above the modules, a platform administrator picks one of four states, **পরীক্ষামূলক / সক্রিয় / বকেয়া / শেষ হয়েছে**, with an optional note for whoever reads it next; it is saved with who set it and when, and audited. Under it, three counts with their age: serials taken and chambers held in the last thirty days, and SMS sent this month. In the list, a hospital whose agreement is overdue or ended carries a chip saying so. **Decided here, and the owner may rule otherwise (question 12):** the state is a record and switches nothing. An agreement marked ended does not unlist a hospital or switch a module off; taking a hospital out of the network stays suspending it, with a reason the hospital reads. An overdue invoice that silently hid a hospital's doctors from patients would be the product deciding something nobody decided. **Small choices:** a state saved without a note clears the last note; the hospital's own staff are not shown the state (the plan puts it on `S-B-12` only); the counts are made by a database function that answers the platform and the server and nobody else, because a platform administrator's connection reads no booking and no message (`FR-ONB-08`), and how busy a hospital is, is not a figure it publishes. **No plan name, no amount, no invoice** has a field anywhere; a body that sends one is refused. **Demo data:** four hospitals active, Meghna still on trial, Buriganga overdue with a note marked as demo. **Supabase needs 0039–0051 before the next release.** **`demo` did not move:** it stays at F2c's merge, the last commit with a whole browser run behind it. Strict gate (a migration, a function that reads across the tenant line, a new route's permissions): `pnpm verify` whole (6,546; `platformAgreement.routes.test.ts` 15 new, `tenancy.test.ts` 2 new, the route named in the tenant matrix and the module map); in the browser platform-agreement (new), hospital-modules, platform-onboarding, hospital-application and portal-address (20). No canary: the queue, the live serial and realtime are not touched.
- **F2c `feat/eta-earlier-notice`** — a patient is told before their turn comes sooner than they were told (`FR-QUE-15`). **What was wrong:** the estimate could move earlier and nobody was told. The domain has always been able to say "this is earlier than before", and nothing ever gave it a before: no record existed of what time a patient had been given. Somebody told "around 6:30" whose turn came at 5:50, because three people ahead cancelled, found out by missing it. **What changed:** each booking keeps the time it was last told (migration 0050): the one in "the doctor has arrived, expected around …", in "running late, now around …", or in the new message; before any of those, it is the chamber's planned start, which is the time in the confirmation. On every queue action, a waiting patient whose estimate is now earlier than that by more than the estimate's own band is sent **"সিরিয়াল … আগে আসতে পারে, এখন আনুমানিক …। সময়মতো আসুন।"** by SMS (and push, with the app), in the same write that moved the estimate, so no screen shows the earlier time before the message exists. What they were told then becomes the new time, so one move is told once. **Decided here, as small choices:** the "booked window" of the requirement is that one time and the band around the estimate, so an estimate drifting inside its band wakes nobody; a patient reception has checked in is not messaged, they are in the corridor; nothing is sent while the chamber cannot support a time at all (the doctor not arrived, or paused), because then no screen shows one; the message fits one SMS segment in Bangla. **Demo data:** the shipped template is installed by the seed. **Supabase needs 0039–0050 before the next release.** **`demo` moves to this merge**: the first commit since D2 with a whole browser run behind it. Strict gate, with the canary (the queue engine and what a patient is sent): `pnpm verify` whole (6,487; `eta.test.ts` 5 new, `notifications.test.ts` 4 new); every browser suite once, 233 of 235 with the canary's five among them, and the two that failed re-run alone three times each, 21 of 21 (below, *Things learned the hard way*: both failed while a second job was running on the same machine, and neither is in this branch's code); and the production-configuration suite (25).
- **F2b `fix/queue-timing`** — a doctor's arrival recorded offline is timed and measured honestly (`FR-REC-02`; handover 27). **What was wrong, once read:** less than the handover said, and something it did not say. Online the server already stamps the arrival and the lateness itself, and the punctuality an administrator sees is taken from the recorded start, so the console's "0 minutes late" changed no figure. But an arrival queued offline wrote that zero into the event log, which is never edited, and took its time from the console's clock with no bound at all: a console whose clock was a day wrong recorded a doctor arriving tomorrow. **What changed:** at the sync, the console's time is kept when it can be true (not after now, not older than the longest a device may be offline) and is otherwise the moment the server heard; the lateness is worked out by the server from it, as the online route does; the console draws the same sum before the answer comes. **Not changed, and the owner's to decide (question 11):** a patient checked in, called or finished while the counter was offline is still timed at the sync. The documents say that deliberately (`SY-01`: a console's clock orders a batch and nothing more); the handover calls it a defect, because the waits worked out from those times are wrong for the offline stretch. **Split again:** `FR-QUE-15` is its own branch, F2c, next: it needs what each patient was last told to be kept, which nothing keeps today. **No migration.** **`demo` did not move.** Strict gate, with the canary (the sync path and the reception console): `pnpm verify` whole (6,478; `sync.routes.test.ts` 3 new, each failing on the code before), and in the browser the canary, offline-console, console-undo and pause-resume (21).
- **F2 `feat/report-ready`** — a patient is told their report is ready (`FR-NOT-02`, `FR-NOT-03`, `FR-GST-06`, `FR-LAB-03`). **What was wrong:** a report reached the wallet and nobody was told: the notice was a push only, no screen asks for notification permission, so every one was recorded as skipped. **What changed:** uploading a report sends an SMS to the patient's number, in their language, naming the test and the hospital and linking the Records page; a phone that has the app's token gets the push as well. It never says what the report says, and the link holds no token. It counts against the hospital's monthly SMS cap, and the same upload sent twice tells nobody twice. **Decided here:** a report is not urgent, so it is held back in quiet hours (22:00 to 07:00 in Dhaka) and recorded as held back, as `FR-NOT-07` says. **Left, and it matters:** nothing sends a held-back message in the morning yet. That is the notification worker (plan H1); until it exists a report uploaded at night is in the wallet and announced to nobody. **Split from this branch:** the plan's F2 also listed three queue-timing items (an estimate never moving earlier without notice, `FR-QUE-15`; an offline tap keeping its own time; the doctor-arrived button recording lateness). They change the queue engine and take the canary, so they are their own branch, F2b `fix/queue-timing`, next. **Demo data:** the shipped templates are what the seed installs, so `pnpm db:reset` carries the new one; the public demo gets it at the next release. **No migration.** **`demo` did not move.** Strict gate (what a patient is sent): `pnpm verify` whole (6,475; the lab, notification and template tests among them), and in the browser lab-report and wallet (15).
- **F1 `feat/patient-bookings-account`** — a signed-in patient books as themselves, and their serials are the account's on any phone (`FR-PAT-03`, `FR-GST-10`, `FR-PAT-39`). **What was wrong:** an account existed (step 25) and changed nothing about booking: a signed-in patient still typed a name, a number and an age and proved the number again, and My serials and Home's strip were whatever one phone remembered, under a line that promised an account would show them on every device. **What changed:** signed in, the confirm step asks only which of the account's profiles the serial is for, and nothing is typed or proved again; somebody who is not one of the profiles is still booked for on the guest sheet. My serials and Home's strip come from the server (`GET /me/bookings`): every profile the account owns, booked on any phone, as a guest and since claimed, or at a counter, with where each stands decided by the chamber's state and never by the date. Opening a serial on a phone that never booked it works: the live screen asks for a link to that booking (`POST /me/bookings/:id/link`), which the server gives for the account's own bookings and nobody else's, and the phone keeps it. Signing out forgets those links. Not signed in, or with the server out of reach, everything is as it was: this phone's own list, saying so. **Decided here, as small choices:** an account holder's booking is given a tracking link, like a guest's, and the confirmation message carries it, so the live serial screen and its socket (the canary's screen) are not touched and a relative without the app can follow; the list is by the profile and not by who made the booking; it reaches thirty days back, as the phone's own list does. **Not built, and said:** adding a profile by hand (`FR-PAT-02`) and a profile screen of its own (`S-A-06`): an account whose number holds nothing yet books on the guest sheet, and the booking becomes its own when it claims it; standby and a bed request still ask a signed-in patient for their details. **Demo data:** none added; the seed's hundred accounts and their profiles and histories are what the list shows. **No migration.** **`demo` did not move:** it stays at D2's merge, the last commit with a whole browser run behind it. Strict gate, with the canary (a booking's answer, two new routes, the page the live serial opens from): `pnpm verify` whole (6,473, `myBookings.routes.test.ts` 11 new); in the browser patient-account-serials (new: three phones sharing one number), patient-account, guest-booking, serial-past-midnight, app-shell, hospital-scope, standby and the canary (53 in all); and the production-configuration suite (25).
- **D2 `feat/setup-complete`** — a hospital puts right what it entered wrong, and its checklist names the rest (`FR-SUP-01`, `FR-ADM-11`, `FR-ONB-03`). **The audit the plan asked for, of what the settings screen could not set:** nearly everything a patient or a counter reads was already settable (profile, phones, address, map position, what patients see, queue rules, departments, doctors, fees, chambers, wards, beds, emergency services, staff). What was missing was the way back: the screen could add and could not correct or take away, and a hospital that applies by itself (D1) arrives with whatever it typed on the form. **What changed:** a department's names are edited in place, and a department nobody sits in is removed (its code, which cannot be edited, is then free for the one that was meant); a ward's names and floor are edited and an empty ward removed; a bed's number and nightly charge are edited, and a bed the ward never brought into service is removed; the division, district and registration number are the hospital's to correct while its workspace is setting up, and are shown read-only once review has been asked for, since they are what the platform reviews (a workspace sent back can correct them again). Every removal is asked twice on the screen and refused by the server while anything stands on what is removed: a department with a doctor listed, a ward with a bed, a bed with any history. Nothing with a history is deleted; a bed that has been in service is still retired from the ward board. **The checklist names three more things**, on the hospital's screen and the platform's: an address and a phone number, a place on the map, and the emergency services declared (only where there is an emergency desk). They read "worth adding", not "missing", and review does not wait for them: `FR-ONB-03` lists what it waits for and I did not add to that list. **Decided here, as small choices:** removal marks the row and keeps it; what kind a ward is, and a department's code, do not change; a save that includes a registration detail after review is refused whole. **Audited and not built, each with its reason:** counters (question 10); the refund policy and prepayment (the agreed default until online payment, plans H3 and F3); `numeral_style` and `density_default` on `hospital_settings`, which nothing reads; changing a doctor's department or specialties, or a chamber's hours, in place; correcting the registration details of a hospital that is already live, which nobody can do from a screen yet. **Demo data:** none needed; every demo hospital has its address, phone, position and emergency services, so the platform's panel shows the new lines as present. **No migration.** **Found by the gate, from before this branch and nothing to do with it:** the whole browser run made on `mvp` after D1 was 233 of 234. The first emergency test timed out, and its trace shows why: `next dev` took 26 seconds to answer the first request for the emergency results page, while the console's dev server was compiling the ER console at the same moment, against the 20 seconds that spec allowed a first screen where others allow 45. Every later test on the page passed. Not rerun past: that first load now has the cold-start allowance the other specs have (`e2e/emergency-burn.spec.ts`), and no product budget moved. **`demo` moved** to this merge: the first whole green run since C5, with D1 in it. Full gate, at this integration point: `pnpm verify` (6,454), `pnpm build`, the whole dev browser suite (234, the canary among them, hospital-settings extended for this branch), the built suite (3) and the production-configuration suite (25).
- **D1 `feat/org-signup`** — a hospital applies by itself (`FR-ONB-09`, `FR-ONB-10`). **What was missing:** a workspace was made by a platform administrator and nobody else, so a hospital that wanted to join had to find somebody to ask. **What changed:** the console has a public form (`S-B-00a`, `/?apply=1`), linked from sign-in and from the foot of the demonstration's picker: the facility's name in both languages, kind, division, district, phone and registration number, and its first administrator's name, email, mobile and a password of their own. It makes a workspace that is setting up and that one administrator, and nothing public; the form says so before anything is typed and again on the answer, with the four steps that follow. The applicant signs in with their own password, sets up two-step verification before any console opens, and is on the settings screen like every new hospital. On the platform's screen the workspace carries "applied by itself" in the list, and opened it shows the phone and registration number the facility gave and the administrator's mobile, for whoever rings it before approving. **Decided here, as small choices:** the form asks for no hospital code; one is made from the English name (`Teesta General Hospital` → `TEESTA`, then `-2`); an address may send five an hour, and the deployment holds 200 applications nobody has acted on (`ORG_APPLICATIONS_OPEN_MAX`), at which the form says it is paused; the same form sent twice makes one workspace; on a demonstration the form works and says not to put real details or a real password in it. **Added because the form needed it, and written into `FR-ONB-02`:** the platform can close a workspace that never went live, from setting up or from waiting for review, with a reason. Before, a workspace that was setting up could not be dismissed by anybody, so a junk application would have stayed in the list for ever and 200 of them would have shut the form for good. **Found by the gate, and corrected in this branch, not in the test:** the platform's list is held to carrying no phone at all (`FR-ONB-08`), and the facility's phone had been added to every row of it; it is now read only when a workspace is opened. **Demo data:** none added. The demonstration stays six facilities (`FR-DEM-01`); what this adds to it is a form that works, and whatever is applied for there is seen on the platform's screen under the demonstration's banner. **Not done, and said:** nothing switches the form off on a server that holds one hospital only; an applicant's email is not verified (there is no mail provider; the platform rings the number); a declined application keeps its code (question 9). **Supabase needs 0039–0049 before the next release.** **Found by this gate, from C6 and nothing to do with this branch:** `portalScope.routes.test.ts` took the first seeded patient seen at two hospitals and then needed a hospital that had never seen them. The seeded history is laid out from the clock, about a third of such patients have a visit or a booking at all six hospitals, and at some hours the first one is one of those: it passed at C6's merge and in this branch's first whole run, and failed twenty-five minutes later on a fresh seed. Not rerun past: the test now asks for a patient who has such a hospital, and what it asserts is unchanged. Strict gate (a migration, a public route that writes, sign-in): `pnpm verify` whole (6,364); in the browser hospital-application (3 new), platform-onboarding, hospital-settings, staff-login, staff-2fa, console-cold-start, demo-label and the canary (29 in all); and the production-configuration suite (25).
- **C6 `fix/portal-scope-rules`** — what a hospital's own portal is, and is not (`FR-BRD-09`, `FR-BRD-10`, as the owner decided on 6 October). **What was missing:** the two rules were decided and nothing said them or held them: the emergency results inside a portal listed other hospitals with no word of why; the medicine search inside a portal named every pharmacy in the network, the one page besides emergency that was not the hospital's own; and a portal offered a bed search for a clinic with no ward. **What changed:** inside a portal the emergency results carry one line under the call to 999, naming the hospital and saying that every participating hospital is shown and why; the medicine search asks about that hospital's pharmacy only and says whose it is; the portal's first screen leaves out the bed search where the hospital runs no ward and the medicine search where it keeps no shelf or does not share it, and always keeps the emergency card and the patient's records. Records needed no change: the wallet was already the patient's own wherever a visit was made, and no check of who may read a record reads a portal's scope or address. **Tests are the point of this branch:** `portalScope.routes.test.ts` (12) sends what a portal sends and holds that the emergency search is the same list in the same order, that a scope naming nobody does not turn an emergency away, that a patient reads both hospitals' visits inside one hospital's portal, that the portal's own staff read their own hospital's and no other's, and that a hospital the patient was never at reads nothing; in the browser, three more in hospital-scope and one in wallet. **No migration.** Focused gate with the strict parts it touches (a public read's shape, `/config`): `pnpm verify` whole; in the browser hospital-scope, wallet, emergency-burn, lab-report, app-shell, portal-address, portal-install, demo-label, self-host and the canary; and the production-configuration suite.
- **C5 `feat/publish-controls`** — a hospital decides which live figures the network is given (`FR-NET-04`). **What was missing:** a hospital in the network published every figure it had, with no say. **What changed:** on the settings screen, under the colours, an administrator has a switch for each of three figures: open serials and who is sitting; free beds and ICU; which medicines the pharmacy has. A figure switched off leaves every public answer, and the answer says it is kept, so the patient app puts a neutral "not shared" chip where the number would have been: on the hospital's card in the list and in search, on each of its doctors, on its chambers, on the bed search and on the emergency card. Never a zero, never "none", and no "updated … ago" under a figure that is not there. The hospital itself stays everywhere it was: listed, its doctors and when they sit shown, its chambers bookable (a full one still says full, so nobody is sent into a refusal), a bed request still taken. A pharmacy that keeps its shelf is simply not named by the medicine search. **Decided here, as small choices:** stored as what is kept, so everybody starts sharing everything; "not shared" is said only for a figure the hospital has (a clinic with no ward is not said to withhold beds); a hospital that keeps a figure is ordered as one with none of it, not pushed below; the serial a patient is about to be given, and the wait, are still told at the booking step. **Not the hospital's to keep, and the owner's to rule on (question 8 below):** what its emergency department can treat. **Fixed on the way:** a hospital's doctor list still showed chambers when its serials module was off (left by C4). **Demo data:** Buriganga, a clinic, keeps its serial figures; its card says so and its settings show the switch off. **Found by this gate, from C2 and nothing to do with this branch:** two browser specs (`demo-label`, `self-host`) held the app's question to the server back by its address, and since C2 the app adds which address it is at (`/config?host=`), so the real answer got through and three tests failed. They were not in C2's focused run. The two patterns now match the question whatever it carries; nothing in the app changed. **`demo` moved** to this merge: the first whole browser run since B1. **Supabase needs 0039–0048 before the next release.** Strict gate (a migration, a new settings route, what every public read answers): `pnpm verify` whole (6,231); the whole dev browser suite (227: 224 at once, and the three above after their correction), publish-controls (2 new) among them and the canary; and the production-configuration suite (25).
- **C4 `feat/hospital-modules`** — a hospital runs the modules switched on for it (`FR-BRD-11`, `FR-SUP-03`). **What was missing:** every hospital had every module: a diagnostic centre was offered a ward board, and nothing could be switched. **What changed:** eight modules (serials and reception, doctor's console, beds, emergency, lab, pharmacy, dashboard, data import), switched by the platform on the hospital's workspace. A module that is off is refused to the hospital's own staff on every one of its routes, by one gate no route can forget; it is gone from what the hospital publishes (no bed figure, out of the emergency and medicine searches, no chamber to book) and what the public would write to it is refused (a booking, a bed request, an alert that somebody is coming); and the consoles are told, so the picker offers no console of it, settings has no tab of it, and settings says in a line which are off and to ask the platform. Nothing the hospital holds is deleted: switched back on, everything is where it was. **Decided here, as small choices:** stored as what is off, so everybody starts with everything; the doctor's console is never on where serials are off, and the switches show that as it is chosen; settings, signing in and the platform's screens are nobody's module; a switch made through another API instance is honoured within thirty seconds. **Demo data:** Meghna (a diagnostic centre) has its pharmacy off and Buriganga (a clinic) its beds; neither held any. Meghna keeps beds on though it has none, because a card that says none and a card that says not shared are different statements and the bed tests stand on the first. **Not here:** what a module costs or which an agreement includes (never in the repository); the state of an agreement and usage counters are G1. **Supabase needs 0039–0047 before the next release.** Strict gate (a gate on every staff request, a migration, what is published): `pnpm verify` whole; in the browser hospital-modules (4 new), platform-onboarding, hospital-settings, console-cold-start, patient-search, emergency-burn, guest-booking, ward-board, lab-report and the canary; and the production-configuration suite.
- **C3 `feat/portal-install`** — a hospital's portal installs as that hospital's app (`FR-BRD-08`). **What was missing:** added to a phone's home screen, every portal was "MedLiveBD" with the platform's icon, because the install description was one file. **What changed:** that description is now made for each request from whose portal it is asked at, by address or by `?scope=`: the hospital's name, a short name that fits under an icon, its own words, its colour, and its logo as the icon; the page's title and what an iPhone takes for the name and the icon are the hospital's as well. **Decided here:** a logo is used as the icon only when it is a square PNG of at least 192 pixels, declared at the size it really is; any other logo installs under the platform's icon with the hospital's name, and the settings screen now says what the icon needs. It never fails: a code nobody has, or an API that does not answer, installs as the network's app. **Demo data:** Padma's drawn mark is 512 pixels, so its portal installs with it. **Not this:** an app in a store, which needs store accounts (blocked externally). Focused gate: typecheck, lint, format, the brand and message tests, the hospital-face API test, a production build of the patient app, and in the browser portal-install (8 new), portal-address, hospital-profile, hospital-scope and app-shell.
- **C2 `feat/portal-address`** — a hospital's portal has an address (`FR-BRD-07`, `FR-BRD-04`). **What was missing:** a hospital's own patient app could only be opened with `?scope=CODE` on the network's address, and anybody could take it out of scope from the address bar. **What changed:** with the platform's domain set (`PLATFORM_DOMAIN`, and the same value when the patient app is built), `<code>.<that domain>` is that hospital's portal with nothing in the address; a platform administrator can record a domain the hospital itself owns, on the hospital's workspace, and the deployment answers for it from the next request; at a portal the address decides, so `?scope=` there neither changes whose it is nor leaves it; a name nobody has recorded shows nothing of anybody's, says it is not a hospital's portal and points at the main app; a hospital reads its portal's addresses on its settings screen. The API answers a browser at the network's addresses and at portals', and nowhere else, except the one public question of whose address this is. A booking made inside a portal is followed in that portal: the link in its message is the portal's. **Decided here, as small choices:** recording a domain is the platform's act, not the hospital's, because the whole deployment answers for it; a link with no patient's browser behind it goes to the hospital's own domain if it has one, else to the network. **Not changed for the demonstration:** with no `PLATFORM_DOMAIN`, which is how the public demo runs, everything answers as before. **Outside the product, and needed before a real portal address works:** wildcard DNS and a certificate for the platform's domain, and the hospital pointing its own domain (already in the blocked-externally list). **Left:** standby, bed-request and emergency links issued from a console go to the network even for a hospital with its own domain. **Supabase needs 0039–0046 before the next release.** Strict gate (origins, the socket handshake, a migration): `pnpm verify` whole; in the browser portal-address (7 new), hospital-profile, hospital-scope, patient-search, app-shell, guest-booking, platform-onboarding, hospital-settings and the canary; and the production-configuration suite.
- **C1 `feat/hospital-profile`** — a hospital's public face is its own to set (`FR-BRD-06`). **What was missing:** a hospital's colours were seed data only, and it had no way to say anything of itself or show a logo. **What changed:** on the settings screen, between the profile and the queue rules, an administrator writes a short description in both languages, uploads a logo (PNG, JPEG or WebP, up to 256 KB; refused on the screen with why if it is anything else) and picks one colour; the screen makes the six brand tokens from that one colour, darkens a colour that cannot carry white text only as far as it must and says so, and previews the result with the app's own components. The server checks the colours and the image again whatever the screen sent. In the patient app the hospital's card, its page and its own portal's header carry the logo (the plain hospital icon where there is none, never a broken image), its page carries its words, and its portal is in its colour. **Decided here, as small choices:** the logo is kept as a row in the database and not in the file store, because it is public and small and the demonstration's store is this process's memory; the screen asks for one colour, not six. **Demo data:** each demo hospital says what it is, in words that say they are demonstration data; Padma has a drawn mark in its own navy. **Supabase needs 0039–0045 before the next release.** Strict gate (a migration and a new public route): `pnpm verify` whole, and in the browser hospital-profile (3 new), hospital-settings, hospital-scope, patient-search, app-shell, guest-booking and the canary.
- **B3 `feat/patient-rls`** — a person's clinical record is their own at the database (`FR-SEC-11`, `FR-NET-02`, `FR-GST-05`; design in `DATABASE.md` §5.3). **What was wrong:** B1 kept one hospital from another and left one person kept from another to the application: a patient, a tracking link and nobody at all shared one scope that reached everything, so a patient-facing query that forgot whose record it wanted returned somebody else's. **What changed:** a connection now says which account it is working for, or which booking a tracking link names, the way it says which hospital (migration 0044); of the clinical record (visits, prescriptions, test orders, reports, documents, consents, stays in a bed) an account reaches its own profiles' and nobody else's, a link what was written at the one booking it names and not that person's other visits, and a request that is nobody's none of it; none of the three writes a visit, an order or a report, and an account writes only its own consents. A hospital reaches exactly what it did. **Three places say a scope themselves:** a tracking link's page and its report run as that link once the token in the path has resolved; the preview of what a verified number may take over is read as the server, because those profiles are not the account's yet; and B1's schedule job. **Not done here, and said plainly:** a booking, a payment, a message and a profile are still reachable by any patient's connection and kept apart by the application, because the live serial is worked out from every booking in a chamber; that is plan I3 (new), which changes the queue's reads first. **Supabase needs 0039–0044 before the next release.** Strict gate: `pnpm verify` whole, and in the browser the canary, guest-booking, wallet, lab-report, patient-account, doctor-console, serial-past-midnight, standby, hospital-scope and app-shell, and the production-configuration suite.
- **B2 `test/tenant-matrix`** — one hospital set against another on every route there is (`FR-SEC-11`, `FR-NET-02`; `backend/api/src/__tests__/tenantMatrix.test.ts`). **What was missing:** each router had its own auth tests and nothing answered, in one place and for every route, "can somebody at hospital A reach hospital B?". **What it is:** the routes are read off the router the server mounts (158 of them), and each has to be named in the matrix with how it is kept to one hospital, so a route added later fails the suite until somebody decides; two seeded hospitals are each given a chamber with two patients, a ward, a case in the ER, an import and the rest; then a member of A's staff holding every role A can give asks for B's by path, by row and by a row named in the body of A's own request, and is refused each time (and not by a 5xx); A's own reads hold no id of B's; a platform administrator and a national viewer get none of it; nobody at all is asked who they are; a patient account and a tracking link reach no other person's booking, payment or record; a hospital's own app lists that hospital only; and at the end B is, row for row, what it was. 421 tests. **Found by it, and fixed:** `POST /payments/intent` held a tracking link to its own booking and held an account to nothing, so a signed-in patient could start a payment against anybody's booking and was told its fee. It now asks what `GET /bookings/:id/payments` asks (`BACKEND.md` §7.7); the test fails on the code before. **Found by it, and the owner's to rule on (question 7 below):** a number and a name given at one hospital's counter are found by the next hospital's counter when it types that number. That is `FR-GST-12`/`13` and `FR-REC-20` as written; whether `FR-NET-02` means it should not is not mine to decide. What a hospital imported does not cross (`FR-IMP-10`), and the matrix says both. **A test of B1's that failed once here, and why:** `database/tests/tenancy.test.ts` gave its probe role rights on every table inside each test; that changes every table's catalogue row while other files change the same rows, and PostgreSQL refused it once ("tuple concurrently updated"). Not rerun past: the role (`tenancy_probe`) is now given its rights once, by the suite's setup, before any test runs. **`demo` moved** to B1's merge (`738beab`), the last commit with a whole gate behind it. Strict gate: `pnpm verify` whole, and in the browser the canary, guest-booking and console-undo (the booking check the queue shares was touched).
- **B1 `feat/tenant-rls`** — hospitals are kept apart by the database, not only by the application (`FR-SEC-11`; design in `DATABASE.md` §5.2). **What was wrong:** every table had row-level security switched on and no policy, the API's role bypassed it, and hospitals were separated by three habits in application code; a route that forgot its scope check, or a query that forgot its hospital, leaked across hospitals with nothing underneath. **What changed:** every connection the API takes says who it is working for before anything runs on it, decided once per request from the principal and from nothing the request says; migration 0043 gives each of the 57 tables a policy, so a member of staff reaches their own hospital's rows and no other's (not to read, write, or move a row into), a platform administrator reaches organisations and nothing about a person, and a connection that says nothing reaches nothing; the API's role no longer bypasses row-level security. What crosses between hospitals is named in the migration and nowhere else: what a hospital publishes, a referral to its two ends, a visit under the patient's consent, and whether a hospital runs an emergency desk. **Found by turning it on, and fixed:** the schedule job, prompted by one hospital's import, writes every hospital's chambers and now runs as the server's own work; "runs an emergency desk" was read from another hospital's staff list and is now one yes-or-no from a function; a consented visit needed its booking readable too. **Changed for a caller:** another hospital's row asked for by id is answered 404, not 403: for that caller it does not exist. Thirteen assertions say so now. **Every browser suite now runs its API as the bound role**, so a flow the policies refuse fails a test; until now only the small production suite did. **Found by this gate, in the console and nothing to do with tenancy:** hospital settings (`S-B-11`) read once when the browser said "online" and, if that one read could not reach the server yet, said offline until somebody reloaded the page. A browser says "online" when a network is attached, which is before the server answers. It now reads again by itself, with the outbox's backoff, while it says offline and the browser says there is a network (`GR-03`); the spec makes the first read after a reconnect fail and expects the screen to recover. The other screens take their offline line from the browser directly and were not stuck this way. **Not done here:** one patient kept from another by the database (plan B3, new); and the public demonstration's API connects as the database's owner, which no policy binds, so this protects a deployment that runs the API as its own role, as one with real patients does. **Supabase needs 0039–0043 before the next release.** Full gate, at this integration point, every browser suite with its API bound: `pnpm verify` (5,477), `pnpm build`, the whole dev browser suite (202 of 203; the one that failed is the settings screen above, fixed, and its spec run again), the built suite and the production-configuration suite.
- **A8 `fix/doctor-record-scope`** — a doctor reads their own hospital's part of a patient's record unless the patient has consented to more (`FR-NET-02`, `FR-DOC-10`). **What was wrong:** once a patient had any booking at a hospital, every doctor there could read the patient's visits at every hospital, with no consent. **What changed:** consent opens the whole record; a treatment relationship alone opens the visits that hospital made, narrowed in the query itself; the answer and the audit row say which it was; the doctor's panel says only this hospital's visits are shown and that the rest needs the patient's code, without saying whether there is any more. A patient still reads their own record whole. **Not changed, and still the owner's to rule on:** access is at hospital grain, not per clinician, because no column joins a console account to a `doctors` row. **Section A of the plan is complete.** Strict gate: lint, format, `pnpm test` whole, and in the browser doctor-console, wallet, lab-report, referral and the canary.
- **A7 `fix/audit-append-only`** — every answer and every page carries the standard security headers (`NFR-08`). **What was wrong:** the API and both apps sent none. **What changed:** the API says a file is what its type says, that nothing it sends is to be framed or run, that an address (a tracking link's token is in one) is not passed on, that nothing is to be kept in a cache unless a route says so, and, over HTTPS, that it is never to be tried in the clear again; the two apps say the same, and only the patient app may ask a phone where it is. **Found already done, and not rebuilt:** the audit log. The handover's "audit log can be edited" was closed by plan 1.7: the API's database role has INSERT and SELECT on it and nothing else, tested in `apiRole.test.ts`. On the public demo the API connects as the database's owner, so that protection is the self-hosted and production one, as it always was. **Left, as plan I2:** the apps' Content-Security-Policy does not restrict scripts yet. Strict gate: lint, format, `pnpm test` whole, in the browser security-headers (4 new), app-shell, guest-booking, console-cold-start, lab-report, wallet and the canary, the built suite and the production-configuration suite.
- **A6 `fix/session-revocation`** — access that has been ended stops working at once (`FR-SEC-06`). **What was wrong:** a staff access token was honoured for its whole fifteen minutes whatever had happened since, and a console's live connection, once made, stayed made: a receptionist deactivated by her administrator went on working and went on being sent the queue. **What changed:** a token names the sign-in it came from (migration 0042: a family id that survives the renewal of tokens, so a console is not cut off every fifteen minutes) and is checked on every request and at every socket handshake against its account and that sign-in; signing out, deactivating, changing roles, resetting a password or two-step all revoke through one place that also closes the account's live connections; access ended some other way is refused at the next request and its connections are closed within a minute; a client the server closed tries once more, so a console that was given a new sign-in comes back and a revoked one stays off. **Left:** a patient's sign-out does not close a patient's connection; with more than one API instance (plan question Q5) the instant close is per instance and the sweep covers the rest. **Supabase needs 0039–0042 before the next release.** Strict gate: lint, format, `pnpm test` whole, in the browser staff-login, staff-2fa, hospital-settings, console-cold-start, platform-onboarding and the canary, and the production-configuration suite.
- **A5 `fix/booking-retry-safe`** — a booking survives its own answer being lost (`FR-QUE-51`), and a number cannot be used to fill a doctor's list (`FR-GST-14`). **What was wrong:** `POST /bookings` required an Idempotency-Key and dropped it, so the retry of a confirm that had gone through was refused as a duplicate and the patient, who had a serial, had no link to it; every booking was stamped `intake.demo`, a real hospital's included; a race the database settled came back as a 500; nothing limited bookings from one number. **What changed:** the key is kept on the booking (migration 0041) and the same request is answered again with its booking and a link that works, with nothing made, told or charged twice; a booking may hold a few live links, because the only way to give a link again is a second one and replacing the first killed the one in the SMS; the stamp follows `DEMO_MODE`; a unique violation is `WRITE_CONFLICT` (409); a number with no account may make ten bookings in a rolling day (a setting), cancelled ones included, and the route has a flood guard per address. **Left, as plan F3:** the no-show-then-prepay half of `FR-GST-14`, which needs online payment to mean anything. **Supabase needs 0039–0041 before the next release.** Strict gate: lint, format, `pnpm test` whole, and in the browser guest-booking, standby, patient-account, counter-registration, no-show-recovery and the canary.
- **A4 `fix/serial-past-midnight`** — a patient still waiting after midnight still sees their serial (`FR-PAT-39`, `FR-QUE-06`). **What was wrong:** Home's strip and My serials went by the calendar, so a booking dated yesterday was "past" even while its chamber was still running. **What changed:** where a booking stands is asked of the server and decided by two statuses and no date (`bookingStanding`); a booking that cannot be asked about is shown as unknown, with the age of the last answer, and never filed under past; one known to be past is not asked about again. Nothing is copied to the next day. **Decided here, as the requirement's words allow:** a patient marked absent stays current while the chamber is open. Focused gate with the canary: typecheck, lint, format, the domain and message tests, and in the browser serial-past-midnight (3 new, each failing on the code before), hospital-scope, app-shell, guest-booking and the canary.
- **A3 `fix/er-reconcile`** — the same for the ER console (`SY-09`). **What was wrong:** after a triage step was answered the console dropped its own drawing and read the whole board; for as long as that took the row showed the case before the step, and stayed there if the read failed. A statement delivered late could put a case back, or bring back one that had closed. And a read of the board that crossed an incoming alert took the alert off the screen. **What changed:** every case carries a `version` the database raises on each change (migration 0040); the console keeps the highest per case from any road and keeps a closed case as a marker; the answer's case goes on screen in the redraw that drops the drawing, which for a walk-in is the provisional row becoming the server's case with its token; a capabilities confirmation is settled from its answer; a case the console was told of after it asked for a read is not removed by that read. **Left:** a referral's step is still settled by reading the board (a referral has no version). **Supabase needs 0039 and 0040 before the next release.** Strict gate: lint, format, `pnpm test` whole, and in the browser emergency-burn (9, one new that fails on the code before), referral, ward-board and the canary.
- **A2 `fix/ward-reconcile`** — the ward board is right whichever of the server's two answers comes first, and an older statement can no longer put a bed back (`SY-09`). **What was wrong:** when the answer to an admit arrived, the board dropped its own drawing of it and read the whole board again; for as long as that read took the tile showed the bed before the tap, and with the socket silent and the read failing it stayed there. And a board took whichever statement about a bed arrived last, so a late broadcast could undo a newer one. **What changed:** every bed carries a `version` the database raises on each change (migration 0039); every read, answer and broadcast carries it and the board keeps the highest per bed; the answer's beds go on screen in the redraw that takes the drawing off; `bed.updated` names the action, so a broadcast that beats the answer settles it too. The board reads itself again only after a refusal. **Supabase needs 0039 before the next release.** Strict gate: lint, format, `pnpm test` whole, and in the browser ward-board (12, one new that fails on the code before), emergency-burn, referral, hospital-settings, data-import and the canary.
- **A1 `fix/queue-exactly-once`** — one action is drawn once on the reception and doctor consoles, whichever of the server's two answers comes first (`SY-08`). **What was wrong:** the broadcast named nothing, so when it beat the answer to the console's own request — and the answer waits for messages to be sent, so it usually did — the action was on screen twice: a doctor who declared thirty minutes was shown sixty until the answer came; and an answer lost on the way left the console resending, or waiting for ever if it could not. **What changed:** `queue.updated` names the actions of the write behind it (`applied`), a subscribing console says which of its actions are unanswered and the catch-up names those the log holds, and the console takes an action off its own drawing at the first statement that names it, in the redraw that shows the queue containing it. A tap of two events is written to the outbox whole before anything draws or sends it. **Left, deliberately:** `applied` goes to the whole chamber room, patients' phones included; the keys are opaque, and they leave that room with plan I2. Strict gate: lint, format, `pnpm test` whole, and in the browser the canary, offline-console, console-undo, pause-resume, doctor-console, chamber-end, no-show-recovery and the three new tests.

**Blocked outside the repository** (built to the adapter; only switching on waits; first of all the company's registration in Bangladesh, which the agreements and merchant accounts follow;
then): live SMS and a sender ID; live bKash, Nagad or cards; the platform's
domain, DNS and certificates, and a hospital's own domain; store accounts; a
hospital's HMS; an API key to try the model's import suggestions against the
real service; hosting in Bangladesh; an independent security test.

**Blocked on the owner** (each is skipped, nothing waits for it):

1. **An operations assistant?** The approved documents exclude any AI beyond
   the import mapping (`PRD.md` §27, `CLAUDE.md` §4.4), so it is not built.
   If wanted: read-only over a hospital's own verified figures, facts told
   apart from suggestions, no action taken, nothing clinical.
2. ~~A spreadsheet file read directly~~ — **decided by the owner, 7 October:** yes. A free, well-maintained library may be added; `.xlsx` and `.xls` are read directly and CSV stays a supported fallback; the parse feeds the existing mapping, checking, preview, audit and undo, and bypasses none of them. Plan E1.
3. **Reschedule** (`FR-PAT-23`) was put outside V1 on 5 October. Still outside?
4. **Push notifications** wait for a signed hospital (decision 84) and need a
   dependency. Still waiting?
5. **More than one API instance** needs a shared store that costs money. Not
   needed at V1's size; say if a hospital's load changes that.
6. **The Bangla spelling of MedLiveBD**, and the platform's domain.
7. **A person's number at the next hospital's counter.** Reception at any
   hospital that types a mobile number is shown the name, age and sex of the
   people registered under it, wherever they were registered (`FR-REC-20`,
   `FR-GST-12`, `FR-GST-13`: one identity per number, not retyped). `FR-NET-02`
   says nothing identifying a patient is visible to another hospital. Keep
   one identity across the network (as built), or show a counter only the
   people that hospital has itself seen? Records, bookings and imported
   patients do not cross either way.
8. **May a hospital keep what its emergency department can treat?** A
   hospital now chooses which live figures it shares (`FR-NET-04`): serials,
   beds, pharmacy stock. What its emergency department can treat (a burn
   unit, a cath lab) is not among them: while it runs an emergency desk it is
   shown, because the emergency search sends a family to the nearest place
   that can treat the problem (`FR-PAT-43`, `FR-BRD-09`). Keep it that way
   (as built), or let a hospital keep that too?
9. **A hospital code taken by an application.** The form makes the code from
   the facility's English name, first come first served, and a code is never
   handed to a second hospital, so somebody who applies under a well-known
   hospital's name holds its plain code even after the platform declines them;
   the real hospital, added later, gets another (the name with `-2`, or one
   the platform chooses). A code is that hospital's address under the
   platform's domain. Keep it that way (as built), or free the code of a
   workspace that was closed without ever going live? Related, smaller: a
   server that holds one hospital only still offers the form on its sign-in
   screen; nothing switches it off (`DEPLOY.md`).
21. **One doctor across several workplaces (R5).** `docs/design/doctor-workplaces.md` proposes linking a doctor's accounts into one person with one password and second factor, while every token keeps exactly one hospital, so no tenant policy changes and nothing is ever mixed. Three things are yours: approve the shape (or ask for another); whether a new workplace waits for the doctor to accept it (recommended, so hospital B cannot attach itself to a doctor's sign-in); and when to build it, recommended after the first pilot has signed in for real, because it changes sign-in.
20. **What a reception desk does (R4).** As built, assigning doctors to a desk **organises** the console: that desk's chambers come first and every other chamber stays reachable, because decision 2a keeps one common reception workspace and a receptionist covering another desk must never be locked out of a queue. The other reading of decision 2b is that a desk **restricts** a receptionist to its doctors. Keep it organising (as built), or make it restrict? Restricting means each receptionist account is also bound to a desk.
19. ~~Reading spreadsheet files (E1): the library~~ — **decided by the owner, 8 October:** `read-excel-file`, `.xlsx` only; `.xls` is named and the screen says to convert it. Built in E1.
    *Was:* **Reading spreadsheet files (E1): the library.** You approved reading `.xlsx` and `.xls` directly with a free library (question 2). The library that reads both is SheetJS (Apache-2.0, free); its current release is published only on its own site (`cdn.sheetjs.com`), because the copy on npm is old and has known security advisories. Installing it from there was refused by this machine's safety check, and so was writing a reader of my own in its place, so **E1 is not built**. To go on, one of: allow the install of SheetJS 0.20.3 from `cdn.sheetjs.com` into the console (and the root, for the browser test that builds a spreadsheet); or name another library from npm, knowing that the maintained npm ones read `.xlsx` only (`exceljs`, `read-excel-file`), so `.xls` would be saved as `.xlsx` or CSV first. Until then a spreadsheet is saved as CSV, as `FR-IMP-09` says, and every other part of the import works.
18. **The public demo's database role.** Since 0043 the database itself keeps hospitals apart, but only for an API that connects as its own limited role (`pnpm db:role`), as the self-hosted stack does. The public demo's API connects to Supabase as `postgres`, which bypasses row-level security, so on the demo that separation is the API's alone. The data is synthetic, so this blocks nothing. Keep it so (as now), or make the limited role on Supabase at the next release so the demo runs as a real deployment would? `DEPLOY.md` §7.2.
16. **How long a bed count stays a count.** Since K2 (owner, 8 October) a patient sees an exact number of free beds only while the figure is within the hospital's freshness threshold, which is ten minutes unless the hospital sets another (`FR-OFF-04`); after that the card says whether beds were free when last confirmed, with the age. A ward's figure is re-stamped whenever a bed changes or the ward confirms its board, so on a quiet ward the count turns into words ten minutes after the last change, and on the demonstration nearly every count has turned into words by the time anyone looks. Keep the one threshold (as built: a hospital raises its own), or give beds a longer default of their own (for example an hour)?
17. **Whose merchant account takes the money.** As built (H3), a deployment has one bKash and one Nagad merchant account, the platform's, and a hospital's collections are reported to it for settlement (`FR-PAY-05`). The other way is each hospital's own merchant account, chosen per hospital, which means credentials per hospital and no settlement through the platform. It is a business arrangement with each hospital and with the providers, so it is yours: keep one platform account (as built), or plan for per-hospital accounts? Nothing is blocked meanwhile; no real money moves until X2.
15. ~~A serial whose online payment was never finished~~ — **decided by the owner, 7 October, as proposed:** when an online payment starts, the serial is held for fifteen minutes. Not finished in that time: at a hospital that takes payment at the counter it becomes pay-at-the-counter, and the screen and the SMS say so; at a hospital that requires payment first, the serial is released when the hold ends and the patient is told. The hold is a hospital setting if it fits the settings that exist, fifteen minutes by default. Plan H3.
14. **A chair whose offer ran out.** When a patient *declines* an offered chair it goes to the next person on the standby list by itself. When a patient simply does not answer in ten minutes, the chair comes back to reception, who press offer again (and that offer goes to the next person, not back to the one who did not answer). The requirement's words are "unaccepted offers pass to the next patient", which reads as both going on by themselves. Keep a lapse as reception's to re-offer (as built: reception stays in charge of each chair, and a chamber about to end is not offered away to somebody who cannot get there), or pass it on by itself as a decline does (no tap needed, fuller chambers)?
13. **The leave-home alert as a message.** The live serial screen tells a patient to set off when the travel time and a ten-minute margin catch up with their wait. That is a banner: it reaches only somebody with the page open. Sending it as a message has two ways and they are not close. By **SMS** it reaches everybody and costs the hospital one more SMS for every patient of every chamber, on top of the confirmation and the two-away message. By **push** it costs nothing and today reaches nobody, because no screen yet asks a patient for permission to notify them. Which: SMS, push (with the permission prompt built first), or leave it a banner?
12. **What an agreement's state does.** The platform can now mark a hospital's agreement trial, active, overdue or ended (G1). As built it is a record and nothing follows from it: a hospital marked ended is listed and working exactly as before, and taking it out of the network is still a separate act, suspending it, with a reason the hospital reads. The other way is for the state to act by itself: ended (or overdue past some number of days) suspends the hospital automatically. That is quicker for the platform and it is also a patient finding a hospital's doctors gone because of a paperwork date. Keep it a record (as built), or have a state suspend by itself, and if so which state and after how long? Related, smaller: the hospital's own administrator is not shown the state; should they be?
11. **A patient's times when the counter was offline.** A counter that loses its connection goes on working and sends what it did when the connection returns. Today every patient checked in, called or finished in that time is recorded at the moment of sending, not the moment of the tap, so the waits worked out from those times are wrong for that stretch (how long a consultation took is not affected: the counter measures that itself). That is written into the documents as the rule (`SY-01`: only the server's clock is trusted, so a counter cannot improve its own figures). The doctor's arrival is now kept at the counter's own time, inside limits (F2b). Do the same for patients' times (truer figures, resting on the counter's clock within limits), or keep the server's time (as built)?
10. **Counters.** `FR-SUP-01` lists counters among what a hospital sets up,
    and the settings screen has none. Nothing in the product reads a list of
    counters: there is no table of them, a member of staff is known by their
    own account (`FR-SEC-06`), and shift reconciliation per counter
    (`FR-REC-23`) is not built. A list on the settings screen would configure
    nothing, so D2 did not add one. Build counters with reconciliation as its
    own step, or leave both out of V1? **Partly settled by the owner's decision
    2b (8 October):** desks exist since plan R4 and order the console; what is
    still open is only reconciling money per desk (`FR-REC-23`).

**Decided by the owner's note of 6 October** (were open above): emergency
search inside a hospital's portal stays network-wide (`FR-BRD-09`); a shared
screen shares no record (`FR-BRD-10`); a hospital may apply by itself and is
public only after a person approves it (`FR-ONB-09`, `FR-ONB-10`).

**Tests:** the last full gate was the release of 6 October (below). Each
branch's line says what it ran.

**Known limitations:** the plan's own left-hand column, row by row, is the
list of what is still wrong or missing.

### Done: the V1 pitch build (owner, 5 October, evening)

**Read `CLAUDE.md` §1.2 and §4.4, then `docs/PLATFORM_PLAN.md` §2, *Now: the
V1 pitch build*.** The owner read an audit of the code against a clarified
direction and decided, in one written note, overriding the freeze of that
morning:

- **The product is one platform**: a multi-hospital patient app (search for
  what you need, see which hospitals can provide it now), a private portal
  per hospital, and later an optional hospital-branded patient app on the
  same API. Not software rewritten per hospital.
- **One shared deployment hosted in Bangladesh is the default** (`FR-SEC-07`
  amended). A hospital's own server is a later exception. Do not design
  around one server per hospital.
- **The freeze is lifted.** Build until the pitch-ready V1 experience is
  complete, then stop adding scope. The pitch is the whole platform, not
  "only a reception pilot".
- **Not blockers now:** a real SMS provider and sender ID, bKash, Nagad,
  merchant accounts, store publication, a paid penetration test. The company
  is still being registered; these follow it. Simulated codes, mock payment
  and demo data are what the pitch runs on.
- **Security is split.** Tenant isolation in the database, scope enforcement
  and the cross-hospital reads must be done before two real hospitals share
  real data (`FR-SEC-11`, plan 1.10); they do not block the pitch.
- **Order:** patient search and discovery; hospital onboarding from screens;
  the mapped CSV import with a model's suggestions on top; a design pass
  walked as each role; then one full gate and a release to the public demo
  (made 6 October; it had been 133 commits behind `mvp`).
- **Ambulance and blood leave the first screen.** Reschedule only if cheap.
  A significant redesign is allowed where the old screens fight the new
  structure.
- **Testing has two levels** (`CLAUDE.md` §6): focused for screens and copy,
  strict for the queue, migrations, auth, tenancy, records and import writes;
  everything once before a release.
- **How the owner wants it worked:** a line on what a branch changes, build
  it, a short plain update when it merges (what changed, what he can see,
  tests run, next branch), and no waiting for approval in between.

**Where it stands:** the table in `docs/PLATFORM_PLAN.md` §9 (rows V0–V6).

**Merged so far in this build, newest last:**
- **V1.1 `fix/patient-v1-surface`** — nothing unfinished is offered in the patient app: ambulance and blood are gone from Home and from the emergency screens, and the "not built yet" screen no longer exists. Focused gate: typecheck, lint, format, the message tests, `app-shell.spec.ts` and `emergency-burn.spec.ts` (20 passed).
- **V2.1 `feat/patient-search`** — a patient searches for a doctor, a hospital, a specialty, a bed kind or a capability and sees which hospitals can provide it, each with the live figure for that need and its age; Home opens on that search; a result goes straight into booking at that hospital or doctor. Found by a screenshot and fixed with a test: the bottom bar lit the serials tab on `/search`. Focused gate plus the new route's API tests: typecheck, lint, format, 33 unit and 12 API tests for search, `patient-search`, `app-shell` and `guest-booking` in the browser (42 passed, then 23 after the tab fix).
- **V2.2 `feat/hospital-scope`** — the branded-app foundation and no more: the patient app opened with `?scope=PADMA` is Padma's, in its name and colours, showing its doctors and beds only; every patient link and the API's allowed origins are each built in one place. **Supabase needs migration 0036 before a release.** Strict gate: `pnpm test` whole (4,913, one pinned `/config` shape updated), typecheck, lint, format, and in the browser the canary, hospital-scope, patient-search, guest-booking, standby, emergency-burn, ward-board and demo-label (67 passed; one of the new spec's own waits was wrong and was fixed).
- **V3.1 `feat/org-lifecycle`** — a hospital no longer publishes itself: its administrator sees a checklist on `S-B-11` and asks for review, and a platform administrator approves, sends back with a note, suspends, reinstates or closes, and verifies doctors (`/platform/*`, API only until V3.2). Found and closed on the way: a booking sent straight to a chamber at a suspended or unapproved hospital was accepted. **Supabase needs 0036 and 0037 before a release. A new single-hospital deployment cannot go live until V3.2 gives it a platform administrator** (`DEPLOY.md` S3). Strict gate: `pnpm test` whole (4,963), typecheck, lint, format, and eleven browser specs with the canary (66 passed).
- **V3.2 `feat/platform-console`** — the platform administrator's screen: hospitals with those waiting first, add a hospital with its first administrator (temporary password shown once), verify a doctor, approve / send back / suspend / reinstate / close with a reason where one is owed. A hospital now goes from nothing to live with no command line after the deployment's first platform administrator (`pnpm staff:create --platform`, `DEPLOY.md` S3). On the demo it is the picker's **প্ল্যাটফর্ম পরিচালনা** section. Strict gate: `pnpm test` whole (5,134), typecheck, lint, format; in the browser the canary, platform-onboarding, gov-dashboard, console-cold-start, staff-login, staff-2fa, hospital-settings, console-rail and demo-label (41 passed).
- **V4.1 `feat/import-mapping`** — a hospital uploads its own CSV export: the server says what each column holds and proposes which is which with a reason, an administrator corrects and confirms on a screen that never shows a row, and the file goes to the importer that already exists (check, preview, approve, undo). The same export maps itself next time. Rules and a person only; the model is V4.2. Sample exports to show it with: `database/seeds/samples/`. **Supabase needs 0036–0038 before a release.** Strict gate: `pnpm test` whole (5,274), typecheck, lint, format; `import-mapping` and `data-import` in the browser (4 passed).
- **V4.2 `feat/import-mapping-ai`** — a model's suggestions on top of the rules, for the columns the rules could not place. It is sent headings and column profiles and never a row; its answer is filtered to the fields and columns it was asked about; each kept suggestion is shown as a suggestion with its reason; a person confirms; the same importer decides. Off by default, and off, slow or failing it changes nothing. **To show it in a pitch the owner sets `MAPPING_PROVIDER=claude` and `MAPPING_API_KEY`; it has only been run against a stand-in network, so try `pnpm mapping:try` with the key first.** Strict gate for what is sent, focused for the screen: `pnpm test` whole (5,318), typecheck, lint, format; `import-mapping` in the browser (5 passed).
- **V5.1 `fix/pitch-walkthrough`** — the product walked by screenshot as each role: patient, Padma's own app, reception, doctor, ward, emergency, hospital administrator, platform administrator. One fault found and fixed with a test: a hospital's own app showed a serial this phone had booked at another hospital (Home's strip and সিরিয়াল); it now shows that hospital's only, and `GET /config?scope=` says which hospital that is by id. No staff screen needed changing. `PRD.md` §24 is the platform's pitch now, eleven steps, and promises no reschedule (`FR-PAT-23` marked outside V1); *Running the pitch demo* below covers search, a hospital's own app, onboarding and the mapped import. Focused gate: typecheck, lint, format, the scope API tests (21), and in the browser hospital-scope (6) then the canary, guest-booking, app-shell, patient-search and standby (50 passed).
- **`chore/rename-medlivebd`** — **the product is MedLiveBD** (owner, 6 October, replacing the working name HealthWealthBD and the placeholder স্বাস্থ্যসেবা the patient app showed). The patient app's header, title and installed name, the console's tab, a patient's verification message, a platform administrator's authenticator entry, a downloaded import template (`medlivebd-<set>-template.csv`) and the self-hosted stack's project, image, database and role names. **Written the same in Bangla and English, which is this build's choice and not the owner's:** he gave one spelling, so none was invented; a Bangla spelling is one line in `shared/i18n` (`appName`) when he gives it. Not renamed: `@platform/*`, the repository folder, tables. **A self-hosted stack started under the old names would need its `deploy/.env` kept as it is** (none exists outside this machine's tests). Focused gate: typecheck, lint, format, the message, environment, import and TOTP tests (3,096), and in the browser hospital-scope, data-import, app-shell, patient-account and staff-2fa (23 passed).
- **V4.3 `feat/import-warnings`** — what is not an error is still said before an import is approved (`FR-IMP-21`): patient rows under different identifiers that look like one person (same name with the same mobile number or the same birth date; a shared phone alone is a family), and a date or mobile column written more than one way, with the reading that will be used. By row number only, nothing merged, nothing refused, approval never disabled. Worked out from the batch's rows each time it is read, so **no migration**. To show it: `database/seeds/samples/hospital-export-patients-untidy.csv`. The last planned branch of the V1 pitch build. Strict gate: `pnpm test` whole (5,368), typecheck, lint, format; `data-import` and `import-mapping` in the browser (7 passed).
- **V6 `chore/pitch-release`** — the release. Full gate on `fa31157`: `pnpm verify` (5,368 tests), `pnpm build`, `pnpm test:e2e` (191 passed), `pnpm test:e2e:built` (3 passed) and `pnpm test:e2e:prod` (25 passed), the canary in the first and the last. Then, in this order: migrations 0034–0038 applied to Supabase and `db:verify` clean there; `mvp` merged into `main` and pushed, which redeploys the API and both apps; the demo data reset from the new seeds (Padma's theme, every hospital's lifecycle, the platform administrator); `demo` moved to the same commit and pushed. **Not verified from here: the deployed pages themselves** — the public demo's addresses are not recorded in this repository, so the owner opens them. The model's import suggestions are off on the public demo until `MAPPING_PROVIDER` and `MAPPING_API_KEY` are set on Render. The morning refresh task had been skipping since 0037 was written (Supabase was behind, so `db:verify` refused); it runs again now. **The first full gate of the night was red by one test, the canary, by 186 ms** (2,186 against 2,000): it ran while a formatter and a patch script were running in a second working copy on the same machine. Alone it passed, and the gate was run again from the start on the final commit with the machine left alone, which is the run counted here. The rule it confirms: nothing else runs on this machine while the browser suite does, not even a formatter. **The second run's production suite was red by one assertion** that pinned the exact shape of `GET /config` and had not been updated when V2.2 added `scope` to it (the suite had not been run since): the test was corrected (`fix/prod-config-shape`, the only difference between `2e26cd0`, which the other four steps ran on, and `fa31157`) and the production suite run again whole, 25 of 25. So a branch that changes a public answer's shape runs `pnpm test:e2e:prod` too.

**Left for the owner by this build** (none of them blocks the pitch):

- **Emergency inside a hospital's own app.** Ruled by the owner on
  6 October (`FR-BRD-09`): it stays the whole network. Built and said on the
  screen in plan C6, above.
- **`FR-NET-04`** (a hospital choosing which figures it publishes) was built
  on 6 October (plan C5, above).
- **Records inside a hospital's own app.** Ruled by the owner on 6 October
  (`FR-BRD-10`): the wallet is the patient's own, wherever a visit was made,
  in any portal. Held by tests in plan C6, above. A scoped app still shows
  only that hospital's serials on Home and on সিরিয়াল (V5.1).
- **A serial booked before V5.1 is not shown in a scoped app.** The phone's
  saved booking did not record which hospital it was at. It still shows in the
  network's own app, and it is a matter of a day's bookings on a demo.

**Decided by this build without asking, as the direction allows:**

- **Home's order** changed from "emergency first" to: a live serial if this
  phone holds one, search, the emergency card, specialties, convenience
  (`APP_FLOW.md` `S-A-02`). The emergency card is still on the first
  screenful, which a browser test now measures.
- **A word that names a need is read as the need**, and hospitals or doctors
  whose names contain the word are listed after it. Whole text only: "burn"
  is a need, "Burnett" is a person (`shared/domain` `search/needs`).
- **Blood bank and ambulance are not offered as search needs**, though both
  are capabilities a hospital publishes: a search for either reads as the two
  services that are outside V1.
- **A scope is not a permission.** It narrows public data, so it is read
  from the address (`?scope=CODE`) or the build, and a code no live hospital
  has is refused with a 404 rather than read as the whole network.
- **A hospital's theme is six brand tokens and nothing else**, refused whole
  if white on `brand-600`, `brand-700` on the canvas or `brand-600` on
  `brand-100` falls under 4.5:1. Padma carries a navy one in the demo data so
  the pitch can show it: open the patient app with `?scope=PADMA`.
- **Hospital-aware links and origins are prepared, not switched on**:
  `config/links.ts` `patientLink` and `allowedOrigins`, and
  `EXTRA_ALLOWED_ORIGINS`. Nothing answers differently until it is set.

**Carried over from the audit, true of the code on 5 October and worth not
re-deriving:**

- The patient app's discovery is specialty → hospital → doctor only. The API
  already takes `q` on `/hospitals` and `/doctors` (substring, both scripts)
  and `bedKind` on `/hospitals`; no screen sends `q`.
- `hospitals.code` exists and is unique (0027). There are no brand columns.
- The API answers exactly two browser origins (`middleware/cors.ts`,
  `realtime/server.ts`), and every patient link is built from one
  `WEB_BASE_URL` (booking, bed request, emergency, standby).
- A hospital administrator's go-live publishes the hospital with one
  department and one doctor; nobody outside the hospital approves it. A
  hospital and its first administrator are made by `pnpm staff:create`; a
  doctor is verified by `pnpm doctor:verify`. `platform_admin` is a role with
  no screen.
- The import takes only a file whose headings are the template's
  (`missingColumns`). No mapping code exists.
- `booking.service.ts` stamps `intake.demo = true` on every booking, real
  ones included; notification sending is still awaited inside the request;
  `audit_log` can be edited; no security headers. All after the pitch.
- A signed-in patient still books as a guest, My serials is this phone's
  list, and nothing reschedules (no route, no screen).

### Superseded the same day: client-readiness mode (owner, 5 October, morning)

**The freeze in this section was lifted that evening (above). It is kept for
the record of P1–P4 and of the reception-pilot candidate, which stand.**
The priority was one supervised reception pilot, and feature work was
frozen until its path was green. What that day's decisions were, all the
owner's, each given in a written note:

- **Where it stands: P1 to P4 are merged and the work has stopped for the
  owner's review** (below, *Pilot readiness*). The order was:
- **Order:** P1 `fix/console-ack-rollback` (merged, `becb262`) → **P2
  `fix/console-demo-banner`** → P3 `fix/chamber-end-of-day` → P4
  `chore/e2e-pilot-path` → **stop and report**: one answer, go or no-go for a
  supervised reception pilot, naming only what actually blocks it. Nothing
  else from the plan resumes until the owner has read that report.
- **Scope for week one is reception only.** The other modules are outside
  the pilot, not re-rated: they keep `HANDOVER.md` §13's ratings.
- **P2** covers the console and the patient app: the demonstration line is
  shown on a demonstration, absent on a real server, hidden while the server
  has not answered.
- **P3** adds `BTN-B02-END` and `MOD-B02-END` (`APP_FLOW.md` B1.2) and the
  date and start on the picker's cards. It must not strand anybody silently:
  off while a patient is in the chamber, **and the server refuses that end
  too** (one guard, the ordinary refusal, nothing written); the number of
  patients not seen is stated and needs a deliberate tick; nobody's status is
  changed to tidy up; refund eligibility is as it was. Before this the server
  ended a chamber whatever the queue held.
- **P5** (HTTPS for a server reachable only inside a hospital) is **not to be
  built on a guess**. `DEPLOY.md` S1 carries the question for the hospital's
  IT; if they choose inside-only, the smallest design goes to the owner
  first.
- **Decided and written, not built:** `SY-08` and `SY-09` in `BACKEND.md` and
  *One action, shown once* in `FRONTEND.md` §11.1, with the owner's
  constraints (`applied` bounded to one write; a tap is one thing on the
  screen; versions raised in the row's own transaction; tests that deliver
  N+1 before N); and the founder's decision on sessions that cross midnight
  (`PRD.md` `FR-QUE-06`, `FR-PAT-39`). Each is marked "not built" where it
  stands. They are rows 1.9c–1.9f and wait until after the first pilot, with
  the conditions that would bring one forward in the plan's B list.
- **What to say about import:** supervised CSV imports in the templates
  already built work. Not to be promised: a direct connection to an HMS or
  its database, arbitrary Excel files, or working out an unknown format.

**Found while preparing that list, verified in the code, and why P2 and P3
exist:** the demonstration line is drawn unconditionally on ten console
screens and four of the patient app's; nothing in the product ends a chamber
(the route exists, no screen calls it, no job does), so yesterday's chamber
is still "running" the next morning, is listed first, and its card shows no
date. **Not verified, and why P4 exists:** registration and a walk-in have
never been driven in a browser under the production configuration.

**After the pilot path: plan 1.10, `feat/tenant-rls`** — the last and largest row of phase 1
(`docs/PLATFORM_PLAN.md` §2): the database itself keeps one hospital's rows
from another's staff, so a forgotten check in a route cannot leak across
hospitals. Not started. It begins with a design note in the branch, and the
plan's own rule 7 (§8) says to stop and ask before changing how hospitals
are isolated, so **the note goes to the owner before any policy is
written**. What was read for it on 3 October, so it is not read again:

- **178 queries in 24 repository files go straight to the pool**
  (`.execute(db)` or `.execute(trx ?? db)`), with nothing that says whose
  request they belong to. A policy keyed on "this request's hospital" needs
  every one of them to run on a connection that carries it.
- **That can be done in one place.** The installed Kysely (0.29.6) calls
  `onReserveConnection` each time a connection is taken from the pool
  (`postgres-dialect-config.d.ts`). A request's scope held in an
  `AsyncLocalStorage`, set after `attachPrincipal`, can be written to the
  connection there, without touching the 178 call sites. Nothing in the API
  uses `AsyncLocalStorage` yet. The cost is one more statement each time a
  connection is taken; it has not been measured against the canary's two
  seconds.
- **There is a precedent for a scoped role**: `gov.repo.ts` runs government
  reads under `SET LOCAL ROLE gov_reader` inside a transaction.
- **The API's role still carries `BYPASSRLS`** (plan 1.7); 1.10 removes it
  in the step that adds the policies. On Supabase the API connects as the
  owner, whom policies do not bind unless a table is set to `FORCE ROW LEVEL
  SECURITY`.

**The questions the design note has to answer, and the owner to rule on:**

1. **Which requests cross hospitals by design**, and under what scope they
   run. Staff at a hospital are the easy case. A patient's wallet spans
   hospitals; discovery, the emergency search and the bed search read every
   live hospital; a referral is written by one hospital and read by another;
   the national dashboards and the hourly jobs read all of them; staff
   sign-in looks an email up before any hospital is known.
2. **Whether patient-side rows get policies now** (`DATABASE.md` §5's table
   describes them) or 1.10 is staff-side isolation only, as its plan row
   reads, with the patient side left to the API's checks.
3. **Whether the demonstration on Supabase is put under the policies** (a
   second role there, or `FORCE ROW LEVEL SECURITY`), or stays as it is
   until a release.

**Then, in the order suggested to the owner (2026-09-30):**
1. **A security review of the whole codebase** — **done 2026-09-30** (below,
   *Security review*). **All four holes fixed the same day**, one branch each
   (decision 85 ruled for the returning guest). A paid penetration test should
   still follow before a pilot holds real data, as the owner was told.
1a. **The handover audit's findings (2 October)** — before any pilot, the
   fixes in `HANDOVER.md` §16 ("if 7 days"), one `fix/*` branch each. **The
   owner said go on 2 October**; they are phase 1 of `docs/PLATFORM_PLAN.md`,
   whose §9 says which have landed.
2. **Server sizing for Marks** — measure the `deploy/` stack's CPU, memory and
   disk on this machine, so Marks' IT can say whether they can host it.
3. ~~**Releasing `mvp` to `main`**~~ — **done 6 October** (`chore/pitch-release`):
   Supabase took 0034–0038, `main` is `mvp` at `fa31157`, and the demo data
   was reset afterwards. The next release repeats it: the full gate, then
   `ALLOW_REMOTE_DB=1 pnpm db:migrate` and `db:verify` against Supabase, then
   the merge and push, then the reset.
Step 27 waits for an SMS account; push notifications wait for a signed
hospital (decision 84). Company registration (the name is MedLiveBD since 6 October; via
BanglaBiz) is outside the repo and paused; see the owner's notes.

Four unplanned branches after step 11:

- `chore/deploy` — the `S-B-01` console picker, `render.yaml`, Vercel configs
  and `docs/DEPLOY.md`.
- **`feat/app-shell`** — hospital-first discovery and the patient app shell.
  Asked for directly by the owner: the booking flow went specialty → doctor,
  and he wanted specialty → hospital → doctor, which is what `APP_FLOW.md`
  always said. He also said the patient side "does not look anything like an
  app", so the same branch adds `NAV-A`, the manifest and the service worker.
  See below.
- `fix/console-past-midnight` — two date bugs that only appear in the first six
  hours of a Dhaka day. See *Things learned the hard way*.
- `chore/format-clean` (after step 16) — `pnpm format:check` had been red for
  several steps; this makes `pnpm verify` green and removes the two reasons it
  went unnoticed. See *Things learned the hard way*.

None of these is a build step: nothing in `CLAUDE.md` §4 is skipped or brought
forward.

Three unplanned branches also merged after step 3, all recorded in `git log`:
`chore/remove-commercial-strategy`, `chore/supabase-compat`, `fix/api-env-file`.

**Step 10 is the milestone, and it passes.** A guest books, opens the SMS
tracking link, and watches the queue move: reception taps *next* on one device
and the patient's screen updates on another inside the two-second budget
(`NFR-01`), proven by `e2e/two-device-queue.spec.ts` against a real socket, a
real reducer and a real database write. That is the pitch (`PRD.md` §24 steps
1–4). Steps 5–8 of the script — no-show recovery, prescriptions, emergency,
the admin dashboard — are build steps 11 onward.

**Step 9 is the first step a patient can see.** `frontend/patient` serves
discovery and the four-stage booking flow in Bangla, and a guest books end to
end against the mock payment provider without ever meeting a login wall
(`FR-GST-01`).

**Step 8 is the first step with a screen.** Steps 5–7 are seeds and design
tokens; nothing renders before `feat/console-reception`. Step 5 is the first
step whose output is *visible* — demo data in Supabase's table editor.

**Authentication is deferred** (`CLAUDE.md` §4.1). Supabase Auth will issue
tokens when this goes past the pitch. The step-3 middleware that *verifies*
tokens stays; no OTP flows, staff passwords or argon2id are to be written. The
guest tracking link (`FR-GST-05`) is kept, because it is a capability token the
demo depends on rather than a login.

**Step 11 notifies from the queue, not from a cron.** A material event is
turned into messages by `notification.service`, the rows are written inside the
queue transaction and sent after it commits. `pg-boss` is deliberately not
installed (see the open decisions): every message this version sends is caused
by an event, so nothing needed a scheduler. The two jobs that genuinely do —
the leave-home alert and send-retry — are noted under the deliberate gaps.

**As of `chore/e2e-pilot-path` (5 October):** `pnpm test` reports 4,794
in three to four minutes; `pnpm test:e2e` 164 (13 minutes with `--trace
off`; 25.7 once after a day of runs with 0.35 GB free: the tests are the
same, the machine is not); `pnpm test:e2e:built` 3; `pnpm test:e2e:prod`
25. The per-file list below was counted at 136 and is
kept for the names, not the numbers.

`pnpm test:e2e` reported 136 then, in Chromium, against the real API and the seeded
demo database — 5 in `two-device-queue.spec.ts`, 18 in `guest-booking.spec.ts`,
5 in `offline-console.spec.ts`, 12 in `app-shell.spec.ts`, 7 in
`doctor-console.spec.ts`, 5 in `console-cold-start.spec.ts`, 8 in
`wallet.spec.ts`, 8 in `ward-board.spec.ts`, 7 in `emergency-burn.spec.ts`,
6 in `referral.spec.ts`, 6 in `lab-report.spec.ts`, 2 in
`no-show-recovery.spec.ts`, 6 in `admin-dashboard.spec.ts`, 2 in
`check-in.spec.ts`, 3 in `standby.spec.ts`, 10 in `gov-dashboard.spec.ts`, 6 in `language-switch.spec.ts`, 4 in `console-rail.spec.ts`, 3 in `staff-login.spec.ts`, 2 in `hospital-settings.spec.ts`, 3 in `counter-registration.spec.ts`, 1 in `data-import.spec.ts`, 1 in `patient-account.spec.ts`, 2 in `self-host.spec.ts`, 2 in `staff-2fa.spec.ts`. The last full
run took eighteen and a half minutes (twenty-nine before `fix/e2e-context-leaks`).

**The two `demo.routes.test.ts` failures were Fridays, not early mornings —
fixed in `fix/console-picker-friday`.** They expect the ER console and the ward
board at four or more facilities. On a Friday only the government college and
the clinic sit chambers (`seed_02`, `FRIDAY_CHAMBERS`), and the picker
(`demo.repo` `listConsoles`) hid every facility with no chamber today, so four
hospitals' ward boards, ER consoles, labs and dashboards vanished all day.
Both sightings (02:00 and 12:30 Dhaka, 2026-09-25) were a Friday. A facility
that staffs a facility-level console is now listed whatever the day, the
picker says when a hospital has no chambers (`noChambersToday`), and a third
test hides one facility's chambers to prove it on any weekday. Separately,
once, `standby.routes.test.ts` "writes an SMS to the number on the standby
row" read the wrong phone. It passed alone and on the next two full runs, so
it looks like an ordering interaction on the shared API database.

`pnpm verify` — typecheck, lint, `format:check`, test — is clean, and so is
`pnpm build`. `format:check` had been failing on five files since before step
16; `chore/format-clean` fixed them and the two things that let it happen (see
below).

### Pilot readiness — the answer the owner asked for after P4 (5 October)

**Go, for a supervised reception pilot of the scope agreed** (one hospital on
its own server, one department, one to three chambers, reception only), **on
three conditions, none of which is code:**

1. **The server can be reached by HTTPS names its counter PCs trust.** The
   only path built is publicly resolvable names with automatic certificates
   (`DEPLOY.md` S1). If the hospital's IT says its server is reachable only
   inside the hospital, that is P5 and it is a blocker for *that* hospital
   until designed and built.
2. **The pilot is deployed from the exact commit that was tested — decided.**
   The owner approved `fb1d1d8` as the reception-pilot candidate on
   5 October. The dry run and any first deployment check out
   `fb1d1d816c8204f68fe1c0c95666baf68b0dbb76` and nothing else (`DEPLOY.md` S8).
   `main` is still the pitch release of 27 September, is **not** what a
   pilot deploys, and is not to be moved merely to tidy this up.
3. **The dry run passes on the hospital's own hardware and network** (the
   twelve steps given to the owner on 5 October: start, first administrator
   and two-step, settings to chambers, sign-in from every counter PC, a mock
   chamber, a pulled cable, two counters at once, end of day and next
   morning, backup and restore, the morning check, the operating rules,
   clocks and browsers). Nothing in this repository has run on their machine.

**Where this left the work (owner, 5 October, morning) — superseded that
evening:** feature work has resumed (above, *Now: the V1 pitch build*). What
is still true is the operational half, for a hospital that runs on its own
server. As written then: no new feature coding
until there is a hospital to deploy to: not AI import, not self-service
onboarding, not white-labelling, not ward or ER work, nothing else from the
plan. What remains is operational:

- The hospital's IT says whether its server is publicly reachable with
  HTTPS names, or reachable only inside the hospital. Certificates for the
  second are not built unless a real pilot hospital chooses it.
- Before real patients, the dry run in `DEPLOY.md` S8 is run on the actual
  hardware and network.
- If that finds a real blocker, only that is fixed, on a small branch, and
  the relevant gate is run again. The new commit then replaces the one in
  `DEPLOY.md` S8.

**When a hospital agrees to pilot, the owner is given one short deployment
sheet, and not a documentation project.** It holds: the exact commit; what
the server and network need; the environment variables and secrets; the
setup commands; setting up the first administrator; setting up a
receptionist; the dry-run steps; backup and restore; how to roll back; and
what the pilot does and does not include. Almost all of it is already in
`DEPLOY.md` Part S; the sheet is that, cut down to one page for one
hospital.

**What the go rests on, all under the production configuration** (built
apps, `DEMO_MODE=false`, the database role that owns nothing): sign-in with
one's own account; the picker listing one's own facility's chambers with
their day; a walk-in registered at the counter; doctor arrived; call; done;
late; absent; bring back; pause and resume; undo; end chamber, refused
around a patient; the ended chamber gone from the list and the next one
opened; the four counters on the console agreeing with what was done; no
screen claiming to be a demonstration; a tap reaching a second screen inside
two seconds; five actions taken with no network arriving once, in order.

**What staff have to be told on day one, because it is how the product
behaves and not a fault to be found later:**

- A new walk-in needs the server. With the server out of reach the queue
  already on screen can still be worked, and new patients go on paper.
- A browser that has been closed needs the server to sign in again.
- Nobody changes shift with a pending count showing: unsent actions belong
  to the person who took them and go when that person signs in on that PC.
- A chamber is ended by a person. Nothing ends one by itself, and an end
  cannot be taken back from the console.
- Somebody looks each morning that last night's backup is healthy and the
  API is ready. Nothing alerts anybody.
- The patient app is part of the stack and has no switch to leave it out.
  Nobody can book on it without SMS; if the hospital does not want it seen,
  its name is not pointed at the server.

**Known and deliberately left, none of them blocking this pilot** (the B
list, `PLATFORM_PLAN.md` §2): an action drawn twice for as long as its
answer is slower than its broadcast (milliseconds while SMS is only
recorded); the ward and ER boards' use of their answers; the patient side
of a chamber that passes midnight; database-level separation of hospitals
(one hospital per database until it exists).

### P4 — the pilot's own path, in the configuration it runs in (`chore/e2e-pilot-path`)

`e2e/production/reception-pilot.prod.spec.ts`, two tests, both run by
`pnpm test:e2e:prod` and so by CI's `production` job.

- **One receptionist's day, end to end.** Two chambers for today, not
  started, nobody booked — what a schedule leaves each morning. Sign in
  through `S-B-00`; the picker lists them and says they are today's; open
  the first; register a walk-in by phone, name, age and sex; she is serial
  1 and in the queue by name; doctor arrived; call; the end control is off
  while she is in the chamber; done; end the chamber with one confirmation;
  it has left the list; open the second, which is empty, not started and has
  no event in its log. The first chamber's log is exactly `WALKIN_ADDED`,
  `DOCTOR_ARRIVED`, `PATIENT_CALLED`, `PATIENT_DONE`, `SESSION_ENDED`. No
  screen on the way says it is a demonstration.
- **Late, absent, brought back, and the counters.** A chamber an hour and a
  half in. Each action changes the row and the figure it should (seen,
  waiting, late, absent), and the three events are in the log in the order
  they were pressed.

**It found nothing.** Both passed on their first run. That is the result
the step existed to get or not get: until it ran, nobody knew whether a
receptionist could do a day's work on a real server.

**Two things it needed:** the fixture can make a chamber that has not
opened (`'scheduled'`, with no bookings), and the console's four counters
have names a test can read (`count-seen`, `count-waiting`, `count-late`,
`count-no-show`). Neither changes what anybody sees.

**What it does not cover:** setting the chambers up from `S-B-11` under
this configuration (that needs an administrator with two-step; the API's
own tests cover it as the limited role, and `hospital-settings.spec.ts`
covers the screen under the demonstration); the registration desk's own
screen beyond opening it; the doctor's screen, which is outside the pilot.

### P3 — a chamber can be ended, and not around a patient (`fix/chamber-end-of-day`)

**What was wrong.** Nothing in the product ended a chamber. `POST
/sessions/:id/end` existed, no screen called it and no job did, so a chamber
stayed "running" for ever. The next morning it was still on the picker, listed
first, on a card that showed no date and no time, beside today's chamber for
the same doctor. And the route itself would end a chamber whatever the queue
held: a patient called in and not finished was left "in the chamber" for
good, in a session that takes no further action.

**What it does now.**
- **`BTN-B02-END` on the reception console**, with `MOD-B02-END`. Off, with
  its reason, while a patient is in the chamber and while there is no
  connection. With nobody left unseen, one confirmation. With patients left
  unseen (booked, waiting or late), the confirmation states how many and the
  end button stays off until a box is ticked; going back clears the tick. A
  tap on the backdrop does not close it.
- **The server refuses an end while a patient is in the chamber**
  (`canEndSession`, `QUEUE_GUARD_FAILED` / `PATIENT_IN_CHAMBER`, nothing
  written). It is the rule; the console's control being off is a courtesy. A
  counter whose screen is behind is refused, told why, and its queue is
  fetched outright (`GET /sync/session/:id`) rather than waited for on the
  socket.
- **Ending changes nobody.** Patients left unseen keep the status they had,
  in a chamber that has ended. Refund eligibility for anybody who paid and
  was not seen is raised as it always was (`FR-PAY-07`).
- **An ended chamber says so** across the console, every control on it is
  off with that reason, and it has left the picker. Its queue and its events
  are untouched.
- **The picker's cards say which day** a chamber is from and when it was due
  to start; one that is not today's says "an earlier day's chamber" and the
  date. The server says which is today, not the counter PC's clock. A
  chamber paused from the day before is listed as well as one running
  (`FR-QUE-06`): it has to be reachable to be resumed or ended.

**What it does not do:**
- **Nothing ends a chamber by itself.** A chamber nobody ends is on the
  picker the next day, now clearly marked as an earlier day's, and drops off
  the day after. Whether one should be ended automatically, and when, was
  not asked and not built.
- **An end cannot be undone from the console.** There is no toast for it;
  the confirmation is the safeguard. (Whether the server's undo route would
  take a `SESSION_ENDED` was not tried.)
- **The doctor's screen has no end control**, and is outside the pilot.
- **Unsent actions are not checked before an end.** If the counter finished
  a patient a moment ago and that has not reached the server, the server
  refuses the end (the patient is still in the chamber as far as it knows)
  and the console says so; a second try after the pending count clears goes
  through.

### P2 — the demonstration line follows the server (`fix/console-demo-banner`)

**What was wrong.** "This is a demonstration. All data here is for display
only" was a line of markup in ten console components and four of the patient
app's screens, with nothing deciding whether to draw it. Under
`DEMO_MODE=false` it would have been across the top of a real hospital's
queue.

**What it does now.** One component in each app draws it, and only when the
server has said it is a demonstration: the console from the question its
page already asks at load (`GET /demo/status`, kept in `lib/deployment.ts`),
the patient app from `GET /config` (`useDeployment`). **Until the answer
arrives nothing is said**, and the answer is not kept between page loads: an
answer from an earlier visit is a guess about this one.

**What that costs, deliberately.** A demonstration opened with no network —
the console's offline reload, plan 1.6 — has no label until the server can be
asked. The owner's rule is that the false label is the mistake that matters.

**How it is proven.** `demo-label.spec.ts`: on the demonstration the
reception queue, the registration desk and the patient app carry it; with
the server's answer held back for good, neither app shows it (**red on the
old code, two of two**). `e2e/production/`: under the production
configuration the queue, the registration desk and a patient's own serial
show no such line. The two dashboard specs that already looked for the line
on the demonstration still pass.

### Plan 1.9b — a tap stays on the screen when its answer comes first (`fix/console-ack-rollback`)

Not in the handover. Found while verifying 1.9a, by reading `useSessionQueue`
and then by measuring.

**What was wrong.** A tap is told to the server over HTTP, and the queue it
produced comes back twice: in the answer to that request, and in the
broadcast on the socket. The console shows the server's queue with its own
unsent actions folded on top. When the answer came it dropped the actions
from the fold, threw the answer's queue away, and waited for the broadcast.
The two are separate connections. On one machine the broadcast always wins,
so no test had seen the other order:

- **With the broadcast 800 ms late** (a throwaway probe, three runs of
  three): ১ → ২ at about 80 ms, **back to ১ at about 190 ms**, ২ again at
  about 990 ms.
- **With the socket saying nothing** (the new test, on the console as it
  was, three of three): the tap was answered, and the console sat on ১ for
  the ten seconds the test waited. A socket that is reconnecting, or stalled
  without having closed, does this on a real network for as long as it
  lasts, and a tap made meanwhile acts on the queue before the last tap.

**It was a document not being followed.** `BACKEND.md` `SY-05` puts the
queue in the answer, and `FRONTEND.md` §11.1 step 4 says to reconcile with
it. `lib/sync.ts` kept `accepted` and `conflicts` and dropped the rest.

**What it does now.** The answer's queue is folded into the session channel
by the same rule a broadcast is (`foldUpdate`: the newest sequence wins, so
neither road can put the screen behind the other), in the same redraw that
takes the answered actions out of the fold. `OfflineQueue.flush` hands the
answer back as `update` (the newest, when a batch had to go one entry at a
time); `openSessionChannel` has `fold`; the hook does both in one step.
Nothing changed in the API. By reading, not by a test of its own: the
answer's queue goes through the same `onSnapshot` a broadcast does, so it is
also what is kept for an offline reload.

**How it is proven.** `queue.test.ts` (four tests, red before). And
`offline-console.spec.ts` holds everything the server says on the socket at
a gate, taps *next*, and requires ২ and never ১ again: **red three of three
on the console as it was, green since**. It runs against the production
configuration too.

**What it does not do:**
- **The ward board and the ER console have the same shape. Read from the
  code, not measured.** `useBedBoard` and `useEmergencyConsole` drop the
  optimistic change when the write is answered and then read the board
  again; until that read or the broadcast lands, the tile should show the
  bed before the action. `BACKEND.md` says a bed write returns the beds "so a
  console can reconcile without waiting for the broadcast", and `bedSender`
  discards them. A bed has no sequence number to say which of two answers is
  newer, so that fix needs a rule this one did not: its own branch.
- **An action is folded twice while its answer is slower than its
  broadcast. Read from the code, not measured.** This is the usual order,
  for a few milliseconds on every tap: the broadcast arrives with the action
  in it, and the console folds its still-unanswered copy on top again (the
  reducer skips an event by sequence number, and an unanswered action has
  only a provisional one). For *next* the second fold should change nothing
  visible. For a delay or a late mark it would show double until the answer
  comes. It matters more than a few milliseconds because **the answer waits
  for the messages to be sent** (`appendBatch` awaits
  `notifications.dispatch` before it returns): with a real SMS provider
  behind the adapter, the answer trails the broadcast by as long as the
  provider takes. Plan 2.1 (sending from a worker) removes that wait. Closing
  it properly needs the broadcast to name the actions it holds, which is a
  change to `BACKEND.md` §6 and so the owner's to agree.
- **An answer lost after the server committed** is still covered only by the
  retry: the push goes again with the same keys and is answered then
  (`SY-02`).

### Plan 1.9a — a key is answered by the screen as it stands (`fix/console-key-race`)

Not in the handover. Found by CI's third run of the browser suite
(37161163568, 3 October): `pause-resume.spec.ts:90` pressed N the instant the
break ended on screen, was told "a break is in progress", and nobody was
called.

**What was wrong.** The reception console listened for its shortcuts in an
effect that took the old listener off and put the new one on after each
redraw. React runs such an effect after the page has changed and may leave a
frame between the two; a key pressed in that frame was answered by the screen
before it. The frame followed every redraw, and the console redraws at least
once a second, so it was not only the pause: any shortcut pressed as the queue
moved could act on the queue before it moved.

**What it does now.** `useWindowKeydown` (`@platform/ui`, `a11y/keys.ts`) is
the one way a screen listens for keys. The listener goes on once; what it
calls is changed inside the redraw itself (a layout effect), in the same task
as the change to the page. The reception console and the bed panel both use
it. The bed panel's Esc had the same shape and no fault that could be reached
today; it moved so there is one way to do this, and it had no browser test,
so it has one now.

**How it is proven.**
- `keys.test.tsx` presses a key between the redraw and the effects that
  follow it, where the old listener answered `paused` for a screen showing
  `running`, and where a screen that had just gone still answered.
- `pause-resume.spec.ts` has the page itself press N the moment the banner
  leaves it. **Six of six failed on the console as it was, with CI's exact
  symptom; six of six pass with the fix**, and nothing else changed between
  them. The older test, which waits and then presses, is kept as it was.
- The gate, on the branch before merging (5 October): `pnpm verify`; the
  browser suite 153 of 153, the canary among them; the built console 3 of 3;
  the production configuration 21 of 21, where the new test also runs
  against the console as built.

**Found on the way: the queue stepped back when a tap's answer beat its
broadcast.** Measured here with a throwaway probe and fixed in the next
branch, `fix/console-ack-rollback` (above, *Plan 1.9b*, which has the
measurements and what is still left).

### Plan 1.9 — what a message leaves behind (`fix/log-sms-redaction`)

An SMS from this product is addressed to a patient's phone, names their
serial, and for a booking carries the tracking link — which opens that
booking's queue, its signed record and its reports (`FR-GST-05`). Three
places kept all of that. None does now.

- **The server's log.** `SMS_PROVIDER=log` printed the number and the whole
  text with `console.log`, past the logger's redaction. That is also what a
  hospital's server runs until an aggregator exists, so working links and
  phone numbers were going into container logs that are kept and backed up.
  It now writes one line: which notification, which template, how many
  segments.
- **The process.** The same provider kept every message in an array nothing
  cleared. Gone; tests that want to read what was sent use
  `__tests__/support/recordingSms.ts`.
- **The database.** The link was in every confirmation's row twice, as
  `params.link` and inside `params.body`, beside the hash that was supposed
  to be the only trace of it. Now every outbox row is written by one function
  (`notification.service` `writeOutbox`), which composes the message twice:
  in full for the provider, and for the row with `{link}` left where the link
  went. Migration 0035 removes the links already stored and adds
  `notifications_no_stored_link`, so PostgreSQL refuses the next one whatever
  the code does.

**The patient still gets the link.** `smsRedaction.test.ts` proves that
first, because a fix that dropped it would pass every other assertion.

**The 90-day rule is enforced for the first time.** `DATABASE.md` §8 always
said a message's body is kept 90 days and its metadata longer; nothing did
it. The API's hourly job now reduces `params` to the ids a message was about
(`clearExpiredBodies`), found through a partial index that a cleared row
leaves, so the job reads only what is still to do.

**What it does not do:**
- **`log` still marks a message `sent`.** Nothing sent it. The demonstration
  depends on that state, and it becomes true the day an aggregator is behind
  the adapter (2.2); until then "sent" on a hospital's server means
  "recorded".
- **A sender that works from the row cannot send a link.** Today the full
  text is held in memory from the commit to the send, inside the request.
  Plan 2.1 moves sending to a worker that reads rows, and a row no longer
  has the link: that worker has to issue a fresh link when it sends (for a
  booking, `issueTrackingLink` writes a new `guest_links` row; how the
  standby, bed and emergency links are issued was not read for this step).
  That is 2.1's first design question.
- **The constraint cannot see a link pasted into the text** under another
  name. Only the single write path and its tests cover that.
- **The rest of §8's retention table has no job**: guest links 30 days after
  the session, unclaimed guest records after 24 months.

**Before this reaches the deployed demo:** apply 0035 to Supabase with the
release (it rewrites the rows already there; it needs nothing from the API).

**Found by this branch's gate, and fixed in it:** `consent.routes.test.ts`
failed two tests in one full run and passed alone. It takes "the
account-owned profile the fewest facilities have treated" as the patient a
guest's link must *not* reach, and which profile that is depends on what
every earlier test file booked; that run it was the fixture's own first
patient, and the API rightly answered 200. The product was right. The
profile is now chosen from outside the fixture. **A test that needs "somebody
else" has to choose them as somebody else, not as whoever a ranking returns.**

### Plan 1.8 — the browser suite in CI, and against production (`chore/e2e-ci`)

**What CI runs now** (`.github/workflows/ci.yml`), on every push to `mvp` or
`main` and every pull request into them:

| Job | What |
|---|---|
| `verify` | as before: typecheck, lint, format, unit, API and schema tests |
| `browser` | `pnpm build`; **the canary, first and alone**; the whole browser suite; the console as built |
| `production` | the canary and the counter against the production configuration |

The canary can no longer be skipped by not running it.

**The production configuration** (`playwright.prod.config.ts`,
**`pnpm test:e2e:prod`**) is what a hospital runs, and nothing had driven a
browser against it before: the API with `NODE_ENV=production` and
`DEMO_MODE=false`, started as the container starts it, connected as the role
that owns nothing (plan 1.7), no online payment, SMS recorded only; the
console and the patient app as `next build` and `next start`. What runs there:

- `e2e/production/two-device-queue.prod.spec.ts` — the receptionist **signs in
  through `S-B-00`** with their own account, taps *next*, and the patient's
  phone shows it inside the same two seconds as the canary. It first checks
  that what is running really is production (`/config` says no
  demonstration, no online payment, phone check on; the password-less
  picker's endpoint answers 403).
- The counter's own specs, unchanged in what they assert: offline and the
  outbox, undo, pause and resume, and the console opening with no network.

**What it found.** Under the production configuration a token written into
the browser is not a session: the console showed the sign-in screen to all
seventeen reception tests. That is correct, and it is why the specs now get
their receptionist through one helper (`e2e/support/consoleSession.ts`) — the
picker's store under the demonstration, exactly as before, and a real
`POST /staff/login` under production.

**What it cannot do, and this is the product, not the test.** Under the
production configuration **no patient can book**: a guest proves their phone
with a code, the code travels by SMS, and there is no SMS provider (item 1
above; phase 2). So the patient's link in these specs is written by a fixture
— the row an SMS would have pointed at (`e2e/support/guestLink.ts`) — and
everything from opening it onward is the product. The production canary says
so at the top of its file and should book through the app the day an SMS
provider exists. **A green production job does not mean a patient can use a
hospital's server.**

**Left to the main suite, and why** (`grepInvert` in the production
configuration): the pitch session, which is the demonstration's own
(`FR-DEM-06`); and "the next person at the same PC", which needs a second
account signed in and does not yet do it.

**The first run on GitHub** (37156815719, the push of `4ece550`, 3 October).
The workflow itself works: all three jobs started, built and ran.

| Job | Result |
|---|---|
| `verify` | passed |
| `production` | passed — the canary and the counter against the production configuration |
| `browser` | build passed; **the canary passed on a hosted runner**, inside its two seconds; the whole suite **144 of 150 in 11.6 minutes** (18.1 here) |

The six failures were two faults in the suite, both shown by a faster
machine and neither in the product (`fix/e2e-fast-runner`; below, *Things
learned the hard way*):

- **Five in `wallet.spec.ts`: the booking was refused.** `/guest/start`
  allows 30 calls per address in a fixed ten-minute window. Every patient in
  the suite books from one address, and the runner got 31 of them into one
  window; here the suite is slow enough that it never has. The API now reads
  `ADDRESS_RATE_LIMIT_FACTOR` (default 1, so nothing changes for anybody who
  does not set it) and the browser suite sets it, saying what it is: one
  machine standing for every patient. See decision 90 for what this means for
  a real hospital.
- **One in `ward-board.spec.ts`: a fixture's ward name was taken**
  (`wards_hospital_name_key`). The fixture names its ward with a
  four-character random tag. It now takes another name when one is taken.
  **Why two of the first four wards in a run shared a tag is not
  established**: by chance it is about one run in twenty thousand, and the
  job's log cannot be read without signing in. If it recurs, the fixture now
  survives it and the cause is still worth finding.

**The second run** (37159673893, `3c15bb8`, with `fix/e2e-fast-runner`):
the `browser` job passed whole on GitHub's runner — the canary, all the
browser tests and the built console — and so did `production`. `verify`
failed, on two tests in `consent.routes.test.ts` that passed here twenty
minutes earlier on the same code: a test that chose its "other patient" by a
ranking (below, *Plan 1.9*, *Found by this branch's gate*). Fixed in
`fix/log-sms-redaction`, merged as `36d5ca2`.

**The third run** (37161163568, `36d5ca2`, with plan 1.9): `verify` and
`production` passed; the canary passed; the browser suite **150 of 151 in
10.9 minutes**. The one failure, `pause-resume.spec.ts:90`, is in the
console and not in the suite: **N pressed the instant the pause banner went
was answered "a break is in progress"** and nobody was called. The console
re-attached its key listener in an effect that ran after the screen had
been redrawn, so for about a frame a key was handled against the state before
it. Fixed in `fix/console-key-race` (above, *Plan 1.9a*).

**The runs of 5 October.** `d1ca84a` (1.9a): all three jobs passed, the
first run to do so. `97bfdae` (1.9b and the documents): **shown as failed,
and was not a test failure.** `verify` passed; the `browser` and `production`
jobs were cancelled by the next push to `mvp`, made while they were still
running, which is exactly what `CLAUDE.md` §3.1 says not to do. `8186353`
(P2, which contains everything in `97bfdae`): all three passed. `c4db8ee`
(P3): all three passed. The push that carries P4 was held until that run had
finished.

A run's jobs and its failure messages can be read without signing in, at
`api.github.com/repos/SidratEvan/HealthCare/actions/runs/<id>/jobs` and
`…/check-runs/<job id>/annotations`. `gh` is not installed on this machine.

### Plan 1.7 — the self-hosted stack, hardened (`chore/ops-hardening`)

Nothing here changes what a patient or a receptionist sees. It changes what
happens when something goes wrong on a hospital's server.

**The API no longer owns the database.** Two roles (`DATABASE.md` §5.1): the
owner runs the migrations and the backups; the API connects as its own role,
made by `pnpm db:role` after every migration. That role reads and writes rows.
It cannot change the schema, empty a table, create a role, read a file off the
server, or switch off the guard on the event log — and it cannot change or
remove an audit row, which until now nothing in the database prevented.
`backend/api/src/__tests__/apiRole.test.ts` is the list, each one refused by
PostgreSQL itself. **The whole API suite now runs as an identical role**
(`env.setup.ts`), so every endpoint is tested without ownership: the first run
found exactly one thing the API could not do — refresh the dashboard's
materialised view, which only an owner may — and migration 0034 gives it a
function that does that one thing.

**What that role still has that it should not: `BYPASSRLS`.** Every table has
row-level security switched on and no policy, which for anybody but the owner
means "sees nothing". The policies are plan 1.10, which removes the attribute.
Until then **the database does not separate hospitals**; the API's checks do,
as before. Do not describe 1.7 as tenant isolation.

**Nothing of ours runs as root.** The API and both web apps run as `node`.
The database, Caddy and the backup run as their images ship them. Found on
the first boot and fixed: pnpm 12 re-checks the installed dependencies before
every `pnpm run`, re-marking files it does not own, and stopped the
migrations before they began (`pnpm_config_verify_deps_before_run=false` in
the image). A unit test would never have shown it.

**A backup is not counted until it has been proven.** Each night: dump,
**restore the dump into a scratch database** and compare it with what the live
one held, read the files archive back, copy both to a second location and
check their checksums there. Each run writes its result down, and
`backup.sh check` — the backup container's health check — is failing the next
morning if the run failed, if no second location is configured, or if the
last good backup is more than 26 hours old. The old script could not fail:
called on the left of `||`, `set -e` is off, and a failed `pg_dump` was
followed by "backup written".

**Logs rotate** (five files of ten megabytes per container), and **each
service reports its health**: the API's is `/readyz`, so it is unhealthy while
it cannot reach the database, and the web apps and Caddy wait for it.

**Proven on the real stack, on this machine, not only in tests:** built from
clean and started with one command; the API connected as the limited role and
ready; the first administrator made by `pnpm staff:create` as that role; a
backup taken, restored into scratch, copied and reported healthy; then every
volume and the local backups deleted, the backup brought back **from the
second location**, restored onto the empty server — the hospital, its
administrator and an uploaded file were all there, and the API came up as the
limited role again.

**What it does not do:**
- **Nothing alerts anybody.** A failed backup or an unready API is visible in
  `docker compose ps` and nowhere else. Until an alert exists somebody has to
  look each morning. An SMS alert waits on an aggregator (decision D1).
- **It cannot tell whether the second location is really another disk.** A
  folder on the same disk satisfies it. `DEPLOY.md` says so.
- **The demonstration deployment is unchanged**: on Supabase the API still
  connects as the owner. The role is for a hospital's own server.
- **Development is unchanged**: `pnpm dev:api` uses `DATABASE_URL` as it
  always did. The limited role is exercised by `pnpm test`, not by `pnpm dev`
  or the browser suite; plan 1.8's production-configuration job is where the
  browser suite should meet it.

**For whoever updates a server first started before this:** `DEPLOY.md` §S4 —
three values to add to `deploy/.env` and one command to hand the uploaded
files to the account the API now runs as.

### Plan 1.6 — the console opens with no network (`feat/console-offline-load`)

**What happens now.** A counter that reloads during an outage gets the
console back: the shell from the service worker's cache
(`frontend/console/public/sw.js`), the queue as this device was last told it
(`snapshots` in the per-person database), and whatever it had queued
(plan 1.5). The offline block says it is offline and the freshness line gives
the real age of what is shown, from the server's own timestamp. Taps are
queued and sent on reconnect, as before.

**What it does not do, and each is a decision rather than an accident:**
- **Only the tab that was signed in.** The sign-in is in `sessionStorage`
  (step 21), which survives a reload and a discarded tab and nothing else. A
  browser restarted after a power cut is signed out, and signing in needs the
  server. The unsent actions still wait on disk and go when that person signs
  in again.
- **No names.** The kept queue is the reduced state: serials, statuses, times,
  ids. Names come from a separate, audited read (`DB-P7`) and are not kept on
  the device, so an offline reload shows a queue of serials until the
  connection returns. Keeping them is a small change and puts patient names in
  a counter PC's browser storage — **the owner's call (decision 88)**.
- **The reception queue only.** The ward board and the ER console open their
  shell and keep their outboxes; they do not keep their last board, and say
  the board could not load. Their boards carry more about patients than a
  queue does, so they wait on the same decision.
- **A chamber never opened on this device** has nothing kept, and says so.
- **Kept for 24 hours**, then dropped (`SY-06`).

**It cannot be shown under `next dev`.** The development client will not
start the app until it has heard from its dev server over a websocket; an
offline reload there loads every cached file and stays blank. The same test
passes in three seconds against `next build`. So `e2e/built/` has its own
configuration (`playwright.built.config.ts`, **`pnpm test:e2e:built`**): the
API as usual, the console built and served on its usual port (the API answers
two browser origins and a test is not a reason for a third), no patient app.
It is part of the gate. Plan 1.8 extends it to the canary and the reception
specs against the production configuration.

**Tried and set aside:** running the whole console suite against the build.
Forty-nine of fifty specs passed as they were; `console-cold-start.spec.ts:98`
is written around React's development double-mount ("four slow answers, not
two") and needs rewriting first. That, and whether the suite should move to
built apps at all — it would also take about 2 GB off a run — stays with 1.8.

### Plan 1.5 — the outboxes are kept on the device (`fix/offline-outbox-persist`)

**What a counter now keeps.** The reception queue's, the ward board's and the
ER console's unsent actions are in IndexedDB (`@platform/client`
`openConsoleStores`), not in the page's memory. Reload, close the tab, lose
power: when the console is opened again they are on the screen, counted, and
sent by themselves — in order, once. `createDexieStore` had been written and
never called (decision 37).

**One database per signed-in person** (`healthcare-console-<staff id>`, from
the token's `sub`). A queued action is sent later under whatever token the
console then holds, and the server attributes it to that token
(`FR-QUE-04`), so a shared database would have let the evening receptionist's
sign-in send the afternoon's unsent work as her own. Now it is neither shown
to her nor sent by her; it waits for its owner to sign in on that PC again.
**What follows from that, deliberately:** work left unsent by somebody who
never signs in on that PC again is never sent, and nothing tells anybody.
A sign-out that warns "you have unsent actions" is the obvious next step and
is not built.

**What is on the disk, and for how long.** Each row is the action as it will
be sent. Queue actions carry booking ids. A bed admit carries the patient's
name, phone, age and sex; an ER walk-in registered offline carries that
person's age, sex and phone. Rows are deleted the moment the server takes or refuses them; until
then they are unencrypted in the browser's storage on that PC, readable by
anybody with the Windows account. `FRONTEND.md` §9 always named Dexie for
this; it is new only because the code never did it.

**A poison entry no longer blocks the queue.** Three answers are now told
apart (`FRONTEND.md` §11.1): never arrived, or "not now" (401, 403, 429) —
kept, in order, however long; refused by a rule — removed and rolled back, as
before; **the server could not take it** (another 4xx, a 5xx) — the batch is
sent again one entry at a time, and the one that cannot go is set aside as
*stuck*: at once for a 4xx, after eight tries for a 5xx. A stuck entry is
rolled back on screen and the offline block says how many there are, with
**আবার পাঠান** and **বাদ দিন**. Being offline never counts.

**Found on the way, and fixed here because this branch exposed them:**
- **A ward or ER action was dropped by an expired token.** The senders read
  any answer below 500 as "refused", so twenty minutes offline, a 401 on
  reconnect, and every queued bed action was removed and rolled back. 401 and
  429 now leave it queued.
- **Nothing retried a failed push** while the socket stayed up; it waited for
  somebody's next tap. `FRONTEND.md` §11.1 said "retry with backoff" and
  `retryDelayMs` existed with no caller. The three hooks now retry by timer.
- **The bed panel closed the next step's form.** `BedPanel` went back to its
  first view only *after* the server answered, so release followed quickly by
  "out of service" had the reason field closed under the typist when the
  release's answer arrived. Keeping the outbox on disk made each action a few
  milliseconds slower and `ward-board.spec.ts` caught it. It now goes back
  before sending.

**Learned about the tests.** Playwright's `setOffline` is lifted as a page
closes: the dying page sees itself come online and sends its queue. A test
that closed the tab "offline" passed against an outbox that kept nothing.
Blocking the route for the whole browser context is what a power cut looks
like (`offline-console.spec.ts`). **And a blocked route leaks the same way**
(`fix/e2e-outbox-close-race`): Playwright pauses a request to ask the route
what to do, and a page closed while one is paused lets it through. The first
full run after the merge failed on exactly that — the tab was closed with the
third tap's push still on its way, and the server had six events from a tab
whose "power" had been cut. The specs now close or reload only after the push
holding everything taken so far has been refused (`pushFailed`), which leaves
a second before the console's next attempt. The product was right throughout:
a push that does land twice is the same events with the same keys (`SY-02`).

**Not in this step.** Opening the console with no network (1.6). Offline
walk-ins and standby offers still need a connection, as before. The doctor,
lab, pharmacy, admin, settings and import screens are online-only, as before.

### The platform plan (`chore/platform-plan`, 2 October)

The owner gave an implementation brief on 2 October (a PDF, kept outside the
repository): the product is to become a platform a hospital can join by
itself — create an organisation, set up by hand or import, be verified, go
live — with the handover's blockers fixed first and one narrow use of AI,
mapping a hospital's own export onto the import template.

`docs/PLATFORM_PLAN.md` is that brief turned into an order of work. A new
session reads it after this file. What it holds: the branches of phases 1–4
with the test each must fail first; the smallest state model for onboarding
(one migration); exactly what a model is and is not sent; the existing code
each phase reuses; eight places the brief, the code and the documents
disagree and how each is handled; and the eight decisions that are the
owner's, with which branch each one blocks. `CLAUDE.md` §4.3 points at it.

**The owner's decisions it waits on** (its §7): the SMS aggregator (blocks
only `feat/sms-live`), open or invited signup and the registration fields
(block `feat/org-signup`), CSV-only or XLSX and the model provider (block
`feat/import-mapping-ai`). Phase 1 waits on none.

### Handover audit — what the code actually does (`chore/handover`, 2 October)

The owner asked for a complete, critical handover read from the code rather
than the plans. It is `docs/HANDOVER.md` (16 sections: system map, database,
queue engine with a worked 10-patient example, auth, records, offline,
modules, payments and notifications, deployment, tests, ranked debt,
readiness per module, what lives outside the repo, a crash course, and a
final assessment). **Found, each to be its own `fix/*` branch** (marked
below as it lands):

1. **CRITICAL — no SMS adapter, so no patient can book on a real server.**
   With `DEMO_MODE=false` booking needs a phone code; `SMS_PROVIDER` offers
   only `log` (withholds the code) and an adapter that fails every send.
   Walk-ins get no tracking link. `DEPLOY.md` S2/S6 imply otherwise.
2. **Fixed (`fix/console-resume`, decision 87).** Was: **CRITICAL — the
   console can pause a chamber and cannot resume it.** No Resume control
   existed; a paused session refuses *call next*.
3. **Fixed (`fix/delay-on-arrival`, decision 86).** Was: **CRITICAL — a
   delay declared before the doctor arrives is never consumed.** After arrival the ETA baseline is still `now + delayMinutes`
   (`eta.ts`); reproduced: the patient at the front told 18:20 while
   absent-marking was allowed at 18:06.
4. **Fixed (`fix/console-undo`).** Was: **HIGH — the console's Undo sends a
   booking id as `undoneEventId`;** it does nothing and leaves a junk
   `ACTION_UNDONE` in the log. (The sync path still *accepts* an
   `ACTION_UNDONE`; closing that is item 5.)
5. **Fixed (`fix/sync-event-allowlist`).** Was: **HIGH — `/sync/events`
   accepts all 19 event types** from any console role,
   including unguarded `ACTION_UNDONE` (any event, any age), `SLOT_*`,
   `BOOKING_CANCELLED` and `SESSION_ENDED` (no refund eligibility on this path).
6. **Fixed (`fix/offline-outbox-persist`, `feat/console-offline-load`): the
   outboxes are kept on disk and the console has a service worker.** Was: **HIGH — offline
   outboxes are memory-only** (`createDexieStore` has no caller; the comment
   saying it is swapped in is wrong) and the console has no service worker.
7. **Half fixed (`chore/ops-hardening`): on self-host the API connects as
   its own role, not the owner.** Still **HIGH — RLS has no policies anywhere**
   (no `CREATE POLICY` in any migration; `0014_rls.sql` never existed, against
   decision 3's note), so that role carries `BYPASSRLS` and tenancy is
   application code only. Plan 1.10.
8. **HIGH — doctors read every hospital's signed visits** for any patient with
   any booking at their hospital, without consent (`findVisits`).
9. **Fixed (`chore/e2e-ci`).** Was: **HIGH — E2E (the canary included) is not
   in CI** and never runs against the production configuration.
   ~~Backups stay on the same disk~~
   (fixed, `chore/ops-hardening`: copied to a second location, and failing
   loudly when none is configured); ~~the `log`
   SMS provider prints phones and full bodies (tracking links) and keeps them
   in memory forever~~ (fixed, `fix/log-sms-redaction`).

The rest (~~broadcast before commit~~ (fixed, `fix/broadcast-after-commit`),
~~links stored in `notifications.params`~~ (fixed, `fix/log-sms-redaction`),
no worker, mutable `audit_log`, sockets not revoked, single-process limits,
non-idempotent booking, ~~root containers, no log rotation~~ (fixed,
`chore/ops-hardening`; `audit_log` can no longer be changed by the API's
role on self-host), no monitoring) is
ranked in `HANDOVER.md` §12. **Documents to correct** are listed in §14.3;
they were not edited on this branch (`CLAUDE.md` §2: proposed to the owner
first).

### Security review — four holes found and closed (`chore/security-review`, then `fix/*`)

The whole codebase, not only what changed since `main`: every route and its
guard, the service behind every `:id`, the socket, tokens, passwords and
two-step, SQL, file storage, webhooks, logging, both frontends, the self-host
stack, RLS. The method is `/security-review`'s: a finding stays only if a
second, independent read of the code scores it 8/10 or more. **Each fix is
its own `fix/*` branch with tests**, marked below as it lands.

**Found, in the order to fix them:**

1. **Fixed (`fix/visit-doctor-only`).** `POST /visits` now needs the doctor
   role (route and service), a signed visit is final (`VISIT_ALREADY_SIGNED`;
   the conflict update runs only `WHERE signed_at IS NULL`), and a sign sent
   again replays only the queue step. Tests for every other role, for an edit
   after signing, and for a sign whose queue step was lost. Was: **any staff
   role can write — and rewrite — a visit record** (9/10, Medium–High). `POST /visits` checks only that the caller is staff at the
   booking's hospital (`clinical.routes.ts:54`, `clinical.service.ts:140`), so
   a receptionist, pharmacy, lab or ward account can sign a diagnosis that the
   wallet shows under the session's doctor. Worse, a later `sign: false` save
   overwrites a *signed* record and keeps its signing time
   (`clinical.repo.ts:405`), so any doctor at the hospital can rewrite a
   colleague's signed visit, unaudited. `BACKEND.md` §7.6 says doctor. Fix:
   `requireRole('doctor')` and the same check in `saveVisit`; update only
   `WHERE signed_at IS NULL`; tests for every non-doctor role.
2. **Fixed (`fix/standby-phone-proof`; its limit closed by item 3).** Standby
   join and bed requests now run `assertGuestPhoneProven`, as a guest booking
   does, so the dedupe that answers with an existing place or request is
   reached only by the number's proven owner. The patient app proves the phone
   on all three forms through one hook (`useGuestPhoneProof`) and one card
   (`GuestCodeCard`); `guest-phone-proof.spec.ts` drives each form through a
   real code. **The limit, now closed:** until item 3, `/guest/start` handed a
   returning number a token without a code, and that token passed this check
   too. Was: **a standby
   place can be taken over with a name and a phone number** (8/10, Medium,
   High at worst). `POST /sessions/:id/standby` asks for no code,
   and joining again with the same phone and name returns the existing place
   with a fresh token (`standby.service.ts:118`, `:158`). That token leaves,
   declines or accepts; after seating, the first status read mints the
   booking's tracking link, which opens that visit's signed record and lab
   reports. `FR-GST-03` already requires the code here (money and an SMS
   thread follow). Fix: `assertGuestPhoneProven` on the join, as booking has;
   never hand a token for an existing row to an unproven caller. Bed requests
   repeat the pattern read-only (`bed.service.ts:485`; 6/10, not counted) and
   take the same fix.
3. **Fixed (`fix/guest-booking-scope`, then `fix/guest-device-proof`).** A
   guest token now acts only on the booking it names: `ownsBooking` and the
   socket's room check dropped their guest-identity branch, and `/late` has
   `requireBookingScope` as cancel does. And, by the ruling on decision 85, a
   number proves itself once **per device**: `/guest/verify` also returns a
   device proof (`guest-device` audience, bound to the number's identity and
   the device's user agent, 90 days, renewed on use), which the app keeps per
   number (`lib/guestDevice.ts`); `/guest/start` skips the code only for it.
   Anybody typing the number elsewhere is sent a code — which also closes the
   limit noted on item 2. Was: **a returning guest's number is
   trusted without a code** (8/10, Medium–High). `POST /guest/start` gives a guest token to anybody who types
   a number that has passed a code once (`patientAuth.service.ts:311`). With
   it: book as that person; learn which chambers they are booked into, because
   the socket admits a guest by identity rather than by booking
   (`booking.repo.ts:466`, contrary to the comment on
   `principalHoldsBooking`) and session ids are public; mark their bookings
   late (`POST /bookings/:id/late` has no `requireBookingScope`, and
   `ownsBooking` admits by `guestId`, `queue.controller.ts:612`). A forwarded
   tracking link has the same identity-wide reach, against `FR-GST-05`'s
   "single-booking scoped". **Waits on decision 85**, because `BACKEND.md`
   §7.1 documents the skip. The scoping half (admit a guest by the booking its
   token names; `requireBookingScope` on `/late`) needs no ruling.
4. **Fixed (`fix/booking-payments-scope`).** The read now has the fence
   `GET /bookings/:id` has — `requireBookingScope` on the route,
   `assertBookingScope` in the controller — and an auth matrix: the link and
   the hospital's staff read it; another booking's link, another account,
   another hospital's staff and a national account do not. Was:
   **`GET /bookings/:id/payments` checks only that somebody is signed in**
   (9/10, Low). Any patient, guest link, national account or staff member of
   any hospital reads any booking's payments, and every patient in a chamber
   holds every booking id there through the queue state. No names, so low; the
   route's comment promises a guard that is not there. Fix:
   `assertBookingScope` in the controller, or delete the route — no client
   calls it.

**Below the bar, noted:** the socket handshake does not apply the `mcp` and
`tfa: 'setup'` limits `attachPrincipal` does (`realtime/auth.ts`) — no gain
today, since such a token can already set its own password or authenticator;
the sync batch lets a doctor or administrator push reception-only event types
at their own hospital (**closed by `fix/sync-event-allowlist`**); two guest tokens with no booking count as one actor for
undo (`queue.controller.ts:551`).

**Checked and sound:** staff sign-in (scrypt, lockout shared with two-step,
refresh rotation and reuse detection, each code spent once); the roles an
administrator can grant (facility roles, own facility); hospital scope on
every bed, ER case, referral, lab order, import and settings write; consent
(the patient offers, a doctor redeems); tracking links (one booking, reports
scoped to it); file serving (signed, key built by the server, path confined,
PDF and images only); webhooks (fail closed); SQL (parameterised
throughout); the CSV export (formulas neutralised); logs (no bodies,
credentials redacted, sign-in codes withheld); CORS; the demo picker (refuses
with `DEMO_MODE` off); RLS on all 55 tables; the self-host stack (database not
published, secrets enforced). The counter's phone lookup reads platform-wide
by design (`BACKEND.md` §7.3) and is audited.

### Step 28 — an administrator signs in with a code from their phone (`feat/staff-2fa`)

**What a real deployment now does.** An administrator (`hospital_admin`,
`platform_admin` — `TWO_FACTOR_REQUIRED_ROLES`) signs in with the password
once more and meets `S-B-00d` before any console: an authenticator app scans
the QR code (or the key is typed), the code it shows turns two-step on, and ten
recovery codes are shown once; the console opens only after "I have kept
these". Until then the token carries `tfa: 'setup'` and the API refuses it
everywhere but the setup (`AUTH_2FA_SETUP_REQUIRED`) — the server's rule, as
the password change's is. From then on a right password gets a five-minute
challenge and no tokens, and `S-B-00b` asks for the code (or a recovery code,
same field). Anybody else may turn it on from the picker (`/?view=2fa`), and
the picker warns at three recovery codes or fewer. A lost phone: a recovery
code once, an administrator's **দুই ধাপের যাচাই রিসেট করুন** on `S-B-11`, or
`pnpm staff:reset-2fa` on the server for a facility's only administrator —
all audited, all ending every session of the account.

**How it holds.** TOTP from `node:crypto` (no dependency), RFC 6238's
reference codes in `totp.test.ts`. The secret is sealed with AES-256-GCM under
`TOTP_ENCRYPTION_KEY`, so a database backup alone cannot mint codes; recovery
codes are HMACs under the same key. A code works once (`totp_last_step`); wrong
codes count towards the password's lock, and a right password does not clear
the count — otherwise a known password would buy unlimited guesses at the
code, five at a time. The only new dependency is `qrcode` in the console,
approved 2026-09-29; the QR is drawn in the browser, so the secret goes to no
image service.

**Before this reaches the deployed demo:** apply 0033 to Supabase
(`ALLOW_REMOTE_DB=1 pnpm db:migrate`) before the API deploys — every staff
sign-in reads the new columns. The demo needs no new variable: outside
production the key is derived from `JWT_REFRESH_SECRET`. A real server must set
`TOTP_ENCRYPTION_KEY` (production refuses to start without it), and a restore
needs the same value (`DEPLOY.md` S2, S7).

**On the demo, worth knowing.** The picker is unchanged. But signing in *with
a password* as a seeded administrator now sets up two-step first, and whoever
does it on the shared demo holds that account until the next `db:reset` or
`pnpm staff:reset-2fa --email …`. Receptionists and the other roles are not
asked.

### Step 26 — the whole stack on a hospital's own server (`chore/self-host`)

**What exists.** A root `Dockerfile` (targets `api`, `console`, `patient`)
and `deploy/docker-compose.yml`: PostGIS, a one-shot `migrate`, the API
(with the hourly jobs), the two apps, Caddy for three names with automatic
certificates, and a nightly `backup` (database dump and the files volume,
`BACKUP_KEEP_DAYS` kept) with `restore.sh` to put one back. `DEPLOY.md`
**Part S** is the runbook: configure `deploy/.env`, one `up`, `staff:create`
for the first administrator, `doctor:verify`, backups off the machine.
**Proved on this machine (2026-09-29).** From a clean project and empty volumes: one `up --build` built the three images (about fifteen minutes cold) and started everything; the migrations applied all 30; `/healthz`, `GET /config` (`demo: false, onlinePayments: false, guestPhoneCheck: true`), the console and the patient app answered through Caddy; `staff:create` made the facility and its administrator, who signed in. A backup was taken, an account and a file were added after it, and `restore.sh` put the backup back: the later account and file were gone, the earlier file was back, the API healthy, the migrations up to date. `db:reset` in the API container refused (`DEMO_MODE is not true`). The first attempt failed on a real race — the database health check passed on Postgres's temporary first-boot server — and the check now goes over TCP.

**What had to change for a real server to boot at all.** `NODE_ENV=production`
refused anything but a live payment provider (which needs merchant accounts
nobody has yet), Supabase storage, a Sentry DSN and VAPID keys — the last two
wired to nothing. Now:
- **`STORAGE_PROVIDER=local`** keeps files on the server's disk
  (`LocalStorageAdapter`, a named volume), served through the same signed,
  expiring links; a key that would leave the directory is refused.
- **`PAYMENT_PROVIDER=off`**: pay at the hospital only. The API refuses an
  online method before writing anything (`PAYMENT_UNAVAILABLE`), and the
  patient app asks `GET /config` and offers only the counter, and no standby
  prepayment. Production accepts `off` or `live`, never `mock`.
- **Sentry and VAPID are no longer demanded** until something uses them; a
  self-hosted server's errors are in its container logs.
- `db:seed`/`db:reset` already refuse without `DEMO_MODE=true`, so the
  migration guard treating host `db` as local is not a way to wipe a
  hospital's data.

**Decided here, worth the owner's eye.** The patient app, the console and the
API are three names (`app.`, `console.`, `api.`), not paths under one, because
the apps are separate Next deployments with their own origins (CORS lists
them). Backups land in `deploy/backups/` on the same disk; copying them to a
second machine in Bangladesh is the hospital's side of the runbook.

**Tests.** `deployment.test.ts` (local storage, the escape refusal, `GET
/config`, `PAYMENT_UNAVAILABLE`), the production cases in `env.test.ts`, and
`e2e/self-host.spec.ts`: with `GET /config` answering `onlinePayments: false`
(stubbed — the suite's API runs the demo), the booking form offers the
counter only and books, and the standby form has no prepayment.

### Step 25 — a patient proves a phone and finds what it holds (`feat/patient-otp`)

**What a patient now does.** The Profile tab (a placeholder until now) signs
in with a mobile number and a six-digit code (`S-A-03`, `S-A-04`). If the
number holds anything no account owns — bookings made as a guest, patients a
hospital imported — `S-A-20` lists them and **যোগ করুন** takes them over in
one step (`FR-GST-09`); then the account's profiles show, each with its
records. `patient-account.spec.ts`: a guest books, is seen and signed off,
then on another device signs in and reads the record.

**The code** (migration 0032, `otp_challenges`): six digits, five minutes,
only a keyed hash stored, the latest the only one that works, five an hour
per number, five wrong entries lock the number fifteen minutes (`FR-SEC-05`).
It is sent marked sensitive, so **no provider prints it** — the log provider
writes "withheld" where the body would be. **On a demonstration the code comes
back in the response and the app shows it** under the boxes; `DEMO_MODE`
cannot run in production, so a real deployment never does this.

**The session** is step 21's shape for patients: fifteen-minute access, a
rotating refresh token, reuse ends every session — and the refresh token is
**bound to the browser that signed in**; carried elsewhere it is refused. It
lives in `localStorage` (a patient app that forgets its person on every tab
close is not one people keep), guarded for private windows.

**A guest proves the phone before booking (`FR-GST-03`) — on a real
deployment.** `POST /guest/start` answers whether a code is needed: a number
that has proved itself before is not asked again (`FR-GST-12`). The booking
then needs the guest token for that number. **`GUEST_BOOKING_OTP` unset means
on, except under `DEMO_MODE`**, where the demo keeps its one-tap booking the
way it keeps the password-less picker; that is why every booking e2e spec is
unchanged, and why the code path is covered by API tests rather than the
browser. Set it to `true` on a demo to show the check.

**Not built.** `S-A-05`/`S-A-06` (making and switching profiles by hand):
in this version a profile comes from a booking or a claim. The NID is not asked
for anywhere (see *Step 23*).

### Step 24 — a hospital imports what it already holds (`feat/data-import`)

**What an administrator now does.** `S-B-11` → **পুরোনো তথ্য আমদানি করুন**
opens `S-B-14`. Choose a set (ক কাঠামো, খ রোগীর তালিকা, গ আগামী
অ্যাপয়েন্টমেন্ট; ঘ is shown off, `FR-IMP-12`), download its template, choose
the CSV saved from the hospital's own system, **যাচাই করুন**. The preview
counts add, update, skip and errors, and lists every error by row and column.
**অনুমোদন করে সংরক্ষণ** writes it all or nothing; the history lists every
batch; a committed one can be taken back. `data-import.spec.ts` does all of
it on a facility that starts empty.

**How the data is held.** Migrations 0029–0031: `booking_source 'import'`,
patients a hospital holds (`owner_hospital_id`, a third owner under
`patients_one_owner`), `external_refs` for the hospital's own identifiers,
and `import_batches`/`import_rows` (with `previous`, for undo). Row
reading is pure and tested in `shared/domain/src/imports`: day-first dates,
either clock, weekday names in both languages, Bengali digits, taka with
commas.

**Rules a reader would not guess** (`import.service.ts`):
- **Re-importing updates.** Every row keeps the hospital's identifier; a
  department whose code already exists, or a doctor whose BMDC number is
  known, is adopted rather than duplicated.
- **Beds arrive out of service** (`FR-IMP-03`: occupancy is never imported).
- **An imported staff account has no password** — none is ever imported —
  until an administrator issues a temporary one from `S-B-11`. An email that
  already has an account here is skipped: an import never changes a signed-in
  person's access.
- **Appointments** need their patients and doctors imported first, a chamber
  that day (a date in the past is refused), and a free serial. "Paid" is kept
  on the booking as the hospital's word (`intake.import.paid`): a payment row
  needs a payer, and an imported patient has none until they claim the record.
- **Undo** removes what the batch added and restores what it changed, unless
  something outside the batch has been built on it since — a booking, a
  visit, a bed the ward has used, an account somebody signed in with — and
  then it names those rows and changes nothing.
- **Imported patients are their hospital's alone** (`FR-IMP-10`): the
  counter lookup from step 23 now shows another hospital's imported patients to
  nobody.
- **Rows are cleared 30 days after a batch closes** by the hourly jobs
  (`jobs.service`, which now also runs the materialiser); counts, errors and
  `external_refs` stay (`FR-IMP-08`).

**Found on the way: lab reports over 256 KB failed.** The global JSON parser
runs before the lab route's own 14 MB one and refused any real PDF (as base64)
with a **500**; every test uploaded a few bytes. Routes with their own limit
are now skipped by the global parser, an oversized body is `PAYLOAD_TOO_LARGE`
(413) and a malformed one `VALIDATION_FAILED` (400) instead of `INTERNAL`.

**Not in this step.** A read-only connection to a hospital's database or FHIR
(`FR-IMP-09`: "later"); set D (`FR-IMP-12`). Before a real import, the
hospital's column headers — never its rows — are what an importer needs
(`FR-IMP-11`).

**Before this reaches the deployed demo:** apply 0029, then 0030 and 0031
(0029 must commit first, as 0021 did).

### Step 23 — somebody walks up to the counter (`feat/counter-registration`)

**What a counter now does.** On `S-B-02`, **ওয়াক-ইন যোগ** (key `W`) opens
`MOD-B02-WALKIN`: type the number the patient says (`০১৭…`, `017 …`,
`+88017…` all work), pick the person from everybody registered under it, or
register somebody new in four fields, choose the end of the line or a place
with a reason, and **সিরিয়াল দিন**. The rail's **রেজিস্ট্রেশন** now opens
`S-B-03`, a registration desk with the same finder and today's chambers
beside it. `counter-registration.spec.ts` does both; `console-rail.spec.ts`
now expects রেজিস্ট্রেশন to open.

**How it is stored.** Registration makes exactly what a guest booking makes —
a guest identity for the phone and a patient under it (`FR-GST-13`) — so a
counter patient can later verify the phone in the app and find their records
(step 25). The same name under the same number is one person; a child on a
parent's phone is a second patient. Every lookup that shows somebody writes
one `RECORD_VIEW` audit row per patient (`DB-P7`). The serial is the
queue's own `POST /sessions/:id/walkin`, issued under the session lock.

**A walk-in sent twice was two bookings.** `addWalkin` created the booking
before `appendEvent` noticed a replayed `clientEventId`, so a counter that
lost the answer and sent again left an orphan booking holding a serial.
The controller now answers a replay from the log first
(`registration.routes.test.ts`).

**Deliberately not built.** *Offline walk-ins*: every other reception action
queues offline, but a serial issued offline by two counters could be the same
number, so the controls say a connection is needed. *The printed token slip*
(`FR-REC-21`, not in this step). *The NID* on `S-B-03`: the column is to be
encrypted by the application first, and nothing encrypts it yet.

### Step 22 — a hospital sets itself up (`feat/hospital-settings`)

**What a real deployment now does.** After `pnpm staff:create`, the facility's
administrator signs in, opens the dashboard, and **সেটিংস খুলুন** leads to
`S-B-11`: facility details and queue rules (with the SMS budget), departments,
doctors and their weekly chambers, wards and beds, the emergency services
offered, and staff accounts. A status card counts what is set up and carries
**লাইভ করুন**. `hospital-settings.spec.ts` does all of it through the browser
on a facility that starts with nothing but a name and an administrator, and a
receptionist the screen created then signs in with the temporary password it
showed once.

**Chambers come from schedules now.** Migration 0028 gives `sessions` a
`template_id` and a unique (template, date) index. The API process writes
today plus seven days from every schedule at start-up, hourly, and straight
after a schedule is added (`sessionMaterialise.service`, `SESSION_MATERIALISE`).
It is idempotent by the index, so it cannot double a chamber. The seeds link
their sessions to their templates, so the job writes nothing on a fresh demo;
on the deployed demo it writes the eighth day after midnight, which the daily
reset used to be the only thing doing.

**Rules a reader would not guess** (all in `hospitalSettings.service.ts`):
- A BMDC number already known **links that doctor** instead of making a second
  record. A doctor's names and degrees change only while unverified and sat at
  no other facility; after that they are the register's.
- **`pnpm doctor:verify --bmdc A-12345`** is the platform's half of
  `FR-SUP-02`. A hospital cannot verify its own doctors. Discovery shows only
  verified doctors, so a facility can go live before its doctors appear.
- A fee or room change reaches chambers **still scheduled from today**; a
  booking keeps its own fee.
- Removing a schedule removes its future chambers **nobody booked**; booked ones
  stay for the counter, and the toast says how many.
- **A new bed is out of service** with the reason code `setup:unconfirmed`
  (the board shows "added in settings — not yet confirmed by the ward") until
  the ward restores it. A public count never includes a bed nobody checked.
- **Declaring a capability makes it unavailable** until the ER says otherwise;
  the ER's own endpoint still refuses a kind never declared.
- An administrator **cannot deactivate themself, drop their own admin role, or
  reset their own password** here. Deactivating or changing roles ends that
  account's refresh tokens.
- **Soft-deleted roles are no longer issued.** `staffAuth.repo.rolesOf` and
  the demo picker's queries ignored `staff_roles.deleted_at`; removing a role
  from `S-B-11` would otherwise have done nothing until the row was deleted.

**The queue now follows the facility's rules.** Until this step every guard
ran on `DEFAULT_QUEUE_SETTINGS` and the late route wrote `reinsertAfter: 3`,
so the no-show grace and late re-insert saved in `S-B-11` would have changed
nothing. `queue.service.applyOne` reads `hospital_settings` for every event,
checks the guards against it, and writes the facility's `k` into a
`PATIENT_LATE` payload whatever the console sent (`queueRules.routes.test.ts`).
The console still sends 3 optimistically; the server's event corrects it.

**A screen could roll back to an older queue** (found by
`lab-report.spec.ts` failing once in three runs, on this branch and not
because of it). Joining a session room and reading the catch-up state are two
steps on the server; an action committed between them was broadcast first,
then the older catch-up arrived and replaced it, and the screen sat on the
previous patient until the next action. `shared/client` `foldUpdate` now
keeps the newer state (`FR-QUE-05`). This affected every console and every
patient phone, most visibly a doctor's screen opened a second before the
queue moved.

**Not on the screen, deliberately.** *Counters* have nothing to configure
until counter registration (step 23) gives them a use: nothing reads
`staff_roles.scope` yet. The *refund policy* stays the agreed default (see the
payment decisions); it is not a setting a facility edits. *A doctor account
linked to its `doctors` row* (so a doctor sees only their own chambers, see
*Step 21*) still has no column; it needs a migration and is open.

**Before this reaches the deployed demo:** apply 0028 to Supabase before the
API deploys — the materialiser and the seeds read `sessions.template_id`.

### Step 21 — staff sign in with their own accounts (`feat/staff-auth`)

**What a real deployment now does.** With `DEMO_MODE` off, the console shows
`S-B-00`: email and password, one message for any wrong combination, a
fifteen-minute lock after five failures in a row (`STAFF_LOCKOUT_*`). The
access token is the same shape the demo picker's is — every role the person
holds at their own facility — so no guard written since step 3 changed. It
lasts fifteen minutes and the console renews it in the background
(`keepSessionFresh`); the refresh token is opaque, stored hashed in
`sessions_auth`, and rotates on every use. A rotated token used again means
two parties hold it, and every session of that account is revoked. The picker
after sign-in shows only the person's facility, only their roles, and today's
chambers there (`GET /staff/chambers`, one query shared with the demo picker
in `chamber.repo`). The rail's foot gains **লগ আউট**.

**A password an administrator set** (`must_change_password`, 0027) signs in,
but the token carries `mcp` and `attachPrincipal` refuses it everywhere except
`/staff/me`, `/staff/password` and `/staff/logout`
(`AUTH_PASSWORD_CHANGE_REQUIRED`) — the server's rule, not only the screen's.
`S-B-00c` asks for the current password and the new one twice.

**Starting a fresh deployment:** `pnpm staff:create --hospital-code MARKS
--email … --name … [--hospital-name-bn … --hospital-name-en … --kind hospital
--division … --district …]` creates the facility if the code is new (not
live) and its first administrator, and prints a temporary password once.
Accounts for everybody else come from `S-B-11` (step 22).

**The demo is unchanged, and gains the sign-in.** `DEMO_MODE=true` still opens
the picker without a password (`GET /demo/status` tells the console which it
is; not knowing is treated as "not a demo"). The picker links to `S-B-00`
(`?login=1`). **Every seeded account's password is `demo-password-2026`**
(`DEMO_STAFF_PASSWORD`) — documented, and shown on the sign-in screen only on
a demo: it opens nothing the picker did not already open. Demo hospitals now
have codes: SHAPLA, PADMA, KARNAPHULI, JAMUNA, MEGHNA, BURIGANGA.

**Things worth knowing.**
- **scrypt, not Argon2id** (decision 75), at OWASP's minimum; the stored hash
  names its parameters, so raising them later rehashes at the next sign-in.
- **The per-address limits are generous on purpose** (300 sign-ins per ten
  minutes): every counter in a hospital usually reaches the server from one
  public address, and a shift change is a hundred sign-ins. The per-account
  lock is what stops guessing.
- **One email at two facilities** is resolved by the password; the hospital
  code is asked for only when the password opens both
  (`AUTH_HOSPITAL_REQUIRED`), so the question reveals nothing to somebody who
  does not know it.
- **Sessions live in the tab** (`sessionStorage`), as the demo's did: a new tab
  signs in again, and closing the browser signs out.
- **A doctor still chooses among all the facility's chambers.** No column joins
  an account to a `doctors` row (see *Step 12*), so "only my own chambers"
  waits for step 22's staff screen to record it.
- `seeds.test.ts` now asserts the opposite of what it did: every seeded
  account carries the one scrypt hash of the demo password, and nothing else.
- **Before the console knows whether it is a demo, it says it is starting.**
  The first cut treated an unanswered `GET /demo/status` as "not a demo" and
  showed sign-in — which is what the deployed demo's API does for thirty
  seconds after sleeping, and what a full e2e run hit when the API was slow.
  `askDemoMode` now asks four times at twelve seconds, says the server is
  waking after the first miss (`ConsoleStarting`), and ends on "could not
  reach the server" with a retry — never on sign-in by default. A session
  already in the tab does not wait for the answer. `console-cold-start.spec.ts`
  holds both cases.
- **Before this reaches the deployed demo:** apply 0027 to Supabase
  (`ALLOW_REMOTE_DB=1 pnpm db:migrate`) before the API deploys — the login
  and the picker's chamber query read its columns. The demo's accounts can sign
  in only after the next `db:reset`; until then the picker works as before.

### The Marks handbook, and the real version they asked about

**What was asked (28 September).** After the pitch, Marks Group's COO asked
for full documentation of the app and whether their existing hospital
database can be imported. The owner chose: the real version runs **on a server
in Bangladesh** (their server room or a Bangladeshi data centre), and the
document comes first so Marks can decide from it.

**The handbook is pitch material and lives outside the repository**, in
`%LOCALAPPDATA%\HealthCareDemo\handbook\` (`README.txt` there says how to
rebuild it for another hospital: copy `config.json`, change the names,
`node build.mjs <config>`). 26 A4 pages, all Bangla, every screenshot from the
current build with numbered markers, every feature badged *আজই চালু* /
*পাইলটে যোগ হবে* / *পরের ধাপে*. It states no price and no legal
compliance claim, and calls itself a description, not a contract. A copy is in
the owner's Downloads as `MARKS-handbook-bn.pdf`. If the product changes, the
three status lists in `build.mjs` and the screenshots must change before a
new copy is sent. Fresh screenshots were taken against the local
`healthcare_dev`, which was reset for it (demo data only).

**What it proposes for importing their data** — four sets Marks approves one
by one, and nothing outside them: (ক) hospital structure — departments,
doctors, schedules, wards/beds, staff; (খ) patient register — their patient
number, name, DOB or age, sex, mobile, blood group; (গ) upcoming
appointments; (ঘ) past lab reports and visit summaries, proposed for later.
Never taken: NID, address, photos, billing, HR, stock, OT, nursing charts,
imaging originals. Bed occupancy is not imported (the ward sets it on go-live
day). Three routes: Excel/CSV template first, a read-only database link,
FHIR. Five steps: export, validate, preview and approve, all-or-nothing save,
undo per batch.

**In the documents as of `chore/pilot-scope`; built as pilot steps 21–28**
(`CLAUDE.md` §4.2): `PRD.md` §14b (`FR-IMP-01`–`12`), §4.2 and `FR-SEC-07`;
`CLAUDE.md` §4.1 rewritten (auth built here, scrypt, demo picker kept);
`DATABASE.md` migrations 0027–0031 planned (0027 staff auth, 0028 schedules, 0029–0031 import); `BACKEND.md` staff auth, import
routes, the worker loop, §12b self-hosting; `APP_FLOW.md` `S-B-00` pilot rules
and `S-B-14`. What the documents had to change, for the record:

- `FR-IMP-*` requirements need adding to `PRD.md` (import is new scope;
  §27 only says the Platform runs alongside an HMS).
- `patients_one_owner` requires every patient to belong to a user or a guest,
  and there is no column for a hospital's own patient number — an imported
  register needs a schema change (`DATABASE.md`).
- A server in Bangladesh means our own staff login, not Supabase Auth, which
  reverses `CLAUDE.md` §4.1; that section needs the owner's edit.
- The rest of the pilot list, as the handbook states it: staff logins and
  staff management (`FR-ADM-11`), hospital setup screens (`FR-SUP-01`), the
  nightly session materialiser (`backend/workers` is still a stub, so no
  chamber exists after the seeded days), counter registration and walk-ins
  (`FR-REC-14`, `FR-REC-20`), patient OTP, a live SMS aggregator, and
  packaging for a Bangladeshi server with backups.

**Found while checking the handbook against the build:** the console rail's
**বিল** (Billing) item opened the pharmacy stock screen. `APP_FLOW.md` B1.1
said so on purpose ("while `S-B-04` is not built"), but a person clicking
Billing landed on medicine stock. **Changed in `fix/console-rail-billing`**, and
B1.1 edited to match: ফার্মেসি is its own rail item, and বিল is switched off
with "এই সংস্করণে নেই", the way রেজিস্ট্রেশন is. `console-rail.spec.ts`
asserts both. **Decision 74 (owner may reverse):** the rail gains an eighth
item rather than keeping a mislabelled one.

### Preparing the demo for a meeting (`fix/phone-entry-normalise`)

**The phone bug.** `book/page.tsx` and `StandbyJoin.tsx` validated the raw
input against `^\+8801[3-9]\d{8}$`, so `01712345678` — the eleven digits the
error message asks for — was refused and the confirm button never enabled.
The bed request and the emergency form already used `normaliseBdMobile`; now
all four do, and send the normalised number (`DB-P6`, `INP-GST-PHONE`). The
e2e case that called `01712345678` "malformed" was asserting the bug; it uses
a number one digit short now, a new case books with `019XX-XXXXXX` and reads
`+88019…` back from `guest_identities`, and `joinStandbyAsGuest` types `019…`
so every standby spec exercises the same path.

**The demo console expired mid-meeting.** `POST /demo/token` signed an
ordinary fifteen-minute access token, and the picker has no refresh, so every
console tab opened in preparation stopped answering a quarter of an hour
later. Driving the show found it: reception, the doctor and the ER all failed
on their first action after that. Demo principals now last twelve hours
(`DEMO_TOKEN_TTL` in `demo.service.ts`), still only under `DEMO_MODE`; a
`demo.routes.test.ts` case pins the lifetime.

**Three things a presenter has to do, learned by driving the whole show.**

- **The no-show step needs a setup tap, soon after a reset.** Reception can
  mark absent only the patient at the front, and only after the grace window:
  the longer of 15 minutes and two patients at the current pace
  (`graceWindowMinutes`). The pitch chamber opens with serial 6 in the
  chamber, so nothing is markable. Tapping দেখা শেষ on serial 6 starts the
  clock for serial 7 — but serial 6's consultation is measured from its call,
  which the seed puts four minutes before the reset, and it feeds the rate
  (`RATE_ALPHA` 0.3, clamped at an hour). Tapped within five minutes of a
  reset the window is about 22 minutes; tapped hours later it is about 50.
- **Padma has to be made fresh within the hour.** The emergency ranking
  de-ranks stale facilities, and every figure ages from the reset. Confirming
  the ER's capability list and cycling burn bed BU-01 through cleaning renews
  both, which is what `freshenPadma` does in `emergency-burn.spec.ts`.
- **After “I'm on my way” there is a send step** (জানান ও রওনা দিন), and the
  lab needs নমুনা নেওয়া হয়েছে → প্রসেসিং before রিপোর্ট দিন.

**Scheduled for the pitch (owner's machine, Monday 28 September).**
`HealthCare pitch reset` resets the deployed demo once at 11:10 Dhaka (23:10
on the machine), and `HealthCare pitch prep` runs
`%LOCALAPPDATA%\HealthCareDemo\pitch-prep.ps1` at 11:24 and every 5 minutes
until 14:54: it starts the API on the machine against the demo database, marks
serial 6 seen if it is still in the chamber (the setup tap), confirms Padma's
capability list and cycles BU-01 through cleaning, then stops the API. Its log
is `pitch-prep.log` beside it. `HealthCare demo refresh` no longer catches up a
missed run (`StartWhenAvailable` off, so a reset can never start mid-meeting)
and may wake the machine. All three are outside the repository. Five minutes, because
the deployed demo calls a figure stale after ten (`staleAfterMinutes: 10`),
and a stale Padma drops below the nearer, equally stale Jamuna.

~~**Known bug: a patient left in the chamber for three hours cannot be
finished.**~~ **Fixed in `fix/consult-overflow`.** Only the offline batch
clamped the measured length; the counter's "done" and "next" wrote the raw
number, and `bookings_consult_seconds_plausible` (0–10800 s) refused it with a
500. Every producer of `PATIENT_DONE` now measures through the domain's
`measuredConsultSeconds` — the same clamp the rate already used (30 s to one
hour) — so the event, the booking row and the rate hold one number. The event
records the plausible bound, not the four hours, which is what the offline path
already did. `queue.routes.test.ts` moves the clock four hours past a call and
finishes the patient both ways; both tests fail with the 500 on the old code.

The presenters' material lives outside the repository (it is pitch material,
not product): a slide deck, a text guide and a screenshot walkthrough built by
driving the local demo with Playwright.

### A week of demo for people to explore (`feat/demo-week`)

**The owner asked on 2026-09-25** for the demo to be refilled with as much
data as it can hold and kept that way for the whole of the next week: he is
giving the deployed links to doctors in his family to explore, not pitching.

**Why a single reset could not do it.** Everything live is anchored to the
moment of the reset: the mid-queue chamber is built backwards from "now"
(`seed_07`, ±90 minutes), bed and ER figures carry freshness stamps that age
honestly, and "today" on every dashboard is the reset's day. Nothing moves the
demo forward afterwards, because the nightly worker that materialises sessions
(`BACKEND.md` §8) is still a stub. And the seed wrote only three days of
sessions while the patient app's picker offers seven (`S-A-07b`,
`BOOKABLE_DAYS`), so four days of every doctor's picker were empty.

**What changed.**

- `seed_02` writes **eight days** of sessions (`SESSION_DAYS`): the picker's
  seven, and one more so a missed daily reset still leaves a full picker.
- `seed_07` books every one of them, from `FILL_BY_DAY`: one declared range
  per day, 40–75 % of capacity today thinning to 2–10 % a week out. A seed
  test pins that every one of the eight days has booked sessions and that
  the fill table matches `SESSION_DAYS`.
- `database/scripts/demo-refresh.ps1` runs `db:verify`, then `db:reset`,
  against the remote demo, logging to `%LOCALAPPDATA%\HealthCareDemo\refresh.log`.
  It **refuses unless the checkout's `database/` and `shared/` are exactly
  `mvp`'s**, so a half-finished branch cannot truncate the demo and then fail
  on a schema Supabase lacks. A scheduled task on the owner's machine calls
  it once a day (below).
- `fix/console-picker-friday`, found on the way: the Friday picker bug above.
  Next week's Friday (2 October) would otherwise have shown two hospitals.

**Volume.** Hospitals, doctors, patients and past visits stay at the declared
demo set (`FR-DEM-01`–`03`: six facilities, forty doctors, two hundred
profiles, five hundred visits). Raising them is a PRD change, not a seed
tweak, and was not made. What grew is the forward week of bookings.

**What a daily reset costs.** It wipes whatever people did the day before —
their bookings, the queue taps on a console. For people exploring that is the
right trade: each morning is a known, fresh state. A reset also leaves the
demo empty for the five or six minutes it takes to seed across to Singapore
(`seed_07` alone is about four), which is why it runs at 08:00 Dhaka.

**Done, on the owner's word (2026-09-25).** `ALLOW_REMOTE_DB=1
ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset` rebuilt Supabase from `mvp` at 06:59
UTC (12:59 Dhaka): 294 sessions, 1,560 bookings, 500 past visits, 966
payments, 170 beds. Read back afterwards, every day from Friday 25 September
to Friday 2 October has booked chambers — 40 sessions at all six hospitals
Saturday to Thursday, and the Friday chambers at the college and the clinic.

**The scheduled task** is on the owner's Windows machine, not in the repo:
`HealthCare demo refresh`, daily at **08:00 Dhaka**, which is **20:00 the
evening before on that machine** (Canada Central, UTC−6, no daylight saving).
Seven runs, Saturday 26 September to Friday 2 October; the trigger ends after
the last and the task deletes itself a day later. It starts when the machine
next wakes if it was off, needs a network, and runs on battery. It only runs
the reset if the checkout is on `mvp` (or a branch whose `database/` and
`shared/` match it) — **leave the repository on `mvp` this week**, or the day's
refresh is skipped and says so in the log.

**Proven unattended**: started once through the scheduler at 07:12 UTC on
2026-09-25, it verified, reset and reseeded in seven minutes (exit 0, 294
sessions, 1,532 bookings), from a docs-only branch whose `database/` and
`shared/` matched `mvp`, as the guard allows.

```powershell
Start-ScheduledTask -TaskName 'HealthCare demo refresh'          # refresh now
Get-Content "$env:LOCALAPPDATA\HealthCareDemo\refresh.log" -Tail 20
Unregister-ScheduledTask -TaskName 'HealthCare demo refresh' -Confirm:$false   # stop early
```

**Extended and repaired on the owner's word (2026-09-30).** The trigger now
ends 2026-10-15 23:00 local, so the last reset is **Friday 16 October, 08:00
Dhaka**, and its sessions run to about 23 October. The resets had been
failing since the pilot migrations landed on `mvp`: `db:verify` refused
(Supabase stopped at 0026) and, as designed, nothing was truncated, so the demo
kept its 25 September data. `ALLOW_REMOTE_DB=1 pnpm db:migrate` applied 0027–0033
to Supabase the same day — all additive, so the deployed API from `main` is
unaffected — and `db:verify` passes there. **Before a pilot step merges with a
new migration, apply it to Supabase, or the next morning's reset is skipped.**

### The first scheduled refresh, and the rail (`fix/demo-refresh-retry`, `fix/console-rail-links`)

**What the owner saw on 2026-09-26 (Dhaka morning):** every hospital's bed
board said it had no wards, and clicking সিরিয়াল, রেজিস্ট্রেশন, জরুরি, টেস্ট,
বিল or ড্যাশবোর্ড on the rail did nothing.

**The empty demo.** The machine was off at 20:00, booted at 22:21 local, and
the task caught up at 22:26 (`StartWhenAvailable`). It truncated all 51
tables, seeded hospitals and staff, and was killed seconds later: the log ends
in `^C` and the task in `0xC000013A`. This machine is Windows 11 25H2 with
Windows Terminal as the default terminal, which **ignores
`-WindowStyle Hidden`**, so the run opened a visible window of pnpm output
just after login, and closing it killed the reset. Hospitals and staff
existed, nothing else did. Re-run by hand at 04:46 UTC, complete at 04:54: 328
sessions, 2,000 bookings, 29 wards, 170 beds. Read back through the deployed
API afterwards.

**What changed.** `demo-refresh.ps1` retries a failed verify-and-reset three
times, two minutes apart, so a dropped connection no longer leaves the demo
empty for a day. A closed window kills the script too, so the retry does not
cover that, so **the task now starts it through `conhost.exe --headless`**,
which has no window to close (done on the owner's word, 2026-09-26; a
throwaway task proved it first). If the task is ever re-registered, keep that
action:

```powershell
Set-ScheduledTask -TaskName 'HealthCare demo refresh' -Action (New-ScheduledTaskAction -Execute 'conhost.exe' -Argument '--headless powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -File "D:\Projects\HealthCare\database\scripts\demo-refresh.ps1"' -WorkingDirectory 'D:\Projects\HealthCare')
```

**The rail.** `ConsoleRail` was labels styled as a menu, by design ("a link
that goes nowhere is worse than a label"). To somebody exploring, it was a
menu that ignored clicks. Every item now opens its console **for the same
facility**, minting a principal the way the picker does (`mintDemoToken`,
shared by both). সিরিয়াল returns to the chamber last opened in the tab, or to
the picker. বিল opens the pharmacy, which has sat under it since step 17.
রেজিস্ট্রেশন (`S-B-03` not built) and any console a facility does not run (a
clinic has no ward) are switched off with the reason beneath. The picker now
stores the facility's `roles` and the `chamberSessionId` in the demo session.
`APP_FLOW.md` B1.1 says so. `e2e/console-rail.spec.ts`, four tests.
Released to `main` and pushed on 2026-09-26, with `mvp`.

### The design pass (`fix/pitch-design`, after step 20)

The owner looked at the deployed demo and said the design "looks shit" and
that not everything worked. Both were fair. What was found and done:

- **No typeface had ever been loaded.** `--font-ui` named Anek Bangla and
  nothing installed it, so every screen rendered in whatever Bangla font the
  device had (Nirmala UI on Windows, something else on each phone). Both apps
  now load Anek Bangla and Tiro Bangla through `next/font` (`src/app/fonts.ts`),
  self-hosted at build time. This alone is most of the difference. The patient
  service worker's shell cache is bumped to `shell-v2` so installed phones pick
  it up.
- **Reception never showed a patient's name.** `ReceptionConsole` passed an
  empty map to the table from step 8 on, although `GET /sessions/:id/queue`
  always returned the names. Now read from it (`lib/roster.ts`), and re-read
  when a walk-in or a standby seat appears.
- **Reception, to the design reference** (`FRONTEND.md` §0.4, the `Reception`
  artboard): a green rail naming the hospital, shared by all five hospital
  consoles (`ConsoleRail`); the doctor and department in the header, with the
  chamber hours in Bangla ("সকাল ১০:১৩", never "10:13 AM"); the queue framed
  as a card; the now-in-chamber card in brand green with the patient's name.
  The picker (`S-B-01`) gets a green header band, the facility's consoles as a
  card grid and the chambers in two columns.
- **Every freshness line says its age in the unit a person would use**
  (`formatAge`): minutes, then hours, then days. It read "৩০১ মিনিট আগে" on a
  morning ward, and "হালনাগাদ ৩ আগে" where a caller passed a bare number —
  decision 38, now closed.
- **Smaller:** an empty revenue chart says nothing was collected instead of
  drawing ৳0.01 axes; a negative "average past the quote" says there was no
  overrun; the national map reads "২৮টির মধ্যে ৭টি"; hospital cards give the
  Bangla address, not "Dhanmondi, Dhaka"; the quoted wait on a queue row is in
  Bengali digits like its serial.

**What the live demo needed that was not code:** its database was seeded
before steps 17–19 (no payments, lab orders or feedback), and the pitch
chamber was built at 03:40 Dhaka, so it read "3:40 AM – 6:40 AM" and the
patient app could not book onto it. A reseed about an hour before a pitch
fixes both; see *Running the pitch demo*. **Done on 2026-09-24 at about 06:15
UTC** (12:15 Dhaka): migrations 0024–0026 applied to Supabase, `db:verify`
clean, and the demo reseeded, payments, lab orders and feedback included.

**The release build then failed on Render** (`fix/render-pnpm`). `NODE_VERSION
"24"` names the Node Render ships with, whose global directory is read-only,
so the build's `npm install -g pnpm` failed with EROFS. On `"20"` Render had
installed Node itself into a writable directory, which is why it had worked.
pnpm is now installed into `.render/` in the checkout, and both the build and
the start command run it from there. Checked in a `node:24-slim` container with
the global directory made read-only: the global install is refused, as on
Render, and the new command installs and starts the API. While the build was
red, Render kept serving the previous release.

**That fix did not reach the live service** (`fix/render-node`). It was created
as a plain Web Service (`DEPLOY.md` §2), not from the blueprint, so its build
command lives in the dashboard and `render.yaml` is never read. It still runs
`npm install -g pnpm`. With no `NODE_VERSION` set there, Render takes the
version from `.nvmrc`: `20` had it download Node into a writable directory, and
`24` (from `fix/ci-node`) put it on Render's own read-only Node. `.nvmrc` is now
`22`, above the 22.19 floor, and CI stays on 24 through `ci.yml`. To run the API
on 24, change the dashboard's build and start commands to the ones in
`DEPLOY.md` §2 first, then `.nvmrc`.

### English, everywhere (`feat/language-switch`)

**The owner asked on 2026-09-24** for "a version that says it's in English
too — every single thing", with a switch at the top of both the hospital
console and the patient app: one button for English, one for Bangla.

**The switch.** `SEG-A00-LANG` is a strip above every patient screen,
rendered once by the root layout (`LanguageBar`), so no screen lacks it.
`SEG-B00-LANG` is at the right end of the header on the picker and on all
eight consoles (`ConsoleLanguageSwitch`). Both are `<LanguageSwitch>` from
`@platform/ui`: two toggles, **বাংলা** and **English**, each named in its own
script and marked with its own `lang`, no flags. Bangla stays the default
(`FR-LOC-01`).

**One store, every screen at once.** `useLocale()` / `setLocale()` in
`@platform/ui` (`locale/store.ts`) hold the choice outside React and read it
through `useSyncExternalStore`, so one press re-renders every screen, sheet
and toast in the same commit. It is kept in `localStorage` under
`platform.locale`, and another tab of the same app follows through the
`storage` event. `<LocaleDocument>` moves `<html lang>` (the Bangla
typesetting rules key off it) and the tab title. The locale decides everything
else: which half of each message is read (both halves already existed for
every key), the digits (`numeralsFor`, so English reads `1,234` and
`5:30 PM`), and which of a facility's two names is shown (`localName`).

**Every screen was hard-coded to Bangla, and that is what most of the diff
is.** Forty-one components declared `const LOCALE = 'bn'` and
`const NUMERALS = 'bengali'` at module scope. They now read the store. The
admin and national dashboards' formatters (`num`, `taka`, `minutes` …) became
`formattersFor(locale)`, destructured per component. One trap is worth
knowing: `lib/bedCopy.ts` *exported* its `'bengali'` constant, and seven ward
and ER files imported it. The compiler could not see that, because the name
was always defined. The export is gone. Four hooks read `locale` without
listing it in their dependencies, which would have kept the old language
after a switch; this repository has no `react-hooks` lint rule to catch that.

**The API returns both names wherever it returned one.** Switching must not
wait on the network (`I18N-08`), so each read that named something in Bangla
now carries the English beside it. That covers the picker's departments,
discovery (addresses, departments, a session's doctor and hospital), the
wallet's records, consents and access log, standby status, ER addresses,
admin punctuality's departments, and the lab catalogue.
`bilingual.routes.test.ts` checks each of these is really English. Lab test
names moved to `@platform/i18n` (`LAB_TEST_NAMES`, keyed by code). An order
row still stores the Bangla name it was ordered under, and a screen reading
English names it by its code.

**Found on the way, and fixed.** Reception's "called serial N" toast put a
Latin digit inside a Bangla sentence. The lab console's clock used
`toLocaleTimeString('bn-BD')`, which prints "১০:১৩ PM", the half-translated
form `I18N-05` rules out. It now uses `formatClock`.

**Deliberately not translated.** Anything a person typed is shown as written:
a patient's or staff member's name, a diagnosis, advice. The database holds
one version of each, and translating a name is not a translation task.
**SMS stays in Bangla**: the preference belongs to an account (`FR-PAT-05`),
and accounts are deferred (`CLAUDE.md` §4.1). See decision 73. A patient page
is server-rendered in Bangla, so a phone that chose English sees one frame of
Bangla before it switches. The console renders client-side only and has no
such frame.

**Docs.** `FRONTEND.md` `I18N-08` said the toggle lives in settings and the
first-run screen. It now says the top of every screen, as the owner asked,
and new `I18N-10` covers names. `APP_FLOW.md`: `GR-06`, `SEG-A00-LANG` on
`S-A-02`, and where `SEG-B00-LANG` sits while `S-B-00` is deferred.

**How to show it.** Any screen of either app → **English** at the top. The
whole screen changes in place: the queue keeps its rows and the live serial
keeps counting. Reload and it is still English. For the two-sided version,
put the patient's phone in English and leave reception in Bangla: reception
taps পরবর্তী রোগী ডাকুন and the English phone moves. `language-switch.spec.ts`
runs exactly that.

### Bangla digits on every console (`fix/console-bangla-digits`)

A read of every live screen after the redeploy found the consoles writing
English digits into Bangla sentences: "3 জন অপেক্ষায়", "হালনাগাদ 5 ঘণ্টা
আগে", "168টির মধ্যে", "10:50 AM". `TYP-04` asked for Latin numerals on
consoles, but §0.2 of the same document bans them inside Bangla sentences, and
the lab, the pharmacy and the reception queue already used Bengali. **The owner
ruled on 2026-09-24: Bangla digits on every console.** Each console's
`NUMERALS` is now `'bengali'`, and `TYP-04`, `I18N-04` and `I18N-06` say so.
Bed and room labels and ER case codes stay as printed, because they are
identifiers, not quantities. The specs read figures through
`e2e/support/digits.ts`. The patient app already used Bengali digits: its
"সন্ধ্যা ৬:০০" only looks like an English 0 at display size in Anek Bangla.

### Step 20 — the national layer, and what a government viewer can reach

**The definition of done is "no identifiable row reachable", and it is held
three ways, each tested.**

1. **The principal.** A staff token with no hospital whose every role is
   national (`platform_admin`, `gov_viewer`) becomes `kind: 'national'`
   (`middleware/auth.ts`). Every hospital guard asks `kind === 'staff'` first,
   so a government viewer fails all of them without any having to know it
   exists. `requireNationalRole` is the only door the other way. A hospital-less
   token with any hospital role on it is refused as incomplete.
   `gov.routes.test.ts` runs the matrix both ways, including a government viewer
   against a queue, a ward, an ER, a lab bench, the admin dashboard and a
   patient record.
2. **The database.** The four `/gov/*` reads run read-only as `gov_reader`
   (migration 0026, `SET LOCAL ROLE`). That role has SELECT on the six `v_gov_*`
   views and on nothing else in the schema. From inside it, `SELECT` on
   `patients`, `bookings`, `visits`, `hospitals` and even
   `v_public_hospital_capacity` is "permission denied". `gov_views.test.ts`
   asserts that the set of relations it can read is exactly those six, so a
   view added later is unreadable until somebody grants it on purpose.
3. **The wire.** `gov.service` walks every payload with `findIdentifiers` (an
   id-, name-, phone- or token-shaped key, or a UUID or mobile number in any
   value) and sends a 500 rather than the payload. The API test and the E2E
   both scan the actual responses for UUIDs, phone numbers, patient names and
   every facility name.

**Decision 5, implemented one way.** `staff_users.hospital_id` and
`staff_roles.hospital_id` are nullable (0024), and a CHECK ties null to exactly
the two national roles. Partial unique indexes cover what a null slips through.
The seeds write one national account, a `gov_viewer` with no facility. They
write no `platform_admin`, because `S-B-12` is not built. See decision 5.

**`FR-GOV-03` needed a category, and nothing recorded one.** The booking
reason and the diagnosis are free text, and classifying free text is the
diagnostic inference `PRD.md` §27 rules out. So the doctor's visit form gains
`CHIP-B05-SIGNAL`: কোনোটি নয় / ডেঙ্গু / ডায়রিয়া / জ্বর, none selected by
default, stored as `visits.symptom_signal` (0025). It is counted by district
and day only, and not shown in the wallet. `PRD.md` §15 and `APP_FLOW.md` B2
carry the note. See decision 66.

**A spike is this week at least double the usual week, and at least five
cases** (`shared/domain/gov/signals.ts`). "Usual" is the average week over up
to fourteen days before this one. A district with less than a week of
reporting before this one says যথেষ্ট তথ্য নেই rather than "normal". See
decision 67.

**The screen.** `S-B-13` has four tabs:

- **Capacity:** national totals, free beds by kind, one tile per district, and
  ventilators and blood named as not recorded.
- **ER heat map:** districts × the last 24 hours on the brand ramp.
- **Signals:** a table of every district × category, with a bar chart for
  each spike.
- **Benchmarks:** six measures, each ranked on its own, facilities shown by
  kind only, and a figure resting on fewer than five observations left out
  and counted.

Every section has its own `<FreshnessLine>` and fails on its own, and the
screen re-reads every minute. Offline keeps the last figures with their ages.

**Demo data.** `seed_09_signals` tags a few dozen past visits per district per
week by fixed targets, not by chance. The history is weekday-scheduled, so a
per-visit probability manufactured spikes in whichever district had a busy
week. Dhaka's dengue is nine this week against about one a week before it;
nothing else reaches five. A planted dengue or diarrhoeal case is re-labelled
whole from `DEMO_SIGNAL_CASES` — complaint, assessment, advice and tag — so the
record reads as one consultation.

**How to show it.** Console → **জাতীয় ড্যাশবোর্ড খুলুন** (below the
hospitals). রোগ-সংকেত opens on ঢাকা · ডেঙ্গু with its three weeks drawn. For
the live half, open a chamber's ডাক্তার console in a second window, type a
diagnosis, tap **ডেঙ্গু**, sign, then reload the national screen: that
district's dengue count has gone up by one. `gov-dashboard.spec.ts` runs
exactly that.

**Supabase does not have 0024, 0025 or 0026** (nor 0021–0023). 0026's `GRANT
gov_reader TO CURRENT_USER` has only run where the migrating user is a
superuser. On Supabase the migrating user is `postgres`, which is not one.
Creating the role should work there, but whether the grant lets that user
`SET ROLE` has not been tried. If it does not, every `/gov/*` read fails with
a permission error, loudly, and nothing else is affected.

### The demo API sleeps, and the console now says so

Render's free tier spins the API down when nobody is using it, and the first
request afterwards takes the better part of a minute. `fetch` has no timeout of
its own, so `S-B-01` sat on its loading skeleton for as long as the page stayed
open — the one `GR-03` state with no way out, because nothing ever rejected. It
was seen on a phone opening the deployed console shortly after a deploy, which
is precisely when the API is restarting.

The picker now gives each attempt twelve seconds (`AbortSignal.timeout`), tries
four times, says **সার্ভার চালু হচ্ছে** from the second attempt onward, and ends
at an error with a retry rather than a skeleton. Four attempts is a product
decision about a sleeping backend, not a test detail, which is why
`console-cold-start.spec.ts` declares a longer budget instead of trimming it.

Worth knowing when demonstrating: **open the console once a minute before
showing anyone.** Nothing is broken if the first load is slow; it is the free
tier waking.

### Standby from the phone (`feat/standby-self-serve`, after step 19)

**The owner's ruling on decision 62** (2026-09-23): "prepaid gets it
automatically". A patient joins a full chamber's standby list from the app
(`FR-PAT-25`). If they pay when joining, the next chair reception offers is
theirs with nobody asking (`FR-PAT-26`). If not, the offer reaches their phone
and they say yes or no within ten minutes (`FR-PAT-27`). Reception keeps
**গ্রহণ করেছেন** for somebody who rings the counter. `FR-PAT-26` and
`FR-PAT-27` are new; `FR-PAT-25` is amended.

**A payment before there is a booking.** `payments_one_subject` gains a fifth
subject, `standby_id` (migration 0023). When the person is seated, the
payment moves onto the booking it bought: the same money, now for the thing
it paid for. From there every settlement, revenue and refund query that
already reads bookings counts it. A prepayment for a chair that never came is
owed back in full under a new reason, `standby_unseated`, when they leave the
list or when the session ends. The amounts are never touched
(`trg_payments_amount_locked`).

**Seated on sight, in the offer's own transaction.** `offerFreedSlot` still
records `SLOT_OFFERED` first, because the recovery figure counts offers made
and taken (`FR-ADM-03`), then seats a prepaid person with `SLOT_ACCEPTED`
under the same lock. Seating is one function (`seatOnOffer`) whoever
accepts. Somebody who joined from the app gets a guest booking with a
tracking link; somebody reception listed gets a counter booking, as before.
Offers still go down the list in order: prepaid decides *how* a chair is
taken, not *who* is next.

**The place is a link.** A signed status token, the `standby` audience on the
guest-link secret, scoped to one row (the arrangement a bed request has).
`S-A-08s` polls it every five seconds. The seat's tracking link is minted
once, on the first read after the seat, because a second mint would kill the
link already in the SMS. A decline is `SLOT_EXPIRED` under the lapse key, and
the chair goes straight to the next person.

**Messages.** `queue.slot_offered_link` (answer here: link) for somebody who
joined from the app, `queue.slot_seated` (serial N is yours: link) for a
prepaid seat. The counter template stays for rows reception added.

**Demo data.** On the pitch chamber, standby position 1 joined from the app
and paid by bKash, so the first chair given away in the pitch seats them
automatically. Positions 2 and 3 are counter entries. Today's other Shapla
cardiology chamber is set to exactly the serials it holds, so the patient app
shows it পূর্ণ with **স্ট্যান্ডবাই তালিকায় নাম দিন** beneath.

**How to show it.** Phone: হৃদরোগ → শাপলা → the doctor who is not the pitch
doctor → স্ট্যান্ডবাই তালিকায় নাম দিন → এখনই পরিশোধ করুন → তালিকায় নাম দিন.
The status page says খালি হলে প্রথমেই আপনি. For the automatic seat on the
pitch chamber: reception marks somebody absent and taps খালি সিরিয়াল দিন; the
card shows it taken at once (position 1 prepaid). `standby.spec.ts` runs all
three paths across two devices.

**Supabase does not have 0021, 0022 or 0023 yet.**

### The check-in (`feat/check-in`, after step 19)

**The owner's ruling on decision 61** (2026-09-23): when a patient reaches
the counter, reception taps **এসেছেন** and tells them roughly how long they
will wait — the SkipTheDishes idea, a restaurant confirming an order with a
preparation time. It is a PRD change: `FR-REC-18` (the check-in and quote),
`FR-PAT-38` (the patient sees it), `PATIENT_ARRIVED` in `FR-QUE-03`, and
`FR-ADM-01`'s wait now runs from check-in to call, with the share of quotes
kept beside it.

**The event is `PATIENT_ARRIVED { bookingId, quotedWaitMinutes }`**, the
nineteenth. The arrival is the event's `serverTs`, never a figure the console
sends, so an offline console cannot record the moment the receptionist
remembered. A booked or late patient becomes `waiting` and keeps their place;
arriving jumps nobody. The first arrival stands if two consoles check one
person in. The guard refuses a second check-in, anybody in the chamber or
settled (a no-show who turns up is reinstated first), and any quote outside
0–480 whole minutes.

**The quote starts from the queue's own estimate.** `suggestedQuote` in
`shared/domain` is the minutes to `computeEtas`'s call time, rounded to five —
the number the patient's phone counts down from — and reception moves it
with − and + before confirming. On the phone it is `CARD-A08-QUOTE`: the
counter's word *beside* the live estimate, never replacing it, and "the time
the counter gave has passed" rather than a negative countdown. The leave-home
banner and আমি দেরি করছি stop applying to somebody already here. No SMS: it
was said across the counter.

**Schema.** 0021 adds the enum value on its own — a migration is one
transaction and PostgreSQL will not let a transaction use an enum value it
added — and 0022 adds `bookings.quoted_wait_minutes` (0–480, never without an
arrival) and extends the booking-scoped constraint. Both are applied to the
local container and the test databases; **not yet to Supabase**.

**The dashboard.** Average and longest wait are real now, and beside them the
share of patients called within their quote plus five minutes, and the
average minutes past it — read live, not from the snapshot, because a figure
about a promise should not lag the promise. A period in which nobody was
checked in still says so rather than showing zero.

**Demo data.** From each facility's go-live date, 85% of patients seen were
checked in 8–45 minutes before their call and quoted a round figure near
that, written as events on their own RNG stream so nothing else in the
history moved: 260 check-ins, a 26-minute average wait, 74% of quotes kept.
On the pitch session everybody already called was checked in, and the next
four in line are here; the rest are not, so a guest booked during the pitch
gets an এসেছেন to tap.

**How to show it.** Book as a guest on the pitch chamber and open the live
serial. On reception, tap **এসেছেন** on that row, nudge the minutes, নিশ্চিত
করুন. The phone shows কাউন্টার জানিয়েছে with the minutes left, inside the
canary's two seconds (`check-in.spec.ts`).

### Step 19 — the dashboard, and the figure a tap moves

**The definition of done is a chain across two consoles, and the E2E runs
it.** `no-show-recovery.spec.ts` opens `S-B-10` as the hospital's
administrator in one browser and reception in another. Reception marks serial
2 absent, taps **খালি সিরিয়াল দিন** on the new standby card, and records the
standby patient's yes with **গ্রহণ করেছেন**. The administrator's recovered
figure then goes up by exactly that chamber's fee. It is asserted as a
difference, not a total, because the seeded history already holds three weeks
of recoveries. The spec's second test covers a freed chair with nobody on the
list. `admin-dashboard.spec.ts` opens the screen **through the picker**, then
checks every section and its age, the adoption marker, the CSV download, the
offline state, and that the lab and pharmacy are offered at all (see below).

**`FR-ADM-01`'s average wait cannot be measured, and the screen says so.**
Nothing in this product records a patient arriving. `PRD.md` §8 gives reception
call, finish, late, absent, walk-in and reorder, and none of them means "this
person is here". So `bookings.arrived_at` is written only for walk-ins. The
column is computed and reports null. Beside it, the figure that *can* be
measured: how much later than their own slot people were called (planned
start + the doctor's rate × serials ahead), floored at zero. No arrival times
were seeded, because a wait figure no real deployment could produce would be
fabricated. See decision 61.

**The router takes no hospital.** `GET /admin/dashboard` and
`GET /admin/export` read the facility off the caller's principal, and a caller
cannot name one; a test passes `?hospitalId=` for another hospital and gets its
own figures back. Every export writes an `audit_log` row naming the view and
the window.

**Every section carries its own age.** The overview, the trend and the revenue
totals come from `v_admin_daily`, a materialised view. Loss, staff, beds and
the forecast are read live. Referrals and feedback are as old as their newest
row. One stamp for the screen would be true of one of those and false of the
rest, so each section renders its own `<FreshnessLine>`. **Nothing refreshes
`v_admin_daily` on a timer.** `DATABASE.md` §4 says "every 5 min", and with no
worker a read refreshes it when it is older than that. A refresh that fails
serves the older snapshot with its true age rather than an error.

**Loss is not the whole fee.** A no-show who prepaid has already paid the
hospital, and a no-show earns no refund in this version. So the loss tab shows
the forgone value, the prepaid part of it, and what was actually never
collected. Recovery is measured against the last of those. Punctuality is a
median, not a mean: one four-hour day would otherwise describe no day the
doctor has had. The forecast answers "too little history" below two
observations instead of inventing a staffing figure.

**The standby card (`BTN-B02-OFFER`, `FR-REC-30`) is new on `S-B-02`.** It
appears when a chair is free, an offer is out, or anybody is waiting, and it
reads the free chairs and offers from the same queue state as the table, so
the two cannot disagree. Offers are **online-only**, because who is asked is
the server's decision, taken under a row lock so two counters never ask the
same person. An offer queued offline and sent an hour later would text
somebody about a chair the chamber had already passed. The button also waits
while the outbox holds actions: a no-show shows the chair as free here before
the server knows, and an offer sent in that gap is refused `SLOT_NOT_FREE`.
With nobody on the list, the card says the chair stays empty instead of
showing a dead button.

**Acceptance is recorded by reception**, which `BACKEND.md` §7 does not say.
See decision 62.

**Chart colours are tokens.** Recharts (named in `FRONTEND.md` §9) draws in
`var(--brand-600)` for a single series. The one two-series chart (never
collected vs recovered) pairs it with `var(--line-strong)`. That pair was run
through a colour-vision check: ΔE 42 protan and 45 normal, so the two are
easily told apart. The grey is faint against a card (1.44:1), so the chart
always has a text legend and the CSV is its table. Bars are one colour whatever
their rank. Console surfaces use Latin numerals (`TYP-04`).

**Demo data** (`FR-DEM-*`). Each hospital is onboarded twelve days into its
twenty-one days of history, and chambers run closer to plan afterwards. The
trend therefore has a before and an after either side of `FR-ADM-02`'s marker:
average overrun falls from 45 minutes to 22, and chambers running late from
94% to 64%. Twenty offers, fourteen taken, ৳16,000 recovered against ৳27,300
never collected — seeded as **events**, not rows, so the log and the table
replay into the same history. 202 feedback responses across `FR-PAT-83`'s four
dimensions, billing the weakest, and the screen says they are demonstration
rows, because the patient form is not built. The pitch session already had
three people on standby (`seed_07`), so the card is on screen the moment
reception opens.

**How to show it.** Console → any hospital → **ড্যাশবোর্ড খুলুন**. The
overview says wait is not measured and why; প্রবণতা shows the adoption
marker; ক্ষতি ও পুনরুদ্ধার shows the money. For the live half, open the pitch
chamber's reception in a second window. Mark somebody absent whose grace has
run out, tap **খালি সিরিয়াল দিন** then **গ্রহণ করেছেন**, and reload the
dashboard's loss tab. The recovered figure has moved by that chamber's fee.

**Supabase is five migrations behind.** `0009_money.sql`, `0011_ancillary.sql`,
`0018_lab_idempotency.sql`, `0019_payment_ambulance_fk.sql` and
`0020_admin_views.sql` have been applied to the local container and both test
databases, and not to Supabase. Until they are, the deployed console cannot
open the lab, the pharmacy, a payment or this dashboard. All five are additive.
The demo data those screens read comes from a reseed, which truncates and is
the owner's to authorise:

```bash
ALLOW_REMOTE_DB=1 pnpm db:migrate                         # additive, safe
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset    # only on the owner's word
```

#### Found while finishing it

**The lab and the pharmacy were never offered in the picker.** `demo.service`'s
`OFFERED` list and `demoTokenBody`'s enum both lacked `lab` and `pharmacy`
from step 17 on. So **ল্যাব খুলুন** never appeared, and `POST /demo/token`
refused both roles. The step 17 notes' "Console → any hospital → ল্যাব খুলুন"
was not reachable. `lab-report.spec.ts` writes its token straight into storage,
the same blind spot that hid the ER role at step 15. Fixed, and
`admin-dashboard.spec.ts` now opens through the picker and walks every
hospital's offer.

**A lapsed offer went back to the person who had not answered.**
`claimNextStandby` ordered on position alone. Once an offer lapsed it was no
longer "open", so the re-offer went straight back to position 1. `FR-QUE-30`
says "unaccepted offers pass to the next patient". Anybody with an unanswered
offer in the session now sorts behind everybody not yet asked, and the list
comes round to them once everybody else has had a turn.

**The screen had been drafted against APIs that do not exist.** The first
draft of `AdminDashboard.tsx` gave a clickable handler to `<Chip>` (it is a
status label; `<FilterChip>` acts), gave `className` to `<Card>`, called
`<FreshnessLine>` and `<OfflineBlock>` without their required props, used a
message key that did not exist, and hard-coded a hex ramp. It never compiled.
It was rewritten against the real components before anything was committed.
**A component nobody has type-checked is a sketch, whatever it looks like.**

### Step 18 — the money, and what a number somebody agreed to is worth

**The definition of done is the idempotency test** (`CLAUDE.md` §4), and it is
the first describe in `payment.routes.test.ts` because the failure it guards
against is the only one in this step that takes money from a person. It is
tested two ways: a retry after the first completed, and five identical
requests in flight at once — which is what a patient double-tapping confirm on
a bad connection actually produces.

**`FR-PAY-06` is three deep.** The caller's key is unique in the database,
serialised by an advisory lock so a replay that races its original waits, and
passed to the provider so even a retry past both finds the same transaction.
Any one would usually do. Payments get all three.

**A client never says how much.** An intent names *what* is being paid for and
the amount comes from the booking's own `fee_poisha`, copied on at booking
time (`DB-P5`) so a later fee change cannot alter what was charged. A refund
names a *reason* and the amount is `refundFor` in `shared/domain`. Neither
number is ever in a request body, so neither can be argued with — and the test
that sends `amountPoisha: 1` gets charged the real fee.

**Money is never edited, only added to.** A trigger refuses any change to
`amount_poisha` or `platform_fee_poisha`, the way `ambulance_requests` refuses
a change to a quoted fare (`FR-PAT-74`). A refund goes in `refunded_poisha`,
so a settlement can always state collections and refunds separately. Six CHECK
constraints hold the state and the numbers to each other, because a settlement
computed from rows that could contradict themselves is fiction.

**`refund_policy` has a shape now** — open decision 12, which step 18 was the
step that needed it. It is `cutoffHours`, two percentages and whether the
platform fee comes back, validated on the way in. **A half-written policy is
read as no policy**: filling in a missing field would state a refund the
hospital never agreed to, which is worse than having none. Four demo
facilities have terms and two deliberately do not, so a cancellation at
Karnaphuli or Buriganga says the hospital will decide — the honest-degradation
case (`PRD.md` §3.2), demonstrable rather than only described.

**Doctor absence is the platform's guarantee, not the hospital's terms.**
`FR-PAY-07` returns everything including the platform fee, and no policy can
reduce it: the patient did not cancel, so no cancellation policy applies to
them. It is raised automatically when a session ends — every patient who paid
and was never seen is marked owed in one statement, after the commit, in a
way that cannot fail the session's end. A session has ended whether or not the
money bookkeeping succeeded, and an end that rolled back because a payment
query was slow would leave a chamber running on every screen in the hospital.

**Eligibility, not payment.** Each refund is then its own decision with its own
provider call. A batch of gateway calls inside a session's end would make
ending a session fail when a provider is slow. The patient is owed the moment
the session ends; the money follows.

**What counts as absence** is not defined by any document. Implemented as: the
session ended and no `DOCTOR_ARRIVED` was ever appended. A session where the
doctor came and simply did not reach everybody is recorded as `session_ended`
instead — those patients are equally owed, and the reason says which happened
so an administrator is not told a doctor was absent when they were not.

**`MOD-A08-CANCEL` states the refund in taka**, not as a percentage, computed
by the same function the server refunds with. That is the whole of
`FR-PAY-03`: a rule the screen computes one way and the server another is a
rule that gets stated wrongly.

**Subscriptions and invoices have tables and no data.** What a module costs,
what tiers exist and what a hospital is charged are negotiated per agreement
and live outside this repository (`CLAUDE.md` §1.1). The code can invoice;
what it invoices for is not a code decision. `PLATFORM_FEE_POISHA` stays 0, so
the platform fee is itemised as zero rather than hidden (`FR-PAY-04`).

**bKash and Nagad are not implemented, and say why in detail.** Both need
merchant credentials that arrive with an agreement. Rather than write an
integration nobody has ever seen run, each adapter carries the *shape of the
work* — the call sequence, which response actually means the money moved, and
the one thing that bites. For bKash: the merchant invoice number is the
idempotency key and it is per-merchant forever, which is why the service sends
the payment's own uuid v7 rather than the caller's key. For Nagad: the
timestamp is Dhaka local and they reject anything a minute out, and **refunds
are not in their checkout API at all** — worth knowing before automatic
refunds are promised to a hospital for every method.

**Demo data.** `seed_08_money` is its own module and runs last: 927 payments,
one per booking with a payer, and twelve counter shifts. The payment mix is
declared rather than uniform — most people still pay at the counter — because
a settlement split evenly four ways looks like test data to anybody who has
run one. One shift in four is deliberately short of its expected figure, since
a demo where cash always reconciles hides the only thing `counter_shifts` is
for.

**How to show it.** Book as a guest and pay by bKash; the serial screen's
বাতিল করুন now names the taka coming back. Then, on the console, end that
chamber's session with people still waiting — every one of them is marked owed
without anybody asking, which is `FR-PAY-07` and the part of the pitch that
says the platform is on the patient's side.

#### Three bugs the tests found, and one the ordering did

**A pool deadlock, found by the concurrency test.** `createIntent` held a
transaction on the advisory lock while `findDetail` took a *second* pool
connection. Five concurrent identical intents exhausted a five-connection pool
and waited on each other. `findDetail` now takes the caller's transaction and
says in its own doc comment why that matters — the same shape exists anywhere
a repository read is made from inside a transaction on `db` rather than `trx`.

**Every genuine webhook was rejected.** `express.json()` consumes the stream
before any route runs, so the webhook's own `text()` parser found nothing and
verified a signature over an empty string. Every real callback failed and
every forged one failed identically, which is why nothing looked wrong. The
raw bytes are now captured by the JSON parser's `verify` hook and kept in a
`WeakMap` keyed by the request — only for `/webhooks/*`, because a copy of
every request body in memory is a copy of patient data in memory.

**The money seed covered a quarter of the bookings.** Written into
`seed_04_history` first, which runs before `seed_05_beds` and
`seed_07_demo_live` — so 367 payments instead of 919, and the pitch session's
own bookings, the ones a demo shows, had none at all. It is `seed_08_money`
now and runs last. **The general lesson: a seed that reads rows another seed
writes has to run after it, and the order is not obvious from the file name.**

**A migration numbered backwards into the sequence.** `payments` references
`ambulance_requests`, which 0011 creates — and on a fresh database the runner
applies files in filename order, so 0009 runs first. The local development
database already had 0011, so `db:migrate` was green there and only a build
from scratch failed. `0019_payment_ambulance_fk.sql` adds the key afterwards.
**A green migrate on a database that is already ahead proves nothing about a
fresh one.**

### Step 17 — the lab, and what a report is a promise about

**The definition of done is one sentence, and the E2E is that sentence.**
`lab-report.spec.ts` drives it through three screens in one run: a doctor
ticks a chip on `BTN-B05-TEST` and signs, the order appears on a bench in
another browser context, the bench takes the sample, processes it and chooses
a real PDF — and the patient, whose phone has held nothing but a tracking
link since booking, opens the report. The rest of the spec: a test still on a
bench says what is happening to it rather than "no reports"; a patient with no
test is shown no Reports tab at all; the bench opens on work rather than on
nothing; and a pharmacy flagging a medicine নেই reaches the public search.

**Uploading is delivering, and that is one transaction.** `FR-LAB-03` says a
report "auto-delivers to the patient wallet and the ordering doctor", so
there is no separate *send* button — the file is stored, the `reports` row is
written, the order closes as `delivered` and `delivered_to` names whom it
reached, or the whole thing rolls back and the lab is told the upload failed.
A report row claiming a delivery that did not happen is the one outcome worth
designing against. The file is stored **before** the transaction opens: the
worst case is then an orphaned object, which costs bytes, rather than a
`file_url` pointing at nothing.

**The lifecycle only moves forward.** `shared/domain/src/lab/orders.ts` is the
API's guard and the console's optimistic update, as `referrals.ts` is for a
referral. A lab that mis-taps cancels and re-orders, which leaves both rows
visible; walking an order back is refused, because the timestamps are
`FR-LAB-04`'s measurement and a measurement that can be edited is not one.
`delivered` is deliberately absent from `LAB_ACTIONS`: it is the server's own
step, so a console cannot claim a delivery it did not perform.

**A stale tap is a replay, not a refusal.** A console whose outbox held
*collect* while the bench moved on gets a 200 and a `duplicate`, because the
action's outcome has held since the sample was taken. The genuine refusal is
reserved for working an order already cancelled. The lab console is
online-first by choice — a bench's actions are minutes apart and an upload is
a file — but every send carries a `clientEventId` and an idempotency key, so
adding an outbox later is a store rather than a redesign.

**The patient's name is not on the queue.** A row is the test, its state and
its age; the name is one tap and that tap is a request the server records
(`DB-P7`), the arrangement the ward board's bed panel already has. A bench
calling somebody to a counter needs it; a screen left open on a shared desk
does not.

**Turnaround is measured from the promise the patient heard** — ordered to
report ready, not sample to ready. The hour a sample sat uncollected is part
of what somebody told "come back this afternoon" actually waited. Delivery is
not the end point: ready-to-delivered measures this system rather than the
lab. A type with no finished order says it has no measurement instead of
reading zero, and the open count and the oldest waiting order sit beside the
median so a lab cannot improve its figure by never finishing anything.

**`FR-PHR-01` is not built, and this is the reasoning.** Dispensing against a
prescription QR is downstream of `FR-DOC-04`, which the owner removed on
2026-09-19. No code path and no seed creates a `prescriptions` row, so a
scanner would open a camera onto an empty table and `POST /prescriptions/:id/dispense`
would guard a table that is always empty. It follows prescribing out of scope
the same way `TBL-B05-RX` did. `FR-PHR-02` needs no prescription and is built
in full. `PRD.md` §12 and `APP_FLOW.md` B5 were edited to say so.

**`FR-LAB-01`'s "and app bookings" is also not built.** A patient ordering
their own test is `S-A-13`, a catalogue-plus-payment flow that is not in step
17's contents. Doctor orders are this version's producer. `test_orders.visit_id`
is nullable already, so `S-A-13` needs no schema change when it lands — and the
seed uses that nullability today for walk-in orders, which is both the
commonest way a test is ordered here and the path where a report reaches one
recipient rather than two.

**A stock flag goes quiet rather than lying.** After twelve hours an in-stock
claim is published as *জানা নেই* instead of repeated; an out-of-stock flag
stands until somebody clears it, because a pharmacy that restocked has every
reason to say so and one that has run out has none to keep saying it. Twelve
hours rather than a bed's ten minutes: a shelf does not empty that fast, and
a ten-minute threshold would mark the whole list unknown by mid-morning and
teach families to ignore the feature. `S-B-09` shows each row as **what a
patient is being told right now** beside what the counter last said —
`FR-BED-06`'s idea applied to a shelf.

**Demo data** (`FR-DEM-03`, `FR-DEM-05`). `seed_06_ancillary` runs for the
first time: eight ambulances, thirty blood donors and exactly fifty pharmacy
items — ten formulary medicines on five shelves. Nothing is waiting on a
migration any more. `seed_04_history` writes the reports half of `FR-DEM-03`
that step 12 deferred: 170 test orders, 112 delivered reports, turnarounds
drawn per test type so the medians differ and the slowest-first ranking has
something to rank. One shelf (Karnaphuli) is deliberately two days old, so
the lapse to *জানা নেই* is visible in the demo and not only in a test.

**Every lab opens with work.** Which hospital held a consultation in the last
two days is luck of the seeded history, and on most resets two labs had none —
so `S-B-08` opened empty at exactly the hospital a demo was being shown at.
The top-up is walk-in orders with no visit behind them, spread across all
three open states and the last thirty hours.

**Seeded reports point at a file that resolves.** A seed runs in its own
process and cannot put bytes into the API's, so a report row would 404 when
tapped — the demo promising a document it cannot open. The mock store
synthesises a one-page placeholder for keys under `reports/demo/`, labelled as
demonstration data in the PDF itself (`FR-DEM-07`). Nothing outside the mock
provider has that behaviour and a real bucket never sees the prefix.

**How to show it.** Console → any hospital → ল্যাব খুলুন for the bench, and a
second window on the same hospital's চেম্বার as the doctor. In the chamber:
type a diagnosis, tick a test chip, রেকর্ড দিন ও পরবর্তী. The bench's queue
gains the row without a refresh; নমুনা নেওয়া হয়েছে → প্রসেসিং → রিপোর্ট দিন
with any PDF, and the toast says both the patient and the doctor have it. On
a phone, the patient's রেকর্ড tab now has a রিপোর্ট tab beside it. For the
pharmacy: ফার্মেসি খুলুন, mark something নেই, then ওষুধ খুঁজুন on the patient
app and search that medicine.

**Supabase does not have this yet.** Migrations `0011_ancillary.sql`,
`0018_lab_idempotency.sql`, `0009_money.sql` and
`0019_payment_ambulance_fk.sql` have been applied to the local container and
to both test databases, and nowhere else. Until they are applied to Supabase, the
deployed console's lab and pharmacy screens will fail on their first read, and
the deployed patient app's medicine search will too.

All four are additive — new tables, new columns and one foreign key, nothing
dropped — so applying them is safe. Getting the *demo data* there is the destructive
half: the lab queue, the fifty pharmacy items and the delivered reports come
from a reseed.

```bash
# Additive, safe, no data lost:
ALLOW_REMOTE_DB=1 pnpm db:migrate
# Then, and only with the owner saying so, because it truncates:
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset
```

**A remote reset is the owner's to authorise, every time.** Nothing in step 17
was run against Supabase.

#### The CORS bug the E2E found, which nothing else would have

`PUT` was missing from the API's `Access-Control-Allow-Methods`. The pharmacy
console could never have saved from a browser — **and neither could the ER
console's capability switches (`PUT /hospitals/:id/capabilities`), which have
been unreachable that way since step 15.**

The failure is close to invisible. The preflight answers 204 and looks fine;
the browser then refuses to send the real request on its own; nothing
server-side logs anything, because the request never arrives. Unit and API
tests all pass, because supertest is not a browser. Only a real page found it.

`app.test.ts` now reads the verbs off the mounted router stack and asserts
every one appears in the preflight's allowed methods, so a route added with an
unlisted verb fails in CI. It was verified to fail without the fix.

**The lesson worth keeping:** a middleware allow-list that is written once and
grows by hand is a class of bug that only a browser can see. The same shape
applies to `ALLOWED_HEADERS` — a route that starts requiring a new request
header will fail the same silent way.

### Step 16 — referrals, and who holds the person

**The definition of done is two consoles, and the E2E runs them.**
`referral.spec.ts` opens Jamuna's ER in one browser context and Shapla's in
another: Jamuna registers a walk-in, taps রেফার খুঁজুন, names an ICU bed as
the need, and the list keeps only the ERs that have one; রেফার পাঠান puts a
card on Shapla's `LIST-B07-IN` inside the alert's five-second budget. Shapla's
first touch stamps *seen* on Jamuna's row, রাজি — পাঠাতে বলুন accepts, and
এসে পৌঁছেছেন moves the person: a token at Shapla, Jamuna's case closed as
`referred`, both timelines agreeing. The rest of the spec: a decline arrives
with its reason and the case is Jamuna's to try elsewhere; a withdrawal clears
Shapla's card; an answer given offline is shown at once and sent on reconnect;
the consoles open on the seeded referrals; and Karnaphuli, two hundred
kilometres from any other ER, is told so rather than shown an empty list.

**Who holds the person, on the owner's ruling (2026-09-22).** The sending ER
keeps the case — on its triage list, counted in its load — until the receiving
ER records the arrival. Somebody in an ambulance between two hospitals is
still the sender's. That one act (`POST /referrals/:id/arrive`) does both
things in one transaction: opens a case with a token at the receiver and
closes the sender's as `referred`. While a referral is open the case is held —
`handoff`, `discharge` and the ward's admit all refuse it with
`details.guard = 'REFERRAL_OPEN'` — because a bay prepared for somebody who
has been sent home is worse than a refusal.

**A decline is not a referral.** `BTN-B07-DECLINE`'s suggestion list (step 15)
stays read-only, which is the opposite of what the build plan expected. A
decline happens *before* arrival: the family is still on the road, they choose
where to go next, and nothing on the family's side follows a referral. Sending
one would prepare a hospital for a family nobody told. Referrals are for
somebody already in this ER, and the button that starts one is on the triage
row (`BTN-B07-REFER`).

**What a referral asks for.** 0008 made `required_capability` NOT NULL, which
made "our ICU is full" impossible to send — and four of `FR-PAT-42`'s eight
problems map to no capability at all. 0017 makes it nullable and adds
`required_bed_kind`: a referral asks for a capability, a kind of free bed, or
both, never neither. The need defaults from the problem and the coordinator
can override it. The search then keeps only ERs with that capability *and* a
free bed of that kind (`referralCandidates` in `shared/domain`), and says how
many it left out and for which of the two reasons — an empty list that
explains itself rather than a hospital that seems not to exist.

**One state machine, two users, as cases and beds have.**
`shared/domain/src/emergency/referrals.ts` is the API's guard and both
consoles' optimistic update. Every step belongs to one side: the receiver
sees, answers and records the arrival; the sender can only withdraw, and the
other side's step is refused as `WRONG_SIDE` whatever the role. An answer
given before anybody touched the card stamps `seen` with it, so the timeline
never says a hospital accepted something it had not seen. A step already taken
is a replay and is answered as one — which is what makes the offline outbox
safe without an event log. **U:** one open referral per case, so two ERs are
never preparing for one person.

**Nothing in a referral names anybody.** The summary is the case's problem,
colour, age and sex plus an optional note of at most 500 characters, and it is
read from the case rather than sent by the client. A family's number stays
with the ER it was given to; the arrival opens a case at the receiver with no
phone at all, and the ward takes the name at the bed.

**Demo data** (`FR-DEM-04`). Four referrals between the three Dhaka ERs, each
for a gap the sender really has: Shapla has no burn unit (sent to Padma this
morning, the whole timeline through arrival), Padma has no cath lab (Shapla
declined, with its reason, and the case is still Padma's), Jamuna has no ICU
(seen, unanswered — Shapla opens on it), and Jamuna's HDU is full (Shapla
accepted; the person is on the way and still Jamuna's). No notes: a note is a
clinical summary in a coordinator's words, and inventing one would be clinical
content nobody declared.

**How to show it.** Console → Jamuna Medical College → জরুরি বিভাগ খুলুন, and
Shapla General's ER in a second window. Shapla opens with Jamuna's ICU ask
waiting. On Jamuna's side, a triage row → রেফার খুঁজুন → আইসিইউ বেড → Shapla →
রেফার পাঠান; Shapla's card appears and rings. Then রাজি — পাঠাতে বলুন, and
এসে পৌঁছেছেন when the person is at the door — Jamuna's row closes and Shapla's
triage list gains a token in the same moment.

**Supabase has this** (2026-09-22, on the owner's say-so). It was five
migrations behind, not one — 0008 and 0012 from step 14 had never been run
either — so `ALLOW_REMOTE_DB=1 pnpm db:migrate` applied 0008, 0012, 0013, 0016
and 0017 in one go, `db:verify` passed, and
`ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset` rebuilt the demo data:
the reset reported 170 beds, 26 emergency cases and 4 referrals among the rest.
That is the database, checked directly; the deployed console and apps were not
opened afterwards, and the API sleeps on Render's free tier, so give it a warm
load before showing anyone. **A remote reset is the owner's to authorise, every
time.**

**Found by running the suite, not by writing it.** The api project's seventeen
files share one mutated database (a test that goes through the API cannot be
rolled back around), and vitest was running them in parallel workers. Step
16's handover test asserts that Shapla's `er_active` moved by exactly one
while step 15's file opens and closes cases at Shapla — so it failed about one
run in three, on a number two higher than it should be. The api project now
runs `maxWorkers: 1`, which removes the class rather than the instance; it
costs about thirty seconds on `pnpm test`. `fileParallelism: false` would have
done it too, but vitest applies that to the whole run and the unit, ui and
schema suites need no such care.

### Step 15 — the emergency search, the ER console, and the family told

**The definition of done is the pitch, and the E2E runs it.**
`emergency-burn.spec.ts` stands a phone at Farmgate and opens Padma's ER
console in another context: জরুরি → দগ্ধ ranks Padma first (fresh) above
Jamuna (nearer, stale, labelled with its age) and Shapla (no burn unit, and
saying so); "I'm on my way" rings the console inside five seconds; প্রস্তুতি
নিন turns the family's screen to হাসপাতাল প্রস্তুত; গ্রহণ করুন gives a token.
The rest of the spec: a decline reaches the family with its reason; the family
calls off and the ER hears; critical gives one answer; a phone with no location
is still answered; the ER hands a case to the ward and the ward admits it; the
ER works offline. The API suite (`emergency.routes.test.ts`, 32) proves the same
ranking with the clock set just after Padma's own stamps, so it cannot depend
on how long the suite has been running.

**Schema, on the owner's ruling (2026-09-21).** 0013 holds one function,
`fn_nearby_hospitals` — geography only; the order is `shared/domain`. 0016
gives `emergency_cases` what the documents needed and 0008 had nowhere to put:
age and sex of an anonymous caller, a `declined` state with its reason, the
ER→ward handoff (`admit_bed_kind`, `admit_requested_at`), `closed_at`, and an
idempotency key. 0016 is numbered past 0014/0015, which keep their names.

**One state machine, two users**, as beds have: `shared/domain/src/emergency/
cases.ts` is the API's guard and the console's optimistic update. Accept means
*the person is here* (a token is given); prepare is "we are ready". A decline or
a cancel happens only before arrival — after it, leaving is a referral. An
action whose outcome is already the case is a replay and is answered as one,
which is how the offline outbox is safe without an event log.

**The ranking** is capability, then fresh before stale (inside the capability
tier), then travel time, load, free beds. Its freshness uses only the figures
it ranks on: the capability and the relevant bed count. **The ICU was in it and
came out** — a full ICU has no action that renews its stamp, so it turned a burn
unit confirmed a minute ago stale ten minutes after any reset. The card shows
the ICU with its own freshness line instead. The first card is headed "best
placed now", never "nearest": the nearer hospital can be the stale one.

**Identity.** The ER's list and every broadcast carry `hasPhone`, never the
number. ফোন করুন fetches it one case at a time and that read writes
`audit_log`. The ward's ER half of the pending list names nobody either; the
ward takes the name at the bed. The caller's position is used for one ETA and
never stored.

**The family's side is polled, not a socket**: `S-A-10c` looks every five
seconds while the answer can change (decision 35 again). A number left with the
alert gets `emergency.acknowledged` / `emergency.declined`, which name the
hospital and never the problem.

**Demo data** (`FR-EMG-03`, `-04`, `FR-DEM-04`). 23 cases across the four ERs
with a coordinator: Jamuna busiest (8 open, one family already on the way and
acknowledged), Shapla 4, Padma 3, Karnaphuli 2, plus discharged cases earlier
today. Two are already handed to the ward (Shapla CCU, Jamuna burn), so the
pending list opens with its ER half. No clinical notes.

**How to show it.** Freshness decays: Padma's burn beds and capabilities are
fresh for ten minutes after a reset. Before the scenario, reset — or open
Padma's ER console and tap **সব ঠিক আছে — নিশ্চিত করুন**, and tap Padma's free
burn bed through a clean on the ward board. Then: console → Padma → জরুরি বিভাগ
খুলুন. Phone (location allowed, or Chrome's sensors set to Farmgate
23.758, 90.39) → জরুরি অবস্থা → জরুরি → দগ্ধ → আমি রওনা দিচ্ছি → জানান ও রওনা
দিন. The console rings; প্রস্তুতি নিন; the phone says হাসপাতাল প্রস্তুত.

**Supabase has this**, as of the 2026-09-22 migrate and reseed described in
the step 16 notes above.

**Found by looking, not by the tests.** The E2E writes the demo session
straight into `sessionStorage`, so it never used the picker — and
`POST /demo/token`'s schema still listed the four step-14 roles. The picker
offered "জরুরি বিভাগ খুলুন" and the route refused it. Fixed, and
`demo.routes.test.ts` now mints a token for every role the picker offers. The
same look found the shared `<Sheet>` sliding *under* the patient app's bottom
navigation (`z-40`), hiding its own primary button — step 14's bed-request
sheet had the same defect unseen. Fixed once, in `shared/ui`.

### Step 14 — the ward board, and what the public is shown

**The definition of done is a comparison, and the E2E makes it.**
`ward-board.spec.ts` opens the ward board in one browser context and the
patient's bed search in another, and holds `<CapacityMirror>`'s published
figure and the phone's count to the same number before and after an admit.
The API suite does the same arithmetically: the board's own tally
(`tallyByKind` in `shared/domain`) equals the view's row, kind by kind.

**Schema.** 0008 creates all seven tables DATABASE.md §7 names for it —
`emergency_cases` and `referrals` are schema for steps 15–16, as 0007 was for
the lab. 0012 holds one view, `v_public_hospital_capacity`; the other `v_*`
views read tables later steps create, and a shipped migration is never edited,
so each arrives with its own step. The columns DATABASE.md §2.5 lacked are now
in it, each with the control that needed it.

**One state machine, two users.** `shared/domain/src/beds/board.ts` is the
API's guard and the console's optimistic update, the way the reducer is the
queue's. A discharged bed goes to *cleaning* and a person frees it — no timer
frees a bed nobody has looked at. A lapsed hold counts as free everywhere at
once; the logged `RELEASE` (by nobody) is written when the board or the pending
list is next read, and a bed about to be acted on is swept first. No scheduler
was needed.

**A hold is a real bed.** Holding a request reserves a bed of the kind asked
for, so the public count knows about the promise. `release` refuses a bed held
for a request — answer the request instead, so the family is told.

**Names are read on purpose.** Tiles, broadcasts and the board response carry
no patient. The bed panel and `LIST-B06-PENDING` do, each read writes
`audit_log`, and both need the connection: a copy cached on a shared ward
computer would be a read nobody logged.

**Offline** (`FR-OFF-01`, the owner's choice of full writes): a separate bed
outbox in `shared/client`, because the queue's is built around one session's
batch and each bed route is replay-safe on its own. Oldest first; a refused
action is dropped and rolled back; an unreachable one holds back everything
after it. The mirror shows "the board says N — the app still shows M" while an
admit is queued.

**Bed requests.** `POST /bed-requests` is public like a guest booking, returns
a signed status token (the `bed_request` audience on the guest-link secret),
and the phone keeps it — no SMS is sent until the hospital answers. Hold and
decline go out as `bed.request_held` / `bed.request_declined`. The status page
counts a hold down in minutes and says "expired" the moment it runs out.

**Demo data** (`FR-DEM-04`). 29 wards and 170 beds at the four facilities with
ward staff; the diagnostic centre and the clinic have none and the app says "no
inpatient beds", not "0 free". ICU at exactly Shapla, Padma and Karnaphuli
(Buriganga lost its ICU on the owner's ruling); burn units at Padma and Jamuna.
137 admissions (134 occupied beds, 3 just discharged into cleaning), four
pending requests (one held, at Shapla's cabins). Staged for the emergency
scenario: Padma's ICU full, one fresh free burn bed at Padma, two free burn beds
at Jamuna that nobody has confirmed for hours. The commit that added the seed
(`6626c87`) says 180 beds; 170 is the count.

**Freshness decays, and that is the point.** A kind's stamp is its newest bed
event. With the default ten-minute threshold, every ward turns amber ten minutes
after a reset unless someone touches the board. Before showing the burn
scenario, reset or tap a Padma burn bed.

**How to show it.** Console → pick Shapla → বেড বোর্ড খুলুন. Admit into a free
general bed at the desk; the mirror's general row drops by one, and a phone on
`/beds?kind=general` shows the same number on its next read. For a request:
phone → বেড অনুরোধ করুন → the ward's pending list → বেড রাখুন → a bed → a
duration; the phone's status page counts down.

**Supabase has this**, as of the 2026-09-22 migrate and reseed described in
the step 16 notes above — 0008 and 0012 had sat unapplied since this step was
built, which is why the deployed console had no ward board for two steps
without anybody noticing.

### Step 13 — the wallet, and consent

**The wallet is this device's, like the serials tab.** There are no accounts
(`CLAUDE.md` §4.1), so `S-A-12` opens every tracking link the phone holds and
shows the signed record each one carries (`FR-GST-08`). A link has four
outcomes — a record, booked-but-not-seen, expired, no answer — and each is
counted and said separately. A failed request is never shown as "no records".
When Supabase Auth lands, the page becomes one call to
`GET /patients/:id/records`, which already exists and already refuses
everybody it should.

**Consent is a handshake.** The phone asks for a code (`BTN-A12-QR`), states
the scope and the grant's length *before* showing it, and the doctor console
redeems it (`BTN-B05-SCAN`, `POST /consents/qr`). Redeeming writes the
`consents` row and its `audit_log` row together; opening the history writes
another. The patient's access log (`BTN-A12-ACCESS`) lists each hospital with
its state as a word, a revoke on the live ones, and every staff read.
Revocation is a timestamp (`DB-P2`).

**The code is pasted, not scanned** — see open decision 28. Between two
windows on one laptop it copies and pastes; between two phones it does not
travel, which is the one place the demo is weaker than the requirement.

**A guest can speak for their own booking's patient, under `DEMO_MODE` only**
— open decision 27. Without it nothing on the patient side can offer consent
or read an access log, because nothing on the patient side has an account.

**The route is `/consents/qr`, as `BACKEND.md` §7.6 names it.** The first
commit on this branch served it at `/consents/redeem`; the document wins
(`CLAUDE.md` §2), so it was renamed. §7.6 had no row for minting the code or
for the access log, and now has both.

**The console card clears when the patient changes.** It is keyed on the
booking in the chamber, so a consented history is never on screen when the
next person walks in — a wrong allergy history is worse than none.

**No consent or audit rows are seeded.** Every seeded patient is unreachable
from a phone (no `guest_links` are seeded, for the reason under *How to open
the live serial screen*), so seeded grants would appear on no screen. The
wallet fills during the demo itself: book, let the doctor sign, and the record
is there (`PRD.md` §24 step 6).

**How to show it.** Book on the phone, sign on the doctor console, open রেকর্ড.
Then কোড দেখান, copy it into the doctor console's code field, and রেকর্ড
খুলুন. Back on the phone, কে দেখেছে shows the hospital and the reads, and
অনুমতি বন্ধ করুন ends it.

### Step 12 — the doctor console and the visit record

**Migration 0007 landed behind 0010, and that is fine.** The runner applies
whatever a database has not seen, in filename order, so a fresh build runs
0007 before 0010 and an existing one runs it after. The dependency runs the
other way: 0010 deliberately left `feedback` out *because* its foreign key
needs `visits`, and 0007 creates both. 0007 also creates `medicines`,
`prescriptions`, `prescription_items`, `test_orders`, `reports`,
`patient_documents` and `consents` — the set `DATABASE.md` §7 names — so steps
13 and 17 are screens rather than schema.

**Prescribing is out of scope, not deferred.** The owner dropped it on
2026-09-19 ("no need for e prescriptions"). `FR-DOC-04`, `FR-DOC-05` and
`FR-DOC-07` are marked **not in this version** in `PRD.md` §9, `PRD.md` §24
step 6 and §26 P2 are rewritten, and `APP_FLOW.md` B2 now says which of its
controls exist. What a consultation produces is a visit record — diagnosis,
Bangla advice, follow-up date — which is what the wallet reads at step 13.

**`BTN-B05-SIGN` writes the record, then advances the queue.** In that order,
because `APP_FLOW.md` B2 fixes the failure mode: if the record does not save,
the consultation is not marked done and the draft stays on screen. The two are
not one transaction — `callNext` owns its own lock and dispatches notifications
after committing — so the window is *record committed, queue not yet advanced*,
and a second tap recovers it because `upsertVisit` is idempotent on the booking
and keeps the original `signed_at`. The recoverable order was chosen over the
atomic one deliberately; the alternative loses a record.

**Picking "doctor" in the console picker now opens the doctor console.** It
always opened reception before, whatever was chosen, which made that button a
lie. `DemoSession` carries the role; unrecognised roles land on reception,
because `hospital_admin` is `S-B-10` at step 19 and a blank screen would be
worse than a queue.

**`useReceptionQueue` is now `useSessionQueue`**, because both consoles use it.
Same socket, same reducer, same offline log — which is what makes `FR-QUE-53`
hold: the doctor's *next* and reception's *next* serialise against each other
only because both screens read the same state from the same place.

**Demo data in the same branch.** 500 signed visit records, each with a
diagnosis and Bangla advice *paired to the complaint the booking already
carried* (`assessmentFor` in `seeds/data/reference.ts`), a ten-medicine
formulary, and pre-visit intake — duration, chronic conditions, current
medicines, allergies — on every seeded booking. `FR-DOC-03` puts all four on the
doctor's screen, and the panel distinguishes *none declared* from *nobody asked*
because those are different facts.

### The patient app is an app now (`feat/app-shell`)

Two things the owner asked for directly, in one branch.

**Discovery asks for a hospital first.** `APP_FLOW.md` titles `S-A-07`
"Specialty results (**hospitals offering it**)" and the code asked for a doctor
straight after the specialty. The flow is now specialty → hospital (`S-A-07`) →
doctor (`S-A-05h`) → session → confirm, which is both what the document said and
what he asked for. Two endpoints carry it:

- `GET /hospitals?specialty=CARD` — only hospitals that offer the department,
  each card carrying the doctor count for *that* department, how many chambers
  are running now, and how many serials are still open today. Without a
  `specialty` the doctor count is null, because a count across every department
  answers a question nobody asked.
- `GET /hospitals/:id/doctors?specialty=CARD` — new. What a hospital card opens
  onto. Ordered by who is in a chamber now, then by who sits next; a doctor with
  no upcoming chamber sorts last rather than being hidden.

Both responses carry an `asOf` the server stamps, and both lists render
`<FreshnessLine>`: "who is sitting now" is a live figure and `FR-PAT-14` does
not let one on screen without its age.

**The shell.** `NAV-A` (four tabs, labels always visible per `ICO-03`, safe-area
inset), a web manifest, a service worker, and `S-A-02` Home composed to the
canvas order — emergency, then care, then convenience. The service worker
**never answers an API request from a cache**: a serial from a cache is a number
with no age (`FR-OFF-03`). It caches the shell only, so the app opens on a bad
connection and shows its own offline state rather than the browser's error page.

**`S-A-09` My serials lists this device's bookings, not an account's**, and says
so on screen. There are no accounts (`CLAUDE.md` §4.1), so a guest's identity is
one tracking link per booking; `APP_FLOW.md` A1.5 already accepts that
multi-device access for a guest is "only via the SMS link". `lib/bookings.ts`
holds the records in `localStorage`, tokens included — the token is already in an
SMS on the same phone, is scoped to one booking, and expires. When Supabase Auth
lands, that file becomes a call to `GET /me/bookings`.

**Three tabs lead to screens that are not built** — profile (`S-A-19`), ambulance
and blood (step 17). Records was one until step 13, beds until step 14 and
emergency until step 15. Each says what will be there and why it is not, rather than being
hidden, greyed out, or a dead link. Hiding them would move the bar as the
product grows and teach the wrong muscle memory.

**The emergency screen is `S-A-10` since step 15** (see step 15 above). The
999 call is still its first control, as it was when that was all the screen
could honestly offer.

**A failed list no longer borrows the empty list's words.** The two discovery
lists used to render "no hospital offers this department" when the request had
simply failed. That is a statement about the world standing in for a statement
about us, which `PRD.md` §3.2 forbids; there is now a distinct `failed` state
with a retry (`Loadable<T>` in `frontend/patient/src/lib/types.ts`).

### How to open the live serial screen

There is no way to reach `S-A-08` except through a booking, and that is
correct: the route in is the SMS tracking link (`FR-GST-05`), which is what
`PRD.md` §24 step 1 demonstrates. Book on any session at
`http://localhost:3000/book?specialty=CARD`, then tap **লাইভ সিরিয়াল দেখুন** on
the success screen. The URL it opens is `/s?b=<bookingId>&t=<token>`.

No `guest_links` row is seeded, deliberately: the token is only ever returned
once, so seeding one would mean printing a live credential into the seed
output, which CLAUDE.md §7 forbids.

**`ui` is a fourth vitest project**, on jsdom. It is separate from `unit` so a
developer working on the queue reducer never pays for a DOM, and separate from
`api` so it never needs a database. It asserts behaviour and accessibility —
roles, labels, focus order, keyboard handling, an axe pass per component — not
appearance: Tailwind classes are inert strings under jsdom, so the visual layer
is proven from the token values instead, by `tokens.test.ts` and
`contrast.test.ts`.

**Socket.IO is wired** (`socket.io` 4.8.3, added with the owner's permission).
`realtime/server.ts` is the only file that imports it; everything else
publishes through the one-method interface in `realtime/emit.ts`, which still
records instead of sending until `attachRealtime` runs — so the queue tests
need no port. The handshake reuses the HTTP `verifyToken`/`toPrincipal`, the
resume-from-seq path is implemented (`SY-01`), and `realtime.test.ts` binds a
real port and proves a subscribed client is told within the `NFR-01` budget.

**Supabase holds the seeded demo data** as of the end of step 5: 6 hospitals,
40 doctors, 200 patients, 1,181 bookings, 1,221 queue events, and one
cardiology session sitting mid-queue. It is visible in the table editor, which
is the first output of this build anyone can look at.

---

## Environments

Three, with different jobs. Getting these confused is the main way to lose an
afternoon.

| | Used for | `DATABASE_URL` |
| --- | --- | --- |
| Local container | **running the test suite** | `localhost:5432/healthcare_dev` |
| Supabase | **development and the demo** | session pooler, `…pooler.supabase.com:5432/postgres` |
| Render | later, from step 6 | set in Render's dashboard |

- **`pnpm dev:api` needs no Docker.** It reads `.env`, which points at Supabase.
- **`pnpm test` does need Docker** (`docker compose up -d`). The suite drops and
  recreates schemas, so it must never touch a shared database; `DATABASE_URL_TEST`
  stays on localhost and the guard in `database/scripts/lib/env.ts` refuses otherwise.
- Supabase project region is `ap-southeast-1` (Singapore), closest to Dhaka.
- **The container carries three databases**, and the two test ones are separate
  on purpose: `healthcare_dev`, `healthcare_test` (schema suite) and
  `healthcare_api_test` (API suite). Both test databases are seeded from
  `database/seeds` by their global setup, so every test runs against real demo
  data (CLAUDE.md §6) — but the API suite *mutates* it, appending to a log that
  cannot be cleaned up, while the schema suite asserts on exact counts of the
  seeded set. Sharing one made each suite's result depend on which vitest
  started first. If your container predates this, recreate it:
  `docker compose down -v && docker compose up -d`.

### Things learned the hard way, so they are not relearned

- **The canary is not to be the first thing run after switching commits**
  (H1b, 7 October). To find out whether a line the dev servers print on
  stopping came with H1, the working tree was checked out at the commit
  before H1 and the canary run twice, then checked out back and run twice
  more. The first run back failed: the patient's phone took 2,292 ms where
  `NFR-01` allows 2,000. Every test of that run took four times its usual
  time (56 seconds for the first, against 12 to 14 after other specs): a
  checkout touches hundreds of files, and the dev servers were compiling them
  while the measurement was taken. The second run passed, the three after it
  passed (15 of 15 tests), and it had passed in each of the day's three gate
  runs. **What the code says:** the broadcast a patient's screen waits for
  goes out the moment the queue's transaction commits (`queue.service`
  `committed`), before any message is handed to the sender, so H1 put
  nothing in the measured path; it removed the wait for a gateway from the
  answer to the console. **What holds:** a gate is run on a tree that has
  been still long enough for the dev servers to have compiled it, which
  every gate so far was, and not straight after a checkout. **Not
  established:** that two seconds has room to spare on this machine under a
  cold compile. It does not, and a pilot server does not compile.
- **A dev server reported exit code 1 while being stopped, twice** (H1 and
  H1b, 7 October): one line, `[WebServer] ... Command failed with exit code
  1`, after the last test of a run had passed. In two of the runs since H1
  that held more than one spec, and in none of nine single-spec runs, four
  of them on the commit before H1. No test failed by it. The API's shutdown
  exits with 1 when its grace period runs out or the database does not close
  cleanly (`server.ts`), and since H1 a send or a timer's query can be in
  flight when the stop comes, which is the first place to read. Not done
  here: it is the stop of a development server, and what it would change is
  how a real server stops, which is plan I1 and I2's ground.

- **A second job on this machine during a browser run fails the long tests,
  and the failures look like the product's** (F2c's gate, 6 October). The
  whole suite was already running when a new session, not knowing, started
  `pnpm verify` beside it: nine type-checks at once, then the linter.
  `patient-account-serials.spec.ts`, which walks three phones and takes
  about forty seconds alone, ran out of its four minutes. Later, at the
  moment `referral.spec.ts`'s handover test was running, `playwright test
  --list` was run to count the suite, which compiles all forty-four specs:
  the ER's "arrived" tap had not reached the database ten seconds on. Alone,
  three times each, both pass (21 of 21). **What holds: while a browser
  suite runs, nothing else heavy runs here**: no second verify, no
  type-check, no listing of the suite; build the next branch by writing
  it, and check it afterwards. **And a session that finds a gate's result
  missing looks for the run before starting another**: the log was in the
  last session's scratchpad, and the processes were in the task list.
  **Not established:** that load is all there is to the referral failure.
  The ER console sends its taps through an outbox and draws "accepted"
  before the server has said so; nothing read there explains a ten-second
  wait, and it did not happen again in three runs. If it does on a quiet
  machine, that is the place to look.

- **A spec's "server out of reach" goes away with the page it was set on, and
  a closing tab's push then gets out** (`fix/console-ack-rollback`,
  5 October). `offline-console.spec.ts` blocks `/sync/events` with a
  Playwright route and closes the tab to stand for a power cut. Twice in one
  evening, on a machine slowed by hours of runs, the closed tab's events were
  in the log seconds later: once in "the next person at the same PC" (a full
  gate run, 153 of 154), once in "survives the tab being closed" (one run in
  three). Both times the events carried the right person's name, so the
  outbox's isolation held and the product had done nothing wrong: a tab that
  dies mid-push may land it, and the same keys sent again are the same events
  (`SY-02`). `fix/e2e-outbox-close-race` had narrowed this by waiting for a
  refusal before closing; the console retries by itself, so that only moves
  the window, and waiting for a second, fresh refusal still failed one run in
  three. **What holds: unload the console first** (`leave`: go to an empty
  page while the block still stands, then close). Its requests die with
  their document and its timers are gone before the block is. 16 of 16
  after, on the same slow machine. The specs that reload instead of closing
  keep their page, and so their block, and have not failed. **Not
  established:** exactly how the request got out two seconds after
  `page.close()` returned in the second failure; the fix does not depend on
  knowing.

- **For about the first hour of a Dhaka day the pitch session is dated
  yesterday, and a test that did not know failed every night in that hour**
  (`fix/materialise-test-midnight`, 5 October). `seed_07_demo_live` dates the
  pitch session by when its doctor arrived, which is a little over an hour
  before the reset. Seeded at 00:13 Dhaka it was dated the day before
  (planned start 22:57), so today's chamber for that weekly schedule did not
  exist, and the hourly job wrote it, as it should. `hospitalSettings.routes.
  test.ts` asserted that the job's first run over the whole database writes
  nothing: true for twenty-three hours, false for one. It now lets the first
  run do what it has to and asserts what the test is named for, that a second
  run writes nothing and no chamber exists twice. **The product was right,
  and so were the seeds**: the same happens on the demo after a reset in that
  hour, where the pitch doctor shows last night's chamber still running and
  tonight's scheduled. The same family as `fix/console-past-midnight`; found
  only because a verify run happened to start at 00:10 Dhaka. **A test that
  asserts a count over the whole seeded database is asserting the hour it
  was written in.** What the job is for is now tested directly
  (`fix/tests-past-midnight`): with today's chamber for a schedule deleted,
  the first run writes exactly one and the second writes none.

- **For the first half hour of a Dhaka day the e2e fixture made a chamber
  the product never would** (`fix/tests-past-midnight`, 5 October).
  `createConsoleSession` dated its chamber today and started it "thirty
  minutes ago" (ninety, for an overdue one), which just after midnight is
  yesterday. A chamber's date is always the date of its planned start, and
  the patient app relies on that: it dates a remembered booking by the start,
  so the home strip, which shows today's serial, hid it, and
  `app-shell.spec.ts:172` failed in a full run that began at 00:25 Dhaka.
  The fixture's start is now never before its own date began. That only acts
  in that half hour, so it was tried at its extreme, with "midnight" set to
  "now" for the whole browser suite: 153 of 153.
  **Asked of the owner, not decided:** the same rule means a real chamber
  that runs past midnight loses its strip on the patient's home screen at
  00:00 and is listed as past, while the patient is still waiting.
  `APP_FLOW.md` says the strip "appears only if an active booking exists
  today" and is silent on a chamber still running from yesterday. Read from
  the code, not seen happen.

- **A faster machine is a different test** (`fix/e2e-fast-runner`,
  3 October). The browser suite passed 150 of 150 here in 18.1 minutes and
  144 of 150 on GitHub's runner in 11.6. Nothing differed but the speed.
  `/guest/start` is limited to 30 per address per ten minutes, in a **fixed**
  window that opens at the first call; every patient in the suite books from
  one address; and the runner fitted the 31st booking into the window this
  machine had always been too slow to fill. Five tests in a row were refused
  a booking (the app said so, correctly), and the ones after them passed
  because the window had closed. It reproduces here on demand:
  `pnpm exec playwright test e2e/wallet.spec.ts --repeat-each 6`. **A suite
  that passes because the machine is slow has a limit in it somewhere.**
  When a spec fails only on a fast runner, count what it sends per address
  before reading the screen. The suite now sets `ADDRESS_RATE_LIMIT_FACTOR`
  (decision 90).
- **A fixture that picks a random name has to survive the name being taken.**
  The same run failed `ward-board.spec.ts:116` on `wards_hospital_name_key`:
  `e2e/support/ward.ts` named its ward with four random characters and
  treated a clash as an error. It now picks another. The same lesson as
  `fix/test-coin-flips`, in a fixture instead of a test.

- **A phone that opened as reception tapped *next* could stay on the
  previous patient** (`fix/broadcast-after-commit`, 3 October). The queue
  emitted `queue.updated` from inside its transaction, before the commit. A
  subscriber joins the room, *then* reads its catch-up state. One that
  joined after the emit and read before the commit had missed the broadcast
  for a write it could not yet see — and showed the old queue, stamped as
  fresh, until the next event. `HANDOVER.md` §12 listed the early broadcast
  as medium, for the rollback case only. It showed as `lab-report.spec.ts`
  leaving the doctor's screen on serial 1, twice in about six runs: the
  pool fix above had made the gap between emit and commit a few queries
  longer. It is the mirror of the race step 22 fixed in `foldUpdate`, and
  probably what that step's "once in three runs" really was.
  `queue.service` now registers its broadcasts and sends them after the
  commit (`committed`); `broadcastAfterCommit.test.ts` reads the log, from
  another connection, at the instant of each broadcast, and fails a write
  on purpose to see that nobody is told. Beds, the ER and the lab already
  broadcast after their transactions.

- **A queue tap could stall for five seconds and fail when the database
  pool was busy** (`fix/queue-pool-starvation`, 3 October). Every write to
  a chamber holds the session's row lock on one connection. While holding
  it, `notification.service` `queueFor` read the chamber, the templates,
  the month's SMS count and the device tokens from the *pool*. If every
  other connection was held — most simply by other counters' taps on the
  same chamber, each waiting for that lock — the holder waited for a
  connection only it could free: `connectionTimeoutMillis` (5 s), then a
  500, with the queue already broadcast as though it had moved (the
  broadcast-before-commit in `HANDOVER.md` §12 item 12, still open). It
  showed once, as `queueConflict.test.ts` failing after 5.3 s in a full
  run — five taps at once on the test pool of five — and passed alone
  eight times running, because it needs all the waiters to be queued
  before the holder reaches that step. `poolStarvation.test.ts` does not
  depend on timing: it takes every connection but one and runs each queue
  write, and before the fix next, delay and the sync batch each took 5.1–
  5.3 s and failed, and a booking took 5 s and lost its confirmation
  message. The reads now go through the transaction (the bed-request,
  emergency and lab-report messages had the same pattern and the same
  fix). On a real server the pool is 20, so it needs more traffic to
  reach — but it is the queue's hot path, and a full pool is exactly when
  a counter is busiest. **Not audited:** whether any other transaction in
  the API asks the pool for a second connection (beds, ER, lab, imports).

- **The browser suite does not fit beside a working desktop on this machine,
  and the process that grows is Playwright's worker** (3 October, on `mvp` at
  `10bbcd1`; no code changed). Two full runs each failed once, late, in a
  different place, and every failure passed alone on fresh servers:
  - run 1, 142/144 in 38.1 min: the canary's first case took **2,088 ms**
    against the 2,000 ms budget, and `ward-board.spec.ts:83` hit the 60 s test
    timeout on a page reload. Free memory 0.37–0.86 GB of 7.7 GB;
  - run 2, 143/144 in 40.3 min: `language-switch.spec.ts:114` hit the 60 s
    timeout loading the console. Free memory down to 0.12 GB; commit 20.3 of
    24.3 GB;
  - alone: canary 5/5, ward-board 8/8, language-switch 6/6.

  Not a regression: the same tap-to-phone path measured on `ebfcf14` (before
  the handover fixes) gave 397–1,132 ms warm, and on `10bbcd1` 244–756 ms
  warm; the only taps over 1.2 s (up to 2,263 ms) came with cold servers and
  under 0.4 GB free. Most of a tap's measured time is the click itself, in a
  console page running in development mode.

  With Chrome, WhatsApp, Teams and Copilot closed (VS Code and Docker left
  running) the third run was **144/144 in 19.2 min**. Private memory through
  it:

  | at | console `next dev` | patient `next dev` | API | Playwright worker | free |
  |---|---|---|---|---|---|
  | start | 995 MB | 1,543 MB | 92 MB | 143 MB | 0.31 GB |
  | 48/144 | 1,042 MB | 1,130 MB | 111 MB | 1,062 MB | 0.72 GB |
  | 96/144 | 1,030 MB | 1,261 MB | 107 MB | 1,889 MB | 0.90 GB |
  | 142/144 | 1,059 MB | 1,860 MB | 112 MB | 2,656 MB | 0.71 GB |

  The two development servers and the API do not accumulate (the patient
  server spikes to about 2.3 GB while compiling and comes back). **The
  Playwright worker grows about 18 MB a test and is never restarted in a run
  with no failure.** It is the trace recorder: `wallet` + `ward-board` took
  the worker from 277 to 627 MB with `trace: 'retain-on-failure'` and left it
  flat at 136–274 MB with `--trace off`. (Repeating the canary twenty times
  with tracing on did not grow it, so it is what some specs record, not a
  fixed cost per test.) By the last specs the suite's own processes hold
  about 6 GB on a 7.7 GB machine. Nothing was changed to get the clean run:
  no timeout, no assertion, no test.

  **Until the suite is made lighter, run the full suite with the browser and
  chat apps closed.** What would make it lighter is the owner's choice and is
  not made: recording less in a trace, or running the two apps as production
  builds (plan 1.8 already has a production-configuration job), which also
  takes about 2 GB off.
- **What a doctor typed as the queue arrived was wiped, twice over**
  (fixed in `feat/console-offline-load`, 3 October). Two places in
  `DoctorConsole` reset themselves when the patient in the chamber changes,
  and both counted "nobody yet → the first patient" as a change. The consent
  form was drawn before the queue had loaded, keyed "nobody", and remounted
  when the first state arrived: a code typed in that moment was gone
  (`wallet.spec.ts:251`). The visit note was cleared by an effect, which
  runs after the fields are already enabled and on screen: a diagnosis typed
  in between was gone and the sign button was back to disabled
  (`doctor-console.spec.ts:97`, one run in five when repeated). Neither is
  new, and neither is only a test matter — a doctor who types the moment the
  next patient appears hits the same gap. Whether plan 1.6 made them easier
  to hit was not measured; it does move the moment the first state arrives,
  since the console now reads its kept queue from the device before it asks
  the server. The consent form is not drawn until the queue has said who is
  in the chamber; the note is cleared in the render that brings the new
  patient, not after it. **A reset that belongs to "the patient changed" is
  done in the render that changes the patient, never in an effect after
  it.** Checked by running both specs eight times over: every
  doctor-console test passed all eight (56 of 56). The wallet tests passed
  five times and then failed for a reason that is the product working: a
  guest booking starts with a phone check, `POST /guest/start` allows 30 per
  address per ten minutes (`patientAuth.routes.ts`), each repeat books six
  guests, and the thirty-first was refused with a 429. **Repeating
  `wallet.spec.ts` more than five times in one run measures the limit, not
  the wallet.**
- **A test that changed nothing one run in sixteen**
  (`fix/test-coin-flips`, 3 October). `totp.test.ts` proved a sealed
  two-step secret refuses to open once altered by changing the last
  character of its body from `A` to `B`. The body is 32 bytes, 43 base64
  characters, and the last carries four bits of the secret and two that
  decode to nothing; `A` and `B` differ only in those two. So for the 6% of
  seals that end in `A` (measured: 961 of 16,000) the "altered" value was
  the same bytes, opened correctly, and failed the gate — once, while plan
  1.7 was being verified. **The seal was never wrong** (AES-256-GCM, and an
  altered IV, tag or body is refused); the test was. It now changes the
  first character of each of the three parts, over 64 fresh seals. **A test
  whose input is random has to be true for every value, or it is a
  failure waiting for its turn.**
- **Two tests asked the database for rows "since now" by the wrong clock**
  (`fix/test-coin-flips`, 3 October). `standby.routes.test.ts` and
  `admin.routes.test.ts` took `new Date()` on this machine, made a request,
  and then looked for rows with `created_at >=` that moment. `created_at` is
  PostgreSQL's `now()`, and the database runs in a container in a virtual
  machine: a second clock. Measured the same afternoon, it ran between
  4.1 ms ahead of this machine and 1.4 ms behind — behind in 744 of 1,345
  samples once all eight cores were busy — and a request reaches its first
  statement in about as long. So the row was found when the database's
  clock leant ahead and missed when it leant behind; the standby test
  failed the gate once reporting "no SMS written" while the same run's
  output shows the SMS, and its row is in the table. The moment of the
  failure itself was not caught; the mechanism and its size were. Both
  tests now take the moment from the database (`support/databaseClock.ts`).
  **The product was right both times. Never compare a time from this
  machine with a time the database stamped.**
- **A second device a spec opens lives until the whole run ends**
  (`fix/e2e-context-leaks`, 2026-09-30). `browser.newContext()` belongs to the
  worker's browser, not the test, and there is one worker. No-show, referral,
  emergency, check-in and language-switch never closed theirs, so their pages
  kept polling: by the last twenty specs of a full run the console took
  seventeen seconds to open, the API went six seconds without answering, and
  whichever spec came next failed — the canary's "tap after tap" in one run,
  standby and the wallet in the next, each passing alone. Every multi-device
  spec now closes what it opened after each test (`e2e/support/contexts.ts`);
  the canary's file is unchanged, since it already closes its own. A late
  spec failing only in a full run is load before it is logic.

- **A development build mounts every screen twice** (React strict mode), so an
  effect that asks the server to *create* something runs twice. `S-B-00d`'s
  setup did, and two secrets raced: the screen showed one, the database kept
  the other, and the right code was refused. The server now answers a repeated
  setup with the same unconfirmed secret. Anything a screen creates on mount
  must be idempotent on the server, not guarded on the client.

- **The E2E database is the one database no suite migrates.** The unit, API
  and schema suites build theirs from nothing, so a step's migration is always
  there for them. `healthcare_dev`, which Playwright drives, was only ever
  reseeded, so `0020_admin_views.sql` was missing there while every other suite
  was green, and every dashboard spec failed on a 500. `globalSetup` now runs
  `db:migrate` before `db:reset`.

- **A green `db:migrate` on a database that is already ahead proves nothing.**
  `0009_money.sql` references `ambulance_requests`, which `0011` creates — and
  on a fresh database the runner applies files in filename order, so 0009 runs
  first and fails. The local development database already had 0011, so it
  applied cleanly there and only the test suite's build-from-scratch caught
  it. **Numbering a migration backwards into the sequence needs a fresh
  build to verify**, not an incremental one.

- **A seed that reads what another seed wrote has to run after it, and the
  file name does not tell you the order.** Payments written inside
  `seed_04_history` covered 367 bookings out of 919: seed_04 runs before
  `seed_05_beds` and `seed_07_demo_live`, so the pitch session's own bookings
  had none. `seed_08_money` runs last.

- **A repository read inside a transaction must use the transaction.** A
  `findDetail` on the pool while its caller held a transaction took a second
  connection; five concurrent requests then exhausted a five-connection pool
  and deadlocked. It was invisible until a test fired five identical requests
  at once. Anywhere a service calls a repository between `withTransaction`'s
  braces, the `trx` has to be passed.

- **`express.json()` consumes the stream before any route sees it.** A route
  that mounts its own `text()` parser to read raw bytes finds nothing, and a
  signature check over an empty string fails every genuine callback *and*
  every forged one — so nothing looks wrong. The raw body is captured by the
  JSON parser's own `verify` hook (`config/rawBody.ts`).

- **A CORS allow-list is a bug only a browser can see.** `PUT` was missing
  from `ALLOWED_METHODS`, so `PUT /hospitals/:id/pharmacy-stock` and
  `PUT /hospitals/:id/capabilities` could not be sent from any page — the
  preflight answers 204, the browser refuses on its own, and nothing
  server-side logs anything because the request never arrives. Every unit and
  API test passed, because supertest is not a browser. `app.test.ts` now reads
  the verbs off the mounted router stack and asserts each is allowed.
  **`ALLOWED_HEADERS` has the same shape** and no such test yet: a route that
  starts requiring a new request header will fail the same silent way.

- **`pnpm typecheck | grep error` reports nothing useful.** pnpm's recursive
  runner drops the compiler's output when the stream is piped, so a grep comes
  back empty on a failing run. **Check the exit code**, or run `npx tsc
  --noEmit` in the package. Four real console errors were missed this way in
  step 17, including a `FRONTEND.md` §5.1 violation.

- **A disabled button has to carry its reason** (`FRONTEND.md` §5.1), and
  `ButtonProps` enforces it as a discriminated union — which means
  `disabled={busy || offline}` does not compile, exactly when a screen most
  wants a boolean. `ActionButton` in the console takes `reason: string | null`
  instead: a string turns the button off and becomes its accessible
  description, null leaves it live.

- **`format()` takes `(key, locale, values)`**, not a pre-resolved string.
  `format(t('key', locale), {…})` typechecks as far as the argument count and
  then fails on it; it is an easy shape to get wrong because `t()` alone reads
  naturally in the same position.

- **Use Supabase's session pooler (port 5432), not the transaction pooler
  (6543)**, even though the dashboard labels the latter `DATABASE_URL`.
  Transaction pooling does not carry a session-level `search_path`, and the
  extensions live in their own schema.
- **Percent-encode the database password.** Supabase generates passwords
  containing `%` and `&`; `%Pz` reads as a percent-escape, not three characters.
- **Extensions live in an `extensions` schema, not `public`** (migration 0001),
  matching Supabase's convention so both environments have one layout. Every
  connection must therefore carry `-c search_path=public,extensions`; there is
  one definition, `PG_CONNECTION_OPTIONS`, used by every connection factory.
- **A remote database needs `ALLOW_REMOTE_DB=1`**, and a destructive operation
  on one additionally needs `ALLOW_DESTRUCTIVE_DB=1`. The guard decides on the
  host, never the database name — every Supabase database is called `postgres`.
- **Vitest loads `.env` into `process.env`.** The API test setup therefore
  assigns its environment outright rather than defaulting it, or the suite runs
  against whatever `.env` happens to say.
- **A migration written in a step is not a migration the demo has.** Nothing
  applies migrations to Supabase but a person running `db:migrate` against it,
  and the guard means that person has to mean it. 0008 and 0012 were written
  in step 14 and were still unapplied when step 16 finished — so for two whole
  steps the deployed console could not have shown a ward board, and every
  local suite stayed green because they all run against the container. At the
  end of a step, either migrate the remote or write down that it is behind.
- **`pnpm test` is not the whole gate; `pnpm verify` is.** `format:check` sits
  in `verify` and in CI, not in `test`, so a step that runs the Definition of
  Done's three commands (`CLAUDE.md` §5.2) never sees it. It had been red for
  several steps before `chore/format-clean`, on files belonging to no step in
  particular — which is exactly how it stayed red. Run `pnpm verify` before
  calling a branch done.
- **`.prettierignore` said `db/migrations/`, a directory this repository has
  never had.** The migrations live in `database/`. Nothing broke, because
  Prettier ships no SQL parser and skipped them anyway — an ignore rule that
  matches nothing is silent in both directions, so it went four months without
  being noticed. Corrected on `chore/format-clean`.
- **`next-env.d.ts` is generated, and each command writes it differently.**
  `next dev` points it at `.next/dev/types`, `next build` at `.next/types`, so
  while it was tracked it appeared as a modification in `git status` after
  every dev run and every build, belonging to nobody and blocking
  `format:check`. It is now in `.gitignore` and `.prettierignore`. Both apps
  typecheck on a clean clone without it (tested with `.next` removed as well,
  which is what CI sees — CI typechecks before anything builds).
- **The api project's files cannot run in parallel, and the failure looks like
  a bug in the newest step.** They share one database and go through the API,
  so nothing can be rolled back around them; two files asserting on the same
  hospital's counts interfere, and the one that is newer gets the blame. It is
  `maxWorkers: 1` on that project in `vitest.config.ts` — not
  `fileParallelism: false`, which vitest applies to the whole run. Any new api
  test that reads a per-hospital total is safe because of that line; a test
  that needs its own hospital is still the better shape.
- **So does anything that imports the API, and that caught Playwright too.**
  `backend/api/src/env.ts` merges `.env` into `process.env` as an *import side
  effect*. `e2e/support/console.ts` imports `signToken` from the API, and ESM
  evaluates imports before the importing module's body — so its
  `process.env['DATABASE_URL'] ?? localhost` line read a `DATABASE_URL` that
  `.env` had already set to **Supabase**, while `globalSetup` and the app
  servers stayed on the local container. The suite ran split across two
  databases and every spec failed looking for a row that was seeded in the
  other one. The E2E suite therefore no longer reads the ambient
  `DATABASE_URL` at all: `e2e/support/database.ts` resolves `E2E_DATABASE_URL`
  (defaulting to the container) and `assertLocalDatabase()` refuses a non-local
  host unless `E2E_ALLOW_REMOTE_DATABASE=true`. `playwright.config.ts`,
  `globalSetup` and the fixtures all import that one value, so they cannot
  disagree again.
- **`shared/ui` was never in the Tailwind build, and the symptom was not an
  unstyled app.** Tailwind v4 detects sources from the directory of the
  stylesheet that imported it and skips `node_modules`; an app resolves
  `@platform/ui/styles.css` through the workspace symlink, so detection fell
  back to the app's own `src`. Every class used *only* inside a design-system
  component was dropped. Because apps happen to use many of the same classes,
  the result was a **half-applied** stylesheet rather than a missing one —
  `bg-surface` worked, `inset-x-0 bottom-0` did not, and the bottom sheet
  rendered shrink-wrapped at its static position off the bottom of the
  viewport. Fixed with `@source "./**/*.{ts,tsx}"` in `styles.css`. Any new
  package that ships classes needs the same line.
- **A Tailwind class that does not exist fails silently.** `min-h-touch` was
  written in ten places across `shared/ui` and both apps and was never a
  utility, so the 44 px minimum `FR-LOC-04` and `A11Y-07` require was simply
  absent — buttons were 27 px tall. It is now an `@utility` in `styles.css`.
  So were `duration-instant`, `duration-quick` and `duration-sheet`, which is
  how `prefers-reduced-motion` was meant to zero every transition at once.
  There is no build error for this; only looking at the rendered page finds it.
- **`Intl.DateTimeFormat('bn-BD', { hour, minute })` produces `২:৫৫ PM`.**
  Bengali digits with a Latin day period stuck on the end — exactly the
  half-translated output `FRONTEND.md` §0.2 bans, and a direct violation of
  `I18N-05`. Every clock time now goes through `formatClock` in
  `@platform/i18n`, which picks the Bangla period word (সকাল / দুপুর / বিকাল /
  সন্ধ্যা / রাত) and the numerals together. Nothing formats a time in a
  component.
- **Slicing an ISO string for a clock time shows UTC.** The console rendered
  `plannedStart.slice(11, 16)`, so a chamber running 18:00–21:00 in Dhaka read
  as 12:00–15:00 on the line that says when the session is. Timestamps are UTC
  in the database (`DB-P4`) and are only ever wall-clock after a timezone
  conversion.
- **A date is Dhaka's or it is wrong, and the gap is six hours wide.**
  Postgres `current_date` and `now() AT TIME ZONE 'Asia/Dhaka'` name different
  days between 00:00 and 06:00 in Dhaka, and two separate bugs lived in that
  window — found only because a session happened to run at 01:05 Dhaka.
  - `GET /demo/consoles` filtered sessions on today's Dhaka date, so a chamber
    that opened at 23:50 and was still running at 01:07 offered no console. It
    hit the demo hardest: `FR-DEM-06` builds the pitch session by walking a
    mid-queue log backwards from the present, so a reset in the small hours
    files it under yesterday and the picker then listed nothing running. The
    query now also accepts a session that is *running*, whatever date it
    carries.
  - Three fixtures — `e2e/support/console.ts`, `queueFixture.ts` and
    `seeds/graph.ts` — inserted `session_date = current_date` (UTC) alongside a
    `planned_start` of `now() - 30 minutes`. Every read that filters by day uses
    `toDhakaDate`, so in that window the fixture wrote yesterday and the picker
    asked for today. **The whole E2E suite failed, the canary included**, with
    nothing wrong in the product: 7 passed of 28, every failure a sixty-second
    timeout waiting for a session card the API had correctly excluded. A
    timeout that names the browser and not the date is the worst symptom this
    class of bug has.

  If a session is not appearing and the hour is early in Dhaka, check the date
  before anything else.

  A third lived in the referral seed: its timelines run over hours, so a reset
  at 01:35 Dhaka put "this morning's" arrival yesterday and the ER console's
  *today* list opened without it (`referral.spec.ts`). `seed_05` now compresses
  the declared timelines into the part of today that has happened, in order.

- **`next dev` compiles a route on its first visit, and that is not the
  product's latency.** Five or six seconds per page on this machine. A spec
  whose first visit to a route happens inside an expectation spends its
  ten-second budget on webpack: `ward-board.spec.ts` failed twice in step 15
  waiting 10.8 s for `/beds/request`, 6 s of it the document compiling, with
  the page one frame from rendering. `e2e/support/globalSetup.ts` now visits
  every route once before any spec runs (Playwright starts `webServer` before
  `globalSetup`, confirmed in its 1.63 source). **A new page belongs in its
  `ROUTES` list.**

- **A shared test database means exact-count assertions must be scoped.**
  `seeds.test.ts` asserted `SELECT * FROM hospitals` had six rows; the graph
  fixture in `seeds/graph.ts` inserts a seventh, so the test passed or failed
  depending on which file vitest ran first. It now matches on the declared
  names from `DEMO_FACILITIES`. Any new assertion about "how many" needs the
  same scoping.

### Credentials

`.env` is gitignored and has never been tracked in any commit. It holds the
Supabase connection string and three generated dev secrets.

`SUPABASE_SERVICE_ROLE_KEY` is deliberately **not** set, and step 17 did not
change that. The lab's report upload runs on `STORAGE_PROVIDER=mock`, which is
the correct implementation for this version (`CLAUDE.md` §1.1) — the same
standing `SMS_PROVIDER=log` and `PAYMENT_PROVIDER=mock` have. It keeps the
bytes in the API process and serves them through a signed URL of this API's
own, so the whole of `FR-LAB-03` is real end to end; only the disk is not.

`STORAGE_PROVIDER=supabase` is refused without the key, and `mock` is refused
in production, so neither can be reached by accident. Switching is a bucket,
three variables and no code.

---

### Settled: the E2E rows that had been written to Supabase

Because of the `.env` import-side-effect bug above, every `pnpm test:e2e` run
before it was found created its fixture rows **on Supabase** rather than on the
container: one session per test (`room = 'E2E'`), its bookings, and the queue
events the specs appended. It was demo data throughout — no real patient data
was ever involved (`FR-SEC-08`) — but `queue_events` is append-only, so those
rows could not be deleted one by one.

**Measured, 2026-09-19:** 32 sessions (`room = 'E2E'`), 146 bookings and 64
queue events, all created between 05:17 and 05:29 UTC — the three diagnostic
runs during which the bug was found, and nothing older.

**Cleared, 2026-09-22.** The owner authorised the migrate and reseed described
in the step 16 notes, and `pnpm db:reset` is the supported path (`FR-DEM-06`):
it truncated the demo database and rebuilt it, so the stray rows went with
everything else. The scoped alternative — deleting only the E2E rows, which
needs `trg_queue_events_no_mutate` lifted inside the transaction — was never
run and is not needed.

```bash
# What was run, and what any future remote reset looks like.
ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1 pnpm db:reset
```

The bug itself is fixed and cannot recur: the suite refuses any non-local
database.

---

## Open decisions

Each is implemented one way and flagged rather than settled silently, and
needs an owner's ruling. Number 7 is recorded as settled because the answer
changed the tree; 8, 9, 12 and 59 are settled too — closed, and not to be
raised. 12 and 59 are the refund policy and its demo percentages, ruled on
2026-09-23: the demo refund is the deliverable and payment specifics are not
to be put in front of the owner again. They are grouped by the step that
raised them, so the numbering is not contiguous in the file.

1. **`FR-QUE-20` grace period.** "2 patients or 15 minutes, whichever is longer"
   is implemented as the longer of *two patients' time at the current rate* and
   fifteen minutes. Read instead as a count of calls it deadlocks: the absent
   patient is at the front, so nobody else can be called, so the count never
   rises. See `graceWindowMinutes` in `shared/domain/src/queue/rules.ts`.
2. **`EVT-BOOKING_CREATED`** appears in `APP_FLOW.md` §A4 but not in
   `DATABASE.md` §1 or `FR-QUE-03`. The queue is built as
   `seed + events => state` instead; see the header of
   `shared/domain/src/queue/state.ts`.
3. **RLS is enabled in the migration that creates each table**, not deferred to
   `0014_rls.sql`. An enabled table with no policy denies all access, so this
   fails safe in the meantime; 0014 still adds the policies.
4. **`hospitals.settings_id` is not created.** `hospital_settings.hospital_id`
   is already the primary and foreign key, so the reverse link `DATABASE.md`
   §2.2 lists would be a second source of truth for one relationship.

Raised while building the seeds (step 5):

5. **A national role has no home facility — implemented at step 20, awaiting
   a ruling.** `FR-ROLE-01` says every role is hospital-scoped *except* the
   platform and government ones, and `staff_users.hospital_id` and
   `staff_roles.hospital_id` were both NOT NULL. The two options were: make
   those columns nullable, or keep national roles somewhere else. **Built as
   the first** (migration 0024). A null hospital is allowed only for
   `platform_admin` and `gov_viewer`, enforced by a CHECK on `staff_roles`.
   The API reads a hospital-less token as a separate `national` principal,
   which every hospital guard refuses. Kept in `staff_roles` because
   `FR-ROLE-02` makes holding several roles normal and `staff_role` already
   lists both. What the table cannot check (a CHECK sees one row) is that a
   null-hospital *account* holds only national roles; `toPrincipal` holds that
   line. If the ruling is "somewhere else", 0024 is superseded by a migration
   that moves one seeded row, and the `national` principal stays.
6. **`db:reset` truncates; migration 0006's comment says it drops the schema.**
   The comment predates Supabase, where dropping `public` would take Supabase's
   own objects with it. `DATABASE.md` §7 ("truncate + reseed in one command")
   is the authority and is what `reset.ts` does. The comment cannot be edited —
   a shipped migration never is, and the checksum would stop `db:migrate`. A
   later migration could carry a corrected `COMMENT ON`.
7. ~~**Repo layout.**~~ **Settled and done** (`chore/repo-layout`). The tree is
   now `frontend/` + `backend/` + `shared/` + `database/`, divided by where the
   code runs. `shared/` exists because `shared/domain` is imported unchanged by
   both the API and the console, and that import is the mechanism behind
   `FR-QUE-05` — it belongs to neither side. `BACKEND.md` §1 was updated in the
   same branch, and the layering rules now also forbid `frontend/` importing
   `backend/` or `database/`.

10. **Which typeface.** The design canvas (`FRONTEND.md` §0.4) pairs Hind
   Siliguri for body with Noto Serif Bengali for display. `FRONTEND.md` §2.1
   mandates one superfamily, Anek Bangla, self-hosted, with Hind Siliguri only
   as a fallback. The document stands until ruled otherwise, so step 7 builds
   tokens on Anek Bangla — but the canvas's serif display carries the hero
   numeral well, and switching later is a token change, not a rewrite.
   **Until `fix/pitch-design` neither face was actually loaded**, so the
   question was moot in practice: now Anek Bangla is, per the document. Headings
   set in `font-reading` get Tiro Bangla, a serif, which is close to the
   canvas's display voice. Swapping display to Noto Serif Bengali is one line
   in each app's `fonts.ts` and the token.

11. **`--warn-700` is AA, not the AAA `FRONTEND.md` §1.3 claimed.** The table
   said 7.9:1; the §1.1 hex `#6B4A10` actually yields 6.97:1, missing AAA by
   three hundredths. §1.3 has been corrected to the computed values (three of
   its five ratios were wrong). Notably `#63420D` produces *exactly* 7.9:1,
   which suggests that was the intended token and the hex in §1.1 is simply
   lighter than meant — but changing a brand colour is the owner's call, so the
   documented hex stands and `contrast.test.ts` asserts the AA result plus a
   deliberate "does not yet clear AAA" case that will fail the moment anyone
   darkens it. Caution text is legible either way.

Raised while building the live serial screen (step 10):

12. ~~**`hospital_settings.refund_policy` has no defined shape.**~~
   **Settled at step 18.** The shape is `shared/domain/src/payments/refund.ts`
   and `DATABASE.md` §2.2 documents it: `cutoffHours`, a percentage before and
   after it, and whether the platform fee comes back. Four demo facilities
   have terms and two deliberately do not, so the "hospital will decide" path
   stays demonstrable. Closed — see decision 59.

13. ~~**Nothing reissues a freed serial.**~~ **Closed at step 19** by
   `offerFreedSlot`: a cancelled serial still ahead of the chamber is reissued
   to the standby patient who takes it, and otherwise the next serial is
   issued. The original note follows. Cancelling releases the number —
   `bookings_session_serial_key` excludes cancelled rows — but `nextSerial`
   still allocates `max + 1`, so the gap is never filled. `FR-QUE-30` gives the
   slot to a standby patient through `offerFreedSlot`, which is not built;
   until it is, a cancelled serial is simply skipped. That is the safe
   behaviour for now — nobody should silently inherit somebody else's number.
   This said "needs deciding at step 15"; step 15 is the emergency console and
   has nothing to do with slot offers. It belongs with `offerFreedSlot` and the
   no-show recovery flow (`FR-QUE-30`, `no-show-recovery.spec.ts`), whose
   figure is step 19.

Raised while building notifications (step 11):

14. **What one SMS costs.** `POISHA_PER_SEGMENT` is 35 in `adapters/sms.ts`, a
   placeholder until an aggregator quotes a rate. It is recorded per message so
   `FR-NOT-06`'s delivery reporting has something to sum, and every figure the
   admin dashboard shows at step 19 is built on it.

15. **Quiet hours are 22:00–07:00 Dhaka**, chosen because no document names
   them. Nothing is suppressed by them today — `FR-NOT-07` exempts queue events
   and every message this version sends is one — so the first template outside
   the `queue.*`, `booking.*` and `session.*` namespaces is when the hours
   start mattering.

Raised while building the app shell (`feat/app-shell`):

16. **`S-A-07` is missing its filters and its search.** The document gives it
   `CHIP-A07-NEAR`/`-WAIT`/`-FEE`/`-OPEN` and `INP-A07-SEARCH` (`FR-PAT-15`),
   and the hospital card is specified to carry distance, travel time, live wait,
   free beds and ICU as well. What is built is the list, the doctor count, who
   is sitting now, serials open today, and freshness. Distance already works
   when a position is passed (`?lat=&lng=`) but nothing asks for one, because
   `S-A-01` location permission is not built. Free beds and ICU, each with
   their own age, joined the card at step 14.

17. **`S-A-05h` exists only as its ডাক্তার tab, inside the booking flow.** The
   document gives it four tabs (ডাক্তার / বেড / টেস্ট / জরুরি), a header of
   bed, ICU and ER-wait stats, and `BTN-A05H-DIRECTIONS` and `-CALL`. There is
   no standalone hospital detail route; a hospital card goes straight to the
   doctor list as a step of `/book`. The বেড tab's content is `S-A-11` (step 14);
   টেস্ট is step 17 and জরুরি step 15.
   `S-A-06d` Doctor detail is likewise skipped — a doctor row goes straight to
   the session picker, which the document allows as `BTN-A05H-BOOK-<doctorId>`'s
   "fast path".

18. **The area on Home is the string `ঢাকা`.** `MOD-A02-AREA` is an area picker
   and there is no location flow, so the header states where the demo's
   facilities actually are rather than leaving the line blank. It is true, and
   it is not a picker.

19. **`BTN-A02-SPEC-ALL`** (সব বিভাগ দেখুন → `S-A-07b` full specialty list) is
   not built, because Home renders every seeded specialty and there is nothing
   left to expand to. It matters the moment the specialty list outgrows one
   screen.

20. **`frontend/` has no vitest project**, so `lib/bookings.ts` — the
   device-local booking store, which has real logic in its date bucketing and
   its pruning — has no unit test. Its behaviour is covered end to end by
   `app-shell.spec.ts` instead. Adding a fourth project pattern
   (`frontend/*/src/**/*.test.ts`) is a config decision worth making
   deliberately rather than in passing.

21. **The PWA icons are SVG only.** `manifest.webmanifest` declares `any` and
   `maskable` SVGs. Chrome on Android installs from those; some older Android
   webviews want a raster 192 and 512, and iOS ignores the manifest icons
   entirely in favour of `apple-touch-icon`, which is currently the same SVG.
   Nobody has installed it on a real handset yet — that is the next thing to
   check on a phone, not in a test.

22. **The service worker's cache is versioned by hand** (`SHELL = 'shell-v1'` in
   `public/sw.js`). Nothing bumps it automatically, and `activate` deletes every
   cache that is not the current name. A stale shell after a deploy is fixed by
   bumping that string; forgetting to is how a deploy appears not to land.

Raised while building the doctor console (step 12):

23. **Nothing joins a console account to a `doctors` row, so `FR-DOC-10` is
   enforced at hospital grain.** A doctor signs in as a `staff_users` row
   carrying the `doctor` role; "their own sessions" is `sessions.doctor_id`,
   which references `doctors`. `DATABASE.md` §2.2 gives `doctors.user_id` as
   "the doctor's own login" — a reference to `users`, which the seeds leave null
   because authentication is deferred (`CLAUDE.md` §4.1). So the individual
   identity the requirement names cannot be checked.

   What is enforced instead: a doctor-role account may read a record only if
   that patient has been booked into a chamber **at their hospital**, or if a
   live consent covers it. A consultant at Shapla cannot open the record of
   somebody who has only ever attended Padma. It is weaker in one specific way —
   a cardiologist at Shapla can read the record of a patient who saw the
   orthopaedist there. Closing that needs a `staff_users ↔ doctors` link, which
   is a schema decision and therefore the owner's. `treatedAtHospital` in
   `clinical.repo.ts` carries the same explanation at the call site.

24. **`MOD-A07-INTAKE` was never built.** `APP_FLOW.md` A4 specifies 4–6
   pre-visit questions — duration, main symptom, chronic conditions, current
   medicines, allergies — and step 9 collects only a reason. `FR-DOC-03` puts
   all of them on the doctor's screen, so the seeds now write them and the panel
   reads them, but **a booking made through the app today carries only the
   complaint**. The doctor's screen says "the patient answered nothing
   beforehand" for those, which is true and is the honest state — but the modal
   is a real gap in step 9 and the panel gets materially better the day it
   lands.

25. **`FR-DOC-09` earnings are the chamber fee times patients seen.** The fee is
   not in the queue state and should not be — the state is the event log reduced
   and a fee is not an event — so the console fetches it once per session from
   the roster, where `DB-P5` already copied it onto every booking. It is absent
   rather than zero when the roster is empty. What it does *not* account for is
   whether anybody actually paid; `payments` is step 18, and until then this is
   "billed", not "collected". The label says আদায় (collected), which will need
   revisiting at step 18.

26. **`visits.follow_up_date` is checked against `created_at`, not `now()`.** A
   check constraint cannot call `now()` and stay immutable, so
   `visits_follow_up_not_past` compares the follow-up to the row's own creation
   date in Dhaka. The effect is right for new rows and means a very old draft
   could be signed with a follow-up that is now in the past. Nothing does that
   today.

Raised while building the wallet (step 13):

27. **A guest may offer consent, read the access log and revoke — under
   `DEMO_MODE` only**, for the patient their own booking names
   (`assertSpeaksFor` in `consent.service`). It is the same kind of affordance
   as the console picker (`CLAUDE.md` §4.1) and is gated the same way, but it is
   a real escalation: a tracking link otherwise reaches one booking's record,
   and consent gives a hospital standing access to the whole history. With
   `DEMO_MODE` off a guest is refused all three, which a test pins. Needs the
   owner's yes or no; if no, the consent half of the wallet is unreachable in
   this version.

28. **`FR-PAT-63` says QR, and the build shows a code.** Drawing a QR needs an
   encoder (e.g. `qrcode`) and scanning one needs a camera pipeline
   (`BarcodeDetector` is native on Android Chrome but not on desktop Chrome, so
   a fallback such as `@zxing/browser` would be needed). Both are new
   dependencies (`CLAUDE.md` §7). The capability is identical and only
   `BTN-A12-QR` and `BTN-B05-SCAN` would change. The code is a signed token, hundreds
   of characters long, which is why it cannot be read aloud and why a QR is the
   real fix.

29. **Durations nobody documented.** A code lives three minutes
   (`CONSENT_OFFER_TTL_SECONDS`) and a grant twenty-four hours
   (`CONSENT_TTL_HOURS`). A grant is always hospital-scoped, never
   doctor-scoped, for the same reason as decision 23: nothing joins a console
   account to a `doctors` row.

Raised while building the bed board (step 14):

30. **Bed-request answers ignore quiet hours.** `FR-NOT-07` exempts emergency
   and queue events; nothing says a bed request's answer is either. It is
   exempt anyway (`ALWAYS_OVERRIDES_QUIET_HOURS` gains `bed`): a hold is
   measured in minutes, and a "your bed is held until 11:30 PM" text deferred
   to seven the next morning is a bed lost without being told.

31. **`bed.request_result` became two keys**, `bed.request_held` and
   `bed.request_declined`. One body with the outcome passed in would put copy
   outside the template table. BACKEND.md §8 is updated.

32. **Freshness means "the ward last told us something about this kind of
   bed".** There is no "the board is still right" action, so a ward whose beds
   genuinely have not changed in an hour looks stale. That is honest but may be
   harsh on a quiet ward; a confirm-the-board heartbeat would be a product
   decision (and a new event type).

33. **Inpatients share the two hundred seeded patients** (`FR-DEM-03`). Nearly
   all of them hold a serial today, so some inpatients also sit in today's OPD
   queues — the pitch session's patients included. Tiles show no names, so it is
   only visible in the bed panel. The alternative, a second population of
   inpatients, would contradict the count `FR-DEM-03` states.

34. **A bed request needs no OTP** — `FR-GST-03` is deferred with the rest of
   authentication. The request is rate-limited by nothing but one open request
   per patient per hospital. Worth a rate limit before a real deployment.

35. **The patient's bed search polls every thirty seconds.** There is no public
   realtime room (the board room is staff-only and sockets require a token), so
   "instantly" (`FR-BED-02`) is true of the published figure and of the ward's
   screen, and within thirty seconds of the phone's. An anonymous read-only
   capacity room would close the gap; it would also be the first
   unauthenticated socket, which is a security decision.

36. **"Two taps at most" (`FR-BED-02`) is counted from the open bed panel.**
   Counting the tile tap too, a discharge is three: tile, action, and the
   confirmation `GR-01` requires. The two requirements cannot both hold
   literally.

37. **Closed by `fix/offline-outbox-persist`** (all three outboxes are in
   IndexedDB). Was: **Both consoles' offline outboxes live in memory.** `createDexieStore` exists
   and neither console uses it, so a reload with actions queued loses them. The
   reception console has always been this way; the ward board matches it rather
   than being the only one that differs. Wiring Dexie in is a small change for
   both.

38. ~~**Found, not fixed: three freshness lines drop the word "minutes".**~~
   **Fixed on `fix/pitch-design`**: every freshness line goes through
   `formatAge` (minutes, hours, days). The original note follows. The
   reception console, the doctor console and the booking flow's hospital list
   pass a bare number into `updatedAgo`, so they read "হালনাগাদ ৩ আগে". The live
   serial screen and every step-14 screen append মিনিট. Out of this step's
   scope; a one-line `fix/` branch each.

Raised while building the emergency console (step 15). The first three were
ruled on before building (schema, the critical/urgent split, problem →
capability); these are the ones that were not:

39. **Travel time is an estimate on placeholder constants.** `TRAVEL_TIME_MODE=
   static` is straight-line distance × 1.4, at 12 km/h in Dhaka's peaks (07–10,
   16–21), 18 km/h between, 28 km/h at night (`adapters/traveltime.ts`). None
   is measured; like `POISHA_PER_SEGMENT`, replacing them changes estimates,
   not code. The patient app labels every figure আনুমানিক. From Farmgate at
   16:44 Dhaka, Padma reads "আনুমানিক ৮৮ মিনিট" — plausible for Uttara at rush
   hour, but a number nobody checked.

40. **The search radius is 50 km** (`EMERGENCY_SEARCH_RADIUS_METRES`): Dhaka
   and its ring. No document names one.

41. **"ER wait" is shown as the ER's load, not minutes.** `FR-PAT-44` and
   `CARD-A10` ask for emergency wait; nothing measures one, so the card says
   how many people the ER has now (`FR-EMG-04`'s counter) rather than invent a
   wait.

42. **Only facilities with an ER console are listed.** Buriganga Clinic has an
   emergency phone but no emergency coordinator, so it does not appear — "I'm
   on my way" there would ring nobody while telling the family it had.

43. **Emergency SMS ignore the monthly SMS budget**, as they already ignore
   quiet hours (`FR-NOT-07`): "this hospital cannot take you" is not a message
   to save one SMS on. Found alongside it and not changed:
   `smsSentThisMonth` only counts messages tied to a booking, so step 14's bed
   answers were never counted against the budget either.

44. **"I'm on my way" is rate-limited to ten per address per ten minutes.**
   An anonymous route that rings an ER invites pranks; the number is a guess.
   The same limiter is keyed on `req.path`, which is fine here (no path
   parameter) but see the known gap about it.

45. **An ER admission needs a phone number at the ward desk.** The ward's
   admit form requires one (it finds or creates the guest identity by it), so
   an unconscious patient with nobody's number cannot be admitted through it.
   The ER's own case needs nothing; the stay does. A real gap for a real ER.

46. **`in_treatment` is never used.** Nothing in `APP_FLOW.md` B4 separates
   "being seen" from "here", so an accepted case is `arrived` until it is
   admitted, discharged or referred (step 16 closes a referred case; nothing
   yet moves one to `in_treatment`).

47. **Blood stock (`FR-EMG-06`, `INP-B07-BLOOD`) is not built.** No table in
   DATABASE.md holds a hospital's blood by group. 0011 landed with step 17
   and has `blood_donors` and `blood_requests` — neither of which is an
   inventory — so the ER console's blood input is still waiting on a table
   (or a column set) that the documents do not yet name.

48. **A family's case link lives 24 hours** (`emergency_case` token audience).
   An emergency is over in hours; a token that outlived the night would make a
   stranger's alert readable from an old SMS.

Raised while building referrals (step 16). The four the schema needed — the
nullable capability with a bed kind beside it, `arrived_case_id`, who holds
the person until arrival, and the decline list staying a suggestion — were put
to the owner and ruled on (2026-09-22) before 0017 was written, and are
recorded in the step 16 notes above. These are the ones that were not:

49. **A referral's note is capped at 500 characters and is the only free text
   in it.** `FR-EMG-08` says "patient summary" and names no limit. Long enough
   for "diabetic, on anticoagulants, family says two hours of chest pain",
   short enough that nobody keeps a case file in it — a second hospital's
   coordinator reads this on a busy screen. The seeds write no note at all.

50. **Today's referrals only.** The ER console's right column shows the open
   ones plus today's closed, on the Dhaka day the rest of the console uses.
   Nothing in `APP_FLOW.md` B4 says how far back the list reaches, and an ER
   coordinator's screen is about this shift; a referral from Tuesday belongs in
   a report nobody has asked for yet.

51. **A withdrawal needs no reason, a decline does.** `FR-EMG-09` requires the
   reason on a decline (the sender must know whether to try elsewhere). The
   sender's withdrawal tells the receiver only that it is off, behind a
   `GR-01` confirmation naming the hospital — usually because the family went
   somewhere else, which is not the receiver's business.

52. **`BTN-B07-REFER-CANCEL` is not in `APP_FLOW.md`'s original table.** With
   one open referral per case and no withdrawal, a receiving ER that never
   answers would strand the case forever. The control is added to B4 rather
   than the rule relaxed.

Raised while building the lab (step 17):

53. **`FR-PHR-01` follows prescribing out of this version.** Implemented as
   *not built*, with the screen saying why. The alternative was to seed demo
   prescriptions so a QR had something to scan — which would demonstrate a
   flow no doctor in the demo can start, and the owner dropped `FR-DOC-04`
   deliberately. Flagged in `PRD.md` §12 and `APP_FLOW.md` B5. **Say the word
   if the pitch wants the dispensing screen demonstrable anyway**; it is a
   seed and a screen, not a schema.

54. **What a test costs.** `DEMO_TEST_CATALOGUE` prices twelve common tests in
   poisha (CBC 450 taka, ECHO 2,500, and so on). These are the demo hospital's
   list prices, the same standing `seed_02`'s doctor fees have, and they exist
   so a `test_orders` row carries a number for `FR-ADM-04`. Not commercial
   content (`CLAUDE.md` §1.1) — a real hospital's catalogue arrives with its
   agreement — but somebody should glance at them before a pitch.

55. **Twelve hours is how long a stock flag stands.** No document names a
   threshold and `hospital_settings` has no column for one. A bed's ten
   minutes would paint the whole shelf unknown by mid-morning; twelve hours
   means a morning check stands all day and yesterday's does not. Changing it
   is one constant in `shared/domain/src/lab/stock.ts`.

56. **Turnaround is measured ordered-to-ready, not sample-to-ready.** The
   second is the interval a lab would rather be judged on; the first is what
   the patient waited, and `PRD.md` §3.2 cuts that way. Worth confirming
   before the admin dashboard (step 19) puts the figure in front of a
   hospital director.

Raised while building the money (step 18):

57. **What "doctor absence" is.** `FR-PAY-07` names it and no document
   defines it. Implemented as: the session ended and no `DOCTOR_ARRIVED` was
   ever appended. A session the doctor did attend but did not finish is
   recorded as `session_ended` instead — those patients are equally owed, and
   the distinction keeps an administrator from being told a doctor was absent
   when they were not. Both refund in full.

58. **A refund is raised as eligibility, and paid separately.** Ending a
   session marks everybody owed in one statement; each refund is then its own
   provider call. The alternative — refunding inside the session's end — makes
   ending a chamber fail when a gateway is slow, which is the worse failure.
   Nothing yet sweeps the eligible rows and pays them: that is a worker, and
   `pg-boss` is still not installed. **An administrator refunds them from the
   endpoint in the meantime**, and `payments_refund_pending_idx` is the list.

59. ~~**The demo refund percentages.**~~ **Settled, and not to be raised.**
   Shapla 100/50 at twelve hours, Padma 100/25 at twenty-four, Jamuna full
   either way, Meghna 80/0, and two facilities with none. These stand. The
   owner's ruling (2026-09-23): this is the pitch version, the demo refund is
   the deliverable, and payment specifics are not something to put in front of
   him. Do not ask about them again.

60. **A settlement is dated by the session, not by when the money cleared.**
   A payment that settled at midnight belongs to the chamber it paid for. That
   is what a hospital reconciles against, and it is the opposite of what an
   accountant might expect; step 19's dashboard will surface the same figures
   and should agree.

Raised while building the dashboard (step 19):

61. ~~**`FR-ADM-01`'s average wait needs a check-in, and the product has none.**~~
   **Settled 2026-09-23 and built** (`feat/check-in`, below): reception
   checks a patient in and quotes a wait, as a restaurant confirms an order
   with a preparation time. The original note follows.
   The wait from arriving to being called can only be measured if something
   records the arrival, and no reception action in `PRD.md` §8 does. The
   dashboard says the figure is unmeasured and leads with the lateness against
   the patient's own slot instead (migration 0020). It could go one of two
   ways: add a check-in action (a new queue event and a button on `S-B-02`,
   which is a `PRD.md` change), or accept slot lateness as this version's
   headline. Until one is chosen, the wait tile says what is missing. Nothing
   on it is invented.

62. ~~**Reception records a standby acceptance; `BACKEND.md` §7 says the patient
   does.**~~ **Settled 2026-09-23 and built** (`feat/standby-self-serve`,
   below): the patient joins from the app; prepaid is seated automatically,
   everybody else answers on their phone, and reception keeps its button for
   somebody who rings. The original note follows. The table lists `POST /offers/:id/accept` as `user | guest`, and
   `APP_FLOW.md` D2 routes a slot offer to an `S-A-08` offer sheet. But a
   standby patient holds no booking, so they have no tracking link and no
   `S-A-08` to accept from. The route is `receptionist`, and the SMS
   (`queue.slot_offered`) says "tell the counter by {time}". Patient-side
   acceptance needs a standby tracking link, which is a new token audience.
   `POST /sessions/:id/standby` (`BTN-A06D-STANDBY`, joining the list from
   the app) is also not built, so standby rows come from the seeds and the
   E2E fixture only.

63. **The first tab is সারসংক্ষেপ (overview), not "Today".** `APP_FLOW.md` B6
   puts the date-range selector on its Today row, and every figure follows the
   range, so a tab called "Today" showing thirty days would be wrong. The
   screen opens on the last thirty days, which is long enough for the trend to
   show the adoption marker.

64. **B6's department filter is not built.** The API has no department
   parameter, and `FR-ADM-01`…`10` do not ask for one. Revenue already breaks
   down by department. Adding the filter is a query parameter through six
   repository reads.

65. **An offer is made to one person at a time.** `BTN-B02-OFFER`'s label in
   `APP_FLOW.md` B1.5 reads "৩ জনকে প্রস্তাব পাঠান", which suggests three at
   once. `FR-QUE-30` says "in order … unaccepted offers pass to the next".
   Built as the requirement says: one person, a ten-minute window
   (`SLOT_OFFER_WINDOW_MINUTES`), then the next. Offering three at once would
   have three people racing for one chair. `BACKEND.md` §7.4 also says a
   no-show brings an "auto slot offer", while `APP_FLOW.md` B1.5 gives it a
   button. `APP_FLOW` has authority over controls, so it is the button:
   reception decides whether a chair is worth offering this late in the
   chamber.

Raised while building the national layer (step 20):

66. **The symptom category comes from a tag the doctor sets.** `FR-GOV-03`
   needs dengue / diarrhoeal / fever counted by area, and nothing recorded a
   category. Built as `CHIP-B05-SIGNAL` on the doctor's visit form: optional,
   one of the three `FR-GOV-03` names, `visits.symptom_signal`. It is a new
   control on `S-B-05`, recorded in `APP_FLOW.md` B2 and `PRD.md` §15. The
   alternatives were a category on the patient's booking (self-reported, and
   "dengue" is not something a patient reports) or saying the signal is
   unmeasured, as step 19 once did for the wait. **Needs the owner's yes.**

67. **What a spike is.** At least five cases this week *and* at least double
   the usual week, where "usual" is the average week over up to fourteen days
   before this one, and at least seven days of reporting are required. No
   document gives a rule; this is the plainest one the screen can state in a
   sentence. The constants are `SPIKE_MIN_CASES`, `SPIKE_RATIO` and
   `BASELINE_MIN_DAYS` in `shared/domain/src/gov/signals.ts`.

68. **The "map" is district tiles.** `FR-GOV-01` says capacity *map*. A
   drawn map of Bangladesh needs district boundary data and a mapping library
   (e.g. MapLibre) — a new dependency (`CLAUDE.md` §7). The tiles carry the
   same figures, each with its age. Say the word and it becomes a map; the API
   is already per district.

69. **Benchmarking names a facility's kind, and nothing else.** "Anonymised
   facility benchmarking" is read as: no facility named, each measure ranked on
   its own so a reader cannot follow one facility across every column. In the
   demo set the one government hospital is unique by kind, so its rows are
   identifiable as "the government one". With a real national set that stops
   being true. If a ministry is meant to see names, this is the decision to
   change.

70. **A benchmark figure needs five observations** (`MIN_BENCHMARK_SAMPLE`).
   Below that, the facility is left out of that measure and counted as "too
   few", rather than ranked on luck.

71. **Ventilators and blood are "not recorded".** `FR-GOV-01` names both; no
   table holds either (`bed_kind` has no ventilator, and blood stock is
   decision 47). The capacity tab says so rather than showing zero.

72. **No `platform_admin` is seeded.** 0024 allows one, but `S-B-12` is not a
   build step and an account for a screen that does not exist would be a
   picker button to nowhere.

73. **A guest's SMS is always Bangla.** The language switch changes the
   screens (`feat/language-switch`), but `FR-NOT-04` picks the SMS language
   from the account (`users.locale`, `FR-PAT-05`), and a guest has no account
   (`CLAUDE.md` §4.1). The booking could carry the phone's language instead: a
   `locale` column on the guest contact or the booking, sent with
   `POST /bookings`, and read by `notification.repo` where it now falls back
   to `bn`. That is a schema change and a product call: whether a patient who
   reads the app in English should also be texted in English before accounts
   exist. Implemented as: not yet — the SMS is Bangla.
74. **The rail has eight items, not seven.** `APP_FLOW.md` B1.1 listed seven
   and sent বিল to the pharmacy while `S-B-04` (billing) is not built, so a
   person clicking Billing landed on medicine stock. Implemented as: ফার্মেসি
   is its own item and বিল is switched off with its reason (`fix/console-rail-billing`),
   B1.1 edited. The alternative is to drop বিল from the rail until `S-B-04`
   exists.
75. **Staff passwords use scrypt, not Argon2id.** `BACKEND.md` §0 named
   Argon2id; that is a native dependency, and `CLAUDE.md` §7 asks before any
   new one. `node:crypto` scrypt at OWASP's minimum (N = 2^17, r = 8, p = 1)
   needs none. Implemented as: scrypt, recorded in `BACKEND.md` §0 and
   `DATABASE.md` §2.1. Switching later means rehashing at each next login.
76. **Import reads CSV only.** Reading `.xlsx` needs a library. Excel's
   "Save as CSV (UTF-8)" covers it, and the templates are CSV. Implemented as:
   CSV (`FR-IMP-09`).
77. **Imported patients belong to the hospital; counter registrations are
   guests.** `FR-GST-13` already makes a counter registration a guest
   identity. An imported register is the hospital's record, not the patient's,
   so it gets `patients.owner_hospital_id` (0030) and stays out of any patient
   app until claimed (`FR-IMP-10`). Implemented as: both, as described.
78. **Set D (old records) is not in the first import release**
   (`FR-IMP-12`) — it is the most sensitive set and the hospital's legal
   adviser should agree it first.
79. **Two-step had no requirement text, so `FR-SEC-10` was added.** `CLAUDE.md`
   §4.2 names step 28 and "the 2FA half of `FR-SUP-01`", but neither
   `FR-SUP-01` nor `FR-SEC-06` mentions a second factor. Implemented as: a new
   `FR-SEC-10` in `PRD.md` §SEC recording step 28 as built. Say if it should
   be worded differently or folded into `FR-SEC-06`.
80. **Who must have it.** "Required for administrators" is read as
   `hospital_admin` and `platform_admin`; `gov_viewer` (read-only aggregates)
   is not required, and every other role may opt in. Implemented as:
   `TWO_FACTOR_REQUIRED_ROLES` in `shared/domain`.
81. **Recovery codes are not regenerated by the person.** Ten, each once;
   the picker warns at three. Running out means an administrator's reset and
   setting it up again, which issues ten new ones. A "new codes" button is a
   small addition if wanted.
82. **An administrator cannot reset their own two-step on `S-B-11`**
   (`own_two_factor`), for the same reason as their own password: another
   person's check. A facility's only administrator is reset from the server.
83. **Fixed (`fix/next-without-waiting`): `BTN-B02-NEXT` waited for the
   server between its two halves.** `callNext` awaited `PATIENT_DONE`'s
   network flush before queueing `PATIENT_CALLED`, so on a slow server the
   "called" half arrived a round trip after the tap (`NFR-02`). Both now go
   through `actMany`: queued together, applied together, one flush. The first
   cut failed the canary, which is what it is for: the server orders a batch
   by client time and breaks ties on the random key (`SY-01`), and two events
   made in one millisecond were replayed "called" before "done" half the time.
   Actions from one tap are now a millisecond apart.
84. **Push notifications wait for a signed hospital** (owner, 2026-09-30).
   `FR-NOT-02`'s push half stays unbuilt until a deal is made; SMS stays on
   the log provider (step 27 waits for an aggregator account). The pilot runs
   on the lowest cost there is: free tiers for the demo, and a hospital's own
   running costs carried by the hospital (terms live outside the repo).
85. **Ruled (owner, 2026-09-30): a returning guest proves the phone once per
   device.** The documents had disagreed — `BACKEND.md` §7.1 let "a number
   that has proved itself skip the code", `APP_FLOW.md` A1 bound the guest
   token to "phone + device" — and the security review found the first handed
   anybody who typed the number a token for it. The same phone is not asked
   again and saves the SMS; any other device, or a stranger typing the
   number, is sent a code. `BACKEND.md` §7.1 and `APP_FLOW.md` A1 now say so.
   **Judgement calls, not ruled:** the proof lasts 90 days and is renewed on
   each use, and it is bound to the user agent as a patient's refresh session
   is (`FR-SEC-05`) — a browser update means one more code. Stateless, so it
   cannot be revoked one by one; rotating `GUEST_LINK_SECRET` ends them all.

Raised while fixing the handover's findings (`docs/PLATFORM_PLAN.md` phase 1):

86. **What a delay declared after the doctor arrived means**
   (`fix/delay-on-arrival`). The documents say only that ETAs are "adjusted
   for declared delays" (`FR-QUE-11`). The bug was that a delay declared
   before the arrival kept being added afterwards. Fixed as: the arrival uses
   up whatever was declared before it. A delay declared *after* the arrival
   could have been dropped the same way, but reception and the doctor can
   both declare one mid-chamber (`FR-REC-03`, `FR-DOC-02`), so it is read as
   a hold: nobody is expected to be called before "declared at + minutes",
   a second delay extends a hold still running, and the no-show grace cannot
   end before the hold does. `BACKEND.md` §4.1 now says so. The other reading
   — a later delay only shifts estimates and never blocks absent-marking —
   is a one-line change in `rules.ts` if the owner prefers it.
87. **The no-show grace and a break** (`fix/console-resume`). No document
   says whether the grace (`FR-QUE-20`) runs while a chamber is paused. Until
   now it did, and nothing stopped a patient being marked absent mid-break —
   harmless while no chamber could be resumed, and a way to lose a turn to a
   prayer break once one can. Built as: nobody is marked absent while paused
   (the refusal says to resume first), and the grace for whoever is at the
   front starts again, in full, at resume. `BACKEND.md` §4.1 and
   `APP_FLOW.md` B1.2 now say so. The stricter reading — only the paused
   minutes are given back — is a small change if preferred.
88. **What a counter PC keeps about patients for offline use**
   (`feat/console-offline-load`). Kept today: unsent actions, which can
   carry a name and a phone (a bed admit, an ER walk-in) and are deleted on
   send; and the last queue per chamber, which carries no names. **Not**
   kept: patient names for the queue, the ward board, the ER case list. So
   a reload with no network shows serials without names, and the ward and
   ER consoles say their board could not load. Keeping those would make an
   outage far more workable and would leave identifiable patient data,
   unencrypted, in the browser storage of a shared PC. Built the cautious
   way; the owner decides whether to keep more, and with what protection.
89. **What the browser suite records while it runs** (`chore/e2e-ci`). The
   trace recorder is what grows to 6.7 GB over a full run (*Things learned
   the hard way*). **In CI it is now off**, because a hosted runner has no
   page file to grow into: a failure there keeps its video, its screenshot
   and the page as it stood, and loses the step-by-step trace. **On a
   developer's machine nothing changed** — traces are still recorded and
   a full run still ends with the page file enlarged. Turning it off there
   too would take about 6 GB off a run and cost the trace of a failure;
   running the suite against built apps would take another 2 GB off and
   needs `console-cold-start.spec.ts:98` rewritten first. The CI choice
   was made so that CI can run at all and is one line to reverse
   (`playwright.config.ts`); the local one is the owner's.
90. **A limit on an address counts everybody behind it**
   (`fix/e2e-fast-runner`). The API refuses the 31st phone check from one
   address in ten minutes, the 11th standby place and the 11th emergency
   alert (`middleware/rateLimit.ts`, `byIp`). The numbers were never measured
   (their own comments say so) and they assume an address is a person. In
   Bangladesh it often is not: a hospital's waiting room on the hospital's
   Wi-Fi is one address, and a mobile carrier puts many subscribers behind
   one. **A busy counter's patients could be refused a booking by this on a
   real server**, and they would be told to wait ten minutes. The browser
   suite met it first, as 150 patients on one machine.
   Built as: `ADDRESS_RATE_LIMIT_FACTOR`, 1 to 100, multiplies every
   per-address limit; unset, nothing changes. It does not touch what protects
   a person — codes per number, the lock after five wrong codes, sign-in
   lockout — which are in the database and not keyed on an address.
   **For the owner:** what a pilot hospital's server should set (it depends
   on whether patients book from the hospital's network), and whether the
   defaults themselves should rise. Not chosen here; `DEPLOY.md` Part S says
   the setting exists and when to raise it.

Two were the owner's, and both are **settled — closed on 2026-09-22 and not to
be raised again**, in a session or in a report. They were repository
visibility and credential rotation. The owner knows the facts and the
trade-offs, has decided, and asked directly that neither be brought up again.
They are recorded here as closed only so that a fresh session does not
rediscover them and start the conversation over; nothing about either is
outstanding, and nothing about either needs mentioning.

---

## Deploying

`docs/DEPLOY.md` is the runbook: Supabase, then Render, then two Vercel
projects. Three things in it are the ones people get wrong, so they are worth
repeating here:

- **`NODE_ENV=development` on the deployed API, deliberately.** `env.ts`
  refuses to boot with `DEMO_MODE=true` under `NODE_ENV=production`, and that
  guard is right — production means real patients. A pitch demo is not
  production. `TRUST_PROXY_HOPS=1` now carries the one thing `NODE_ENV` used to
  control that matters behind a load balancer.
- **`WEB_BASE_URL` is not cosmetic.** It is half the CORS allowlist *and* the
  origin every booking's tracking link is built from. Wrong, and every SMS in
  the demo points at localhost.
- **Supabase's session pooler, port 5432**, with the password percent-encoded.
- **Never `npm install -g` in Render's build.** On the Node it ships with (24),
  the global directory is read-only. The live service's dashboard still does
  it, so `.nvmrc` holds Render on 22 until the dashboard commands are changed
  to the ones in `DEPLOY.md` §2.

**The console has a way in now.** `ConsolePicker` is `S-B-01` standing in for
the login this version does not have (`CLAUDE.md` §4.1): pick a hospital, a
chamber and a role, no password, and the screen says so. Before it, opening the
console meant pasting a token into `sessionStorage` by hand — fine on the
machine that built it, impossible to hand to anybody. `GET /demo/consoles` and
`POST /demo/token` back it, both refused unless `DEMO_MODE` is on.

The token now lives in one place, `console.demo-session`. It used to be written
under that key and read from `console.token`, which was two stores for one
credential.

---

## Running the pitch demo

**From the `demo` branch** (CLAUDE.md §3.1): the demo-data version, kept at
the last green commit of `mvp`, for pulling onto any machine to show
somebody. It is moved to each green merge into `mvp` and pushed with it, so
`git log -1 demo` names the commit; as of 6 October that is the V1 pitch
build, whole (`fa31157`), under the name MedLiveBD — search across
hospitals, a hospital's own app, onboarding from the platform administrator's
screen, the mapped import with a model's suggestions and the warnings before
approval — which is also what `main` and the public demo
are. **Green means
`pnpm verify`, `pnpm test:e2e`, `pnpm test:e2e:built` and
`pnpm test:e2e:prod`.**

```bash
git fetch origin && git checkout demo && git pull
pnpm install
```

On a machine that has run it before, that is all. On a new one, `.env` first:
`cp .env.example .env` (`DEMO_MODE=true` is already its default), then give
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `GUEST_LINK_SECRET` each their
own value from `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
— the API will not start without them. Then the steps below.

Two devices, or two browser windows, which is what `two-device-queue.spec.ts`
automates.

```bash
docker compose up -d                 # Postgres
DATABASE_URL=…healthcare_dev pnpm db:reset
pnpm dev:api                         # :4000
pnpm dev:console                     # :3100  — reception
pnpm dev:patient                     # :3000  — the patient
```

1. **Patient**: `http://localhost:3000` — the home screen: the search box
   first, then the emergency card, the specialty grid and the bottom
   navigation. Tap the search box and type what somebody needs — **আইসিইউ**,
   **বার্ন**, **কার্ডিওলজি**, a doctor's or a hospital's name — or tap one of
   the chips. Each hospital that can provide it is listed with the live figure
   for that need and its age. Tap a hospital or a doctor to go straight into
   booking there (or tap a specialty on Home, then the hospital, the doctor
   and the chamber); fill in name / phone / age and confirm. The success
   screen shows the serial and **লাইভ সিরিয়াল দেখুন** — tap it.
2. **Reception**: `http://localhost:3100`. The console picker (`S-B-01`) opens
   first: choose the hospital, the chamber and the role, no password. There is
   no login screen by design (CLAUDE.md §4.1) and the screen says so. Pick the
   session the booking was made on. The token it mints is stored under
   `console.demo-session`; `e2e/support/console.ts` shows how one is minted
   without the UI.
3. Tap **পরবর্তী রোগী ডাকুন**. The patient's "এখন চলছে" changes within two
   seconds, the progress track advances, and the ETA moves.

The patient's serial is also on **সিরিয়াল** in the bottom navigation and on the
home screen's live strip, both of which read what this device booked.

4. **The doctor's screen** (`S-B-05`): open a second console tab, pick the same
   hospital and chamber but the **ডাক্তার** role. It opens on whoever is in the
   chamber with their pre-visit answers and past visits. Type a diagnosis, tap
   **রেকর্ড দিন ও পরবর্তী** — the record is filed and the next patient is called
   in the same action (`FR-DOC-08`), which reception's tab sees immediately.

That is `PRD.md` §24 step 6, minus the prescription the owner removed from this
version.

5. **The national dashboard** (`S-B-13`): on the picker, below the hospitals,
   **জাতীয় ড্যাশবোর্ড খুলুন**. রোগ-সংকেত opens on dengue rising in Dhaka.
   On the doctor's screen, tapping **ডেঙ্গু** before signing adds one to that
   district's count on the next reload.

The patient screen also carries **আমি দেরি করছি** and **বাতিল করুন**, both of
which write real events the console sees. **Nothing reschedules** — do not
offer it in a pitch (`PRD.md` `FR-PAT-23`, §24).

**The platform half of the pitch** (`PRD.md` §24 steps 9–11), added by the V1
pitch build:

6. **A hospital's own app**: `http://localhost:3000/?scope=PADMA`. The same
   app is Padma's: its name in the header, its navy in place of the green,
   its doctors, beds and search results only, and only the serials this phone
   booked at Padma. `http://localhost:3000/?scope=` gives the network back.
   The scope is kept for the tab, so open it in its own tab or window.
7. **A hospital joins**: on the console picker, **প্ল্যাটফর্ম পরিচালনা →
   হাসপাতাল অনবোর্ডিং খুলুন**. The list is every hospital with those waiting
   first. **নতুন হাসপাতাল যোগ করুন** makes one with its first administrator and shows
   the temporary password once. To show the rest live — the administrator
   signing in (**স্টাফ অ্যাকাউন্টে লগ ইন** on the picker), changing the
   password, the checklist on settings, **পর্যালোচনার অনুরোধ করুন**, then back
   on the platform screen verifying a doctor and approving — have an
   authenticator app ready: an administrator cannot sign in without the second
   factor (`FR-SEC-06`), and the demo does not waive it. It takes about three
   minutes. The short version: create the hospital, show it sitting in
   **সেটআপ চলছে** with nothing a patient can see, then open a live hospital's
   row to show suspend and reinstate with a reason.
8. **A hospital's own export**: picker → any hospital → **ড্যাশবোর্ড খুলুন →
   সেটিংস খুলুন → পুরোনো তথ্য আমদানি করুন**. Choose **খ রোগীর তালিকা** and upload
   `database/seeds/samples/hospital-export-patients.csv` (English headings
   of the hospital's own) or `hospital-export-patients-bangla.csv`. The
   mapping step shows which column was read as what and why, and what will
   not be imported; confirm, and the ordinary check, preview, approve and
   undo follow. Upload the same file again and it maps itself. Every row in
   those files is marked demonstration data. For the warnings before
   approval (`FR-IMP-21`), upload `hospital-export-patients-untidy.csv`:
   two patients entered twice and dates written two ways, named by row
   number above the approve button, and nothing merged.
9. **The model's suggestions** need `MAPPING_PROVIDER=claude` and
   `MAPPING_API_KEY` in `.env`, and the API restarted. Then upload
   `hospital-export-patients-abbreviated.csv`: the rules place only the phone
   column, and the model suggests the rest, each marked **এআইয়ের প্রস্তাব**
   with its reason. Without the key the same file is matched by hand, which is
   also worth showing. **It has only ever been run against a stand-in for the
   network: run `pnpm mapping:try --set patients --file
   database/seeds/samples/hospital-export-patients-abbreviated.csv` with the
   key before a meeting, not in one.**

**Next is pinned to `--webpack`.** The shared packages import with the `.js`
extensions Node ESM requires; webpack resolves those through `extensionAlias`
and Turbopack has no equivalent. Worth revisiting when it gains one —
Turbopack is substantially faster and this is the only thing holding it off.

---

## Known gaps, deliberate

- **`OtpInput` has no caller.** It is named in step 7's component list and is
  built, but every OTP *flow* is deferred to Supabase Auth (`CLAUDE.md` §4.1),
  so nothing renders it yet. It holds no credential and calls no endpoint — it
  is the input primitive, and Supabase's flow will need exactly this box.

- **One signature component (`FRONTEND.md` §6) remains.** `<FreshnessLine>`,
  `<QueueTable>`, `<LiveSerialCard>`, `<BedTile>` and `<CapacityMirror>` are
  built and rendering; `<DelaySheet>` lands with the delay flow it belongs to —
  see the next item.

- **Tailwind is v4 and compiles in both apps.** The v3-style JS preset was
  replaced by `@theme inline` in `shared/ui/src/styles.css`, which maps every
  utility onto the token variables and clears Tailwind's own palette
  (`--color-*: initial`), so `bg-indigo-500` does not exist. `--radius-*`,
  `--font-*` and `--duration-*` sit in `@theme` rather than `tokens.css`
  because those are Tailwind's own namespaces, and `min-h-touch` is an
  `@utility` because Tailwind has no such thing. The `@source` line at the top
  is load-bearing — see the note under "things learned the hard way".

- ~~**No authentication is implemented, by decision.**~~ **Staff sign-in is
  built** (step 21, `FR-SEC-06`). Patient phone verification is not yet —
  step 25 (`FR-PAT-01`, `FR-PAT-04`, `FR-GST-03/04/09/12`, `FR-SEC-05`). Under
  `DEMO_MODE=true` the picker still opens any console without a password, and
  a booking returns a signed guest tracking link.
- ~~**`FR-DEM-05` is not covered.**~~ **Covered as of step 17.** Migration
  0011 landed and `seed_06_ancillary` runs: eight ambulances, thirty blood
  donors, fifty pharmacy items. **No seed module is waiting on a migration any
  more**, so every `FR-DEM-*` requirement is rows rather than a skip notice.
- ~~**`seed_04_history` defers prescriptions and reports.**~~ Reports landed
  with step 17, so `FR-DEM-03` is covered in full. Prescriptions are not
  deferred but **dropped** (`FR-DOC-04`), so there is nothing left waiting.
- **Today's sessions other than the pitch one are left `scheduled`.** If a
  reset happens late at night, an 18:00 chamber that has already passed still
  shows as scheduled with no events. That is honest — nothing was recorded —
  but it is a wart for a late demo. The pitch session itself is always built
  backwards from the current instant, so it is correctly mid-queue at any hour.
- **(Since H1, 7 October: sending and its retries are done by a sender in the API process, with no `pg-boss`; what follows is as it was written, and the leave-home alert is still absent, plan H1b.)** **`pg-boss` is not installed, so there is no worker process.** Every message
  step 11 sends is caused by an event, so it is raised from the event and needs
  no scheduler — which is more accurate than a 60-second poll, not merely
  cheaper. Two jobs in `BACKEND.md` §8 genuinely need a timer and are therefore
  absent: `queue.leaveNow` (`FR-PAT-32` as a *notification*; the patient screen
  already shows the banner) and `notify.retry` (the log provider never fails).
  `backend/workers/src/index.ts` is still a stub. The outbox is built for this:
  a failed send is a `queued` or `failed` row under a partial index, so adding
  the worker is a subscriber, not a redesign.

- **`notifications` has no `booking_id` column**, because DATABASE.md §2.7 does
  not give it one. The booking travels in `params ->> 'bookingId'`, which is
  what the delivery queries and the send-once dedupe match on. A column would
  be better and needs a document change to justify.

- **Push is recorded as skipped for everybody.** Web Push needs VAPID keys, a
  service worker and a `device_tokens` row, and none of the three exists yet —
  no screen asks for notification permission. So `FR-NOT-02` ("app users get
  push + SMS; non-app users get SMS only") is already *correct* rather than
  stubbed: today every patient is a non-app user, and the adapter says so with
  `no_device_token` rather than pretending.

- **Reschedule is not built, so `<DelaySheet>` is not either.** `BTN-A08-RESCHEDULE`
  and `POST /bookings/:id/reschedule` need `S-A-07b` in reschedule mode, which
  is its own flow; step 10's contents in `CLAUDE.md` §4 name late and cancel.
  `FR-PAT-34`'s one-tap keep/reschedule/cancel therefore waits for it. What
  *is* built is the patient's side of a declared delay: `session.delayed`
  reaches the screen, the surface shifts to the warn family and the status line
  states the minutes, which `two-device-queue.spec.ts` asserts. The button is
  absent rather than present and dead.

- **The console has no delay control.** `BTN-B02-DELAY` and `MOD-B02-DELAY` are
  named in `APP_FLOW.md` B1.2 but were not built in step 8, so
  `two-device-queue.spec.ts` raises the delay through `POST /sessions/:id/delay`
  with a staff token — see `queueAction` in `e2e/support/console.ts`. The
  endpoint and the broadcast are real; only the button is missing. Worth adding
  before the pitch, since `PRD.md` §24 step 3 has a person tapping it.

- **`rateLimit` keys on `req.path`, which makes it useless on a path
  parameter.** The key is `${method}:${path}:${keyFor(req)}`, so
  `/guest/link/:token` would get one bucket per token and never trigger.
  Nothing relies on it there — a tracking token is 32 random bytes, so guessing
  is not the threat — but the next parameterised route that wants a limit needs
  `rateLimit` changed first.

- **Notifications are not published from the queue service.** Step 11 of
  `BACKEND.md` §4.1 fires the called / delayed / two-away / slot-offered
  messages; that is build step 11. The seam is marked in `queue.service.ts` and
  the events that would fire one are already identified by `isMaterialEvent` in
  the domain, so it is a call to add rather than a decision to make.
- **`/sync/*` is not built** (`BACKEND.md` §5). The offline batch endpoints
  belong with the console that fills the batch, in step 8. The domain already
  has `applyBatch`, which returns the accepted/conflict split `SY-05` describes.
- **`middleware/audit.ts` is not written.** `audit_log` is migration 0010 and
  the schema is at 0006, so it would have no table to write to. It lands with
  the migration.
- **`backend/api` has no production build script.** Internal packages are consumed
  from TypeScript source, so a deployable build needs either emitted output from
  `shared/domain` or a bundler. That is a dependency decision for the owner,
  and it blocks the Render deploy at step 6.
- ~~**Four of the five required Playwright specs exist.**~~ **All five exist
  as of step 19** (`CLAUDE.md` §6): `two-device-queue.spec.ts` — the canary —
  `guest-booking.spec.ts`, `offline-console.spec.ts`,
  `emergency-burn.spec.ts` and `no-show-recovery.spec.ts`.
- ~~**Five files fail `prettier --check` on `mvp`.**~~ Fixed by
  `chore/format-clean` before step 17; `pnpm verify` is green.
- **`<EmergencyEntry>` does not preload on pointer-down** (FRONTEND.md §6.3).
  The results screen asks for location and searches on arrival; preloading
  would need the position first, which is the slow part.
- **bKash and Nagad are not implemented.** `PAYMENT_PROVIDER=mock` is the
  working provider and the correct one for this version (`CLAUDE.md` §1.1);
  `live` selects an adapter that refuses every charge with a named reason
  rather than a client that throws the moment a patient taps pay. Both
  provider files carry the call sequence, the response that actually means
  the money moved, and the one thing that bites — see the step 18 notes. Nagad
  has no refund in its checkout API, which is written into `nagad.ts` where
  whoever implements it will read it.

- **Nothing charges for a bed, a test or an ambulance.** `payments` has the
  columns because DATABASE.md §2.6 specifies them, and none of those three has
  a price anybody has agreed: a nightly rate, a catalogue price and a quoted
  fare are commercial terms per hospital (`CLAUDE.md` §1.1). Charging for them
  needs those terms, not more code — `payment.service` refuses anything but a
  booking and says so.

- **`subscriptions` and `invoices` are empty tables.** Nothing generates an
  invoice, because there is no agreement to invoice against. The shape is
  there so that when there is one, it is a service and not a migration.

- **`/webhooks/sms-dlr` is not built.** BACKEND.md §7.7 lists it beside the
  payment callbacks; it belongs to notifications and `SMS_PROVIDER=log` has no
  delivery receipts to send. It arrives with a real aggregator.

- **A refunded platform fee is approximated in the settlement.** `payments`
  records one refunded total rather than splitting it by line, so the fee
  retained is capped at what the patient did not get back — exact at both ends
  and an approximation in between. A `platform_fee_refunded_poisha` column
  would make it exact. It does not matter while `PLATFORM_FEE_POISHA` is 0.

- **`FR-PHR-01` (dispensing) is not built**, because prescribing is not.
  `S-B-09` names the missing half on screen rather than showing a scanner that
  cannot work; `PRD.md` §12 and `APP_FLOW.md` B5 were edited to say so. It
  becomes buildable the day `FR-DOC-04` does, and needs no schema: the
  `prescriptions` and `prescription_items` tables are already there.

- **`S-A-13` (diagnostics booking) is not built**, so `FR-LAB-01`'s "and app
  bookings" half is uncovered. It is a catalogue-plus-payment flow and payment
  is step 18. Nothing blocks it: `test_orders.visit_id` is nullable and the
  seed already writes walk-in orders through that path.

- **(Closed by plan F2, 6 October: a report-ready message now goes by SMS; see *Merged in V1 completion*.) `lab.report_ready` reached nobody in this version.** `BACKEND.md` §8 maps
  it to **push only**, which is a defensible product call — a report is not a
  summons, and it is in the wallet before the message is written. But no
  screen asks for notification permission yet, so every push is recorded as
  `skipped: no_device_token`. The row is written and says so; the delivery
  `FR-LAB-03` actually promises has already happened. Worth the owner's word
  on whether a report deserves an SMS, which would be a `BACKEND.md` §8 edit.

- **The test catalogue is declared twice**, in `lab.service.ts` and in
  `seed_04_history.ts`. `database/seeds` may not import from `backend/api`
  (the layering rule), and a catalogue is demo data in both places. They are
  held to the same codes by test rather than by a shared module; a real
  hospital's catalogue is a table, and that is the right time to merge them.

- **The mock store keeps report files in process memory**, so restarting
  `pnpm dev:api` loses anything uploaded during a demo. Seeded reports survive,
  because those are synthesised on read. `STORAGE_PROVIDER=supabase` is
  required in production and the env refuses `mock` there.

- **`frontend/site` is still empty.** `shared/client`, `frontend/console` and
  `frontend/patient` are built.
