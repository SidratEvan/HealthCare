# CLAUDE.md

Operating instructions for Claude Code on this repository.
Read this file first, in full, before any other action in a session.

---

## 1. What this project is

A two-sided healthcare platform for Bangladesh: a Bangla-first patient PWA and a set of hospital staff consoles, built around a **live queue engine** that keeps a doctor's chamber queue true in real time.

The product's entire value is that one thing: reception taps *next*, and every waiting patient's phone updates within two seconds. Everything else supports it.

### 1.1 Which version this is

**This repository is the pitch version.** `PRD.md` §4.1 calls it v0. It is the
real product, built properly, but it is the first version of it — the one shown
to hospital and clinic decision-makers to win an agreement, not the one serving
real patients.

What that means in practice:

- **Everything runs on seeded demo data** (`FR-DEM-*`), and every demo row is
  visibly labelled as demonstration data (`FR-DEM-07`).
- **No real patient data, ever** (`FR-SEC-08`). Not in development, not in the
  demo, not in a screenshot.
- **Mock and log adapters are the correct implementation right now, not
  placeholders to apologise for.** `SMS_PROVIDER=log` writes to the console and
  the notifications table; `PAYMENT_PROVIDER=mock` always succeeds;
  `TRAVEL_TIME_MODE=static` uses the built-in matrix. These are what the demo
  runs on, and they are the values `DEMO_MODE=true` expects.
- **Real credentials and real integrations come later** — after agreements with
  hospitals or clinics. A live SMS aggregator, live bKash and Nagad keys, a
  hospital's own HMS, the national shared health record: each arrives when
  there is a signed counterparty to arrange it with, not before. The adapter
  interfaces exist so that swap is a configuration change (`BACKEND.md` §0).
- **Build to production standard anyway.** The strict types, the append-only
  event log, the audit rows, RLS, the honest-degradation rules: none of that is
  deferred because this is a pitch. The demo has to survive becoming the pilot,
  and a hospital director who sees a real console is being shown something that
  will still be true in six months.

### 1.2 What the product is becoming (owner, 2026-10-05)

One platform, not software written again for each hospital. It has three
faces over one API and one database:

- **The main patient app** — a multi-hospital network. A patient searches for
  what they need (a doctor, a specialty, a hospital, an ICU, a burn unit, a
  bed, an open serial) and sees which participating hospitals can provide it
  now, live figures before listed ones, each with its age (`FR-PAT-16`–`19`).
- **A private portal for each hospital** — the consoles that exist, inside
  that hospital's own workspace. Hospital A never sees hospital B's patients
  or internal data. A hospital contributes only public operational figures to
  the patient network: beds, capabilities, who is sitting, open serials, and
  how old each figure is (`FR-NET-01`–`03`).
- **Later, optionally, a hospital-branded patient app** — the same app and the
  same API, limited to one hospital and in its colours (`FR-BRD-01`–`04`).
  Only the foundation is built now.

Decided with it, and replacing what stood before:

- **One shared deployment hosted in Bangladesh is the default** (`FR-SEC-07`,
  as amended). A hospital on its own server is an exception for a later day,
  and V1 is not designed around it. The self-hosted stack (`DEPLOY.md` Part S)
  stays what it is: the same stack, on whichever machine holds it.
- **External providers do not block the product build**: a real SMS
  aggregator and sender ID, bKash, Nagad, merchant accounts, store
  publication, a paid penetration test. They follow company registration and
  hospital agreements (§1.1). Simulated codes, mock payment and demo data are
  what the pitch runs on.
- **What may not wait for two real hospitals on one database**: database-level
  tenant isolation, scope enforcement, and the cross-hospital reads the
  handover found (`docs/PLATFORM_PLAN.md` 1.10). It does not block a pitch on
  synthetic data; it blocks the second real hospital.
- **The name is MedLiveBD** (owner, 2026-10-06, replacing the working name
  HealthWealthBD). It is what the patient app's header, the installed app, the
  console's tab, a verification message and a downloaded template say. It is
  written the same in Bangla and in English until the owner gives a Bangla
  spelling. Not renamed, because nobody outside the code reads them: the
  `@platform/*` package scope, the repository's folder, and the names of
  tables. The domain is still undecided.

Do not add commercial content to this repository — pricing, what a module
costs, subscription tiers, or the data terms offered to a hospital. Those are
negotiated per agreement and live outside the repo. Product requirements that
*handle* money stay (`FR-PAY-*`, `FR-SUP-04`, the fee breakdown in
`FR-PAT-21`): the code has to charge, itemise and invoice. What it charges is
not a code decision.

---

## 2. The five documents are the source of truth

| File | Authority over |
|---|---|
| `docs/PRD.md` | **Scope and requirements.** Every requirement has an ID (`FR-QUE-14`). |
| `docs/APP_FLOW.md` | **Screens, controls, wiring.** Every control has an ID (`BTN-B02-NEXT`) and a trigger→UI→call→effect→broadcast→result→failure chain. |
| `docs/FRONTEND.md` | **Design system and client architecture.** Tokens, typography, components, banned patterns. |
| `docs/DATABASE.md` | **Schema.** Tables, columns, enums, indexes, RLS, migration order. |
| `docs/BACKEND.md` | **Services, files, APIs, realtime, sync, workers, build order.** |

`docs/STATUS.md` is **not** one of the five. It records where the build has got
to and what is still undecided; it has no authority over behaviour and the five
documents above override it.

Rules:
- If code and a document disagree, **the document wins** — fix the code.
- If a document is wrong or incomplete, **stop and tell me**. Propose the edit; do not silently invent behaviour.
- Never add a feature that is not in `PRD.md`. Never skip a requirement that is.
- Cite requirement IDs in every commit, PR, and code comment that implements one.

---

## 3. Git workflow — follow exactly

### 3.1 Branches

```
main          # protected. Only release merges. Always deployable.
mvp           # the integration branch. ALL work branches off this and merges back here.
demo          # the demo-data version, always runnable, for the owner to pull and show people.
feat/*        # one step of work. Short-lived. Deleted after merge.
fix/*         # bug fixes off mvp
chore/*       # tooling, config, docs
```

**Never commit directly to `main`, `mvp` or `demo`.** Never work on more than one `feat/*` branch at a time.

**`demo`** (added 2026-09-30, the owner's standing request): a branch the owner
can pull at any time and run on seeded demo data (`DEMO_MODE=true`,
`pnpm db:reset`) to show somebody. It only ever moves forward to a commit of
`mvp` that is green — `pnpm verify` and the e2e specs, the two-device canary
included — by a fast-forward (`git branch -f demo <that commit>`), never by
work of its own. Move it after each merge into `mvp` that is worth showing,
and say so in the report. Pushing it follows the rule below like any branch.

**Pushing: standing permission since 2026-10-03.** Until that day every push
needed a fresh yes, and a yes was spent by the one push it allowed. On
2026-10-03 the owner replaced that rule, in these words: "I give you explicit
permission to push, pull or whatever you need to do, or merge to any branch,
whether it's mvp or main." So:
- After a branch is merged green into `mvp`, push `mvp`, and `demo` when it moved, without asking. Say in the report what was pushed.
- Fetch and pull freely.
- `mvp` may be merged into `main` and pushed. A push to `main` redeploys the public demo, which reads Supabase, so the migrations `mvp` has and Supabase does not are applied first (`docs/STATUS.md`, *Deploying*). A release is a deliberate act, named in the report, never a side effect of a step.
- The permission is about not asking. It does not loosen the gate: nothing red is merged or pushed (§3.4, §5), and the canary still has to pass (§6).
- CI cancels a run in progress when the same branch is pushed again. Do not push `mvp` a second time while a run you need the result of is still going.
- Not covered, ask first: `--force`, or anything else that rewrites what is already on the remote.
- Unchanged, because the owner's words did not mention them: no creating remotes, no `gh` CLI, no opening pull requests, no publishing a repo.

### 3.2 First session only

```bash
git init
git branch -M main
git commit --allow-empty -m "chore: initial commit"
git checkout -b mvp
```
Then set up `.gitignore` (node_modules, .env*, .next, dist, coverage, playwright-report, test-results, *.local) and `.env.example` before anything else.

### 3.3 Every step after that

```bash
git checkout mvp && git pull
git checkout -b feat/<step-slug>
# ... work ...
git add -A && git commit -m "feat(queue): implement next-patient event chain (FR-QUE-10, FR-QUE-40)"
git checkout mvp && git merge --no-ff feat/<step-slug>
git branch -d feat/<step-slug>
```

- One branch = one step from the build plan (§4). Not two, not half.
- Commit message format: `type(scope): description (REQ-IDS)` — types `feat|fix|chore|test|docs|refactor`.
- Commit at every working checkpoint, not only at the end.
- A branch merges into `mvp` **only when its Definition of Done (§5) is fully met**.
- `mvp` merges into `main` as a release (§3.1): deliberately, with the migrations applied first. Until 2026-10-03 this needed the owner's word each time.

### 3.4 When something breaks

Do not pile fixes onto a broken branch and merge anyway. Either fix it on that branch until green, or `git checkout mvp` and start the step again clean. Never merge red tests into `mvp`.

---

## 4. Build order — work through this, one branch per step

Do not jump ahead. Do not start step N+1 until step N is merged into `mvp`.

| # | Branch | Contents | Done when |
|---|---|---|---|
| 0 | `chore/scaffold` | Monorepo (pnpm workspaces), tsconfig, eslint (layering rule), prettier, `.env.example`, CI workflow | `pnpm build` and `pnpm lint` pass |
| 1 | `feat/db-core` | Migrations 0001–0006 (`DATABASE.md` §7), `db:migrate`, `db:verify` | Schema applies clean on a fresh DB |
| 2 | `feat/domain-queue` | `shared/domain`: types, events, reducer, eta, rate, rules, replay | Unit tests green, including replay determinism |
| 3 | `feat/api-foundation` | `backend/api`: env, db, logger, middleware chain, error codes, health routes | `/healthz` responds; auth matrix tests pass |
| ~~4~~ | ~~`feat/auth-guest`~~ | **DEFERRED — do not build.** See §4.1 | — |
| 5 | `feat/seed-demo` | `database/seeds` 00–07 + `reset.ts` (`FR-DEM-*`) | `pnpm db:reset` produces 6 hospitals, 40 doctors, a mid-queue session |
| 6 | `feat/queue-service` | `queue.service.appendEvent()` + queue routes + realtime rooms | Every event type appends, reduces, broadcasts; conflict test passes |
| 7 | `feat/ui-tokens` | `shared/ui`: tokens, Button, Input, OTP, Card, Chip, Sheet, Toast | Storybook-less visual check + a11y tests pass |
| 8 | `feat/console-reception` | Reception console, offline queue (Dexie), optimistic reducer | Offline actions queue and sync on reconnect |
| 9 | `feat/patient-booking` | Patient app: discovery, booking, guest booking, success | Guest books end to end with mock payment |
| 10 | `feat/patient-live-serial` | `<LiveSerialCard>`, session channel subscription, late/cancel | **Two-device E2E test passes (§6)** |
| 11 | `feat/notifications` | Templates, workers, SMS/push adapters (log provider in dev) | Called/delayed/two-away messages recorded |
| 12 | `feat/doctor-console` | Doctor screen, e-prescription, visit records | A visit writes a record into the wallet |
| 13 | `feat/wallet` | Patient records, reports, QR consent | Consent + audit rows written on every view |
| 14 | `feat/beds` | Ward board, bed events, public capacity | Capacity mirror matches public numbers |
| 15 | `feat/emergency` | Triage, search ranking, inbound alerts, ER console | Burn-case scenario E2E passes |
| 16 | `feat/referrals` | Refer out/in with timeline | |
| 17 | `feat/lab-pharmacy` | Test orders, report delivery, dispensing | |
| 18 | `feat/payments` | bKash/Nagad adapters, refunds, settlements | Idempotency test passes |
| 19 | `feat/admin-dashboard` | Aggregates, no-show loss and recovery, exports | |
| 20 | `feat/gov-dashboard` | Aggregate-only national layer | No identifiable row reachable |

**Step 10 is the milestone.** When it passes, tell me — that is the pitch demo.

**Steps 21 onward are the pilot build** (§4.2), added after the pitch.

### 4.1 Authentication — deferred for the pitch, built for the pilot

**Until 2026-09-28** authentication was deferred to Supabase Auth, and step 4
was not built: under `DEMO_MODE=true` the console picks a hospital and a role
without a password, and a booking hands back a signed guest link (`FR-GST-05`).
That remains the demo, and it stays correct for the demo.

**On 2026-09-28 the owner decided** that a real deployment — the first for
Marks Group — runs on a server in Bangladesh (`PRD.md` `FR-SEC-07`), where
Supabase Auth does not run. So authentication is built here, as pilot steps
(§4.2), not as step 4:

- **Staff login** (`S-B-00`, `POST /staff/login`, refresh, logout) is step 21.
  Passwords are hashed with **scrypt from `node:crypto`**, not Argon2id, so no
  native dependency is added (§7). `BACKEND.md` §0 records the parameters.
- **Patient phone verification** (`POST /auth/otp`, `/auth/verify`, claiming —
  `FR-PAT-01`, `FR-PAT-04`, `FR-GST-03`, `FR-GST-04`, `FR-GST-09`,
  `FR-GST-12`, `FR-SEC-05`) is step 25.
- **Kept as they are:** the step-3 middleware (`attachPrincipal`,
  `requireAuth`, `requireRole`, `requireHospitalScope`, `guestAuth`) and
  `config/jwt.ts` — the new login issues the tokens they already verify.
- **`DEMO_MODE=true` keeps the password-less picker**; with it off, the
  picker's endpoint refuses and the console shows the login screen.
- **2FA** (the 2FA half of `FR-SUP-01`, `FR-SEC-06`) is step 28.

### 4.2 The pilot build — after the pitch

Added 2026-09-28. Same rules as §4: one branch per step, in order, merged into
`mvp` only when §5 is met.

| # | Branch | Contents | Done when |
|---|---|---|---|
| 21 | `feat/staff-auth` | `S-B-00` login, refresh, logout, lockout, first-password change, a CLI that creates a hospital's first admin; `DEMO_MODE` off shows the login | A staff member logs in with their own account and reaches only their role's consoles (`FR-SEC-06`, `FR-ROLE-01`) |
| 22 | `feat/hospital-settings` | `S-B-11`: departments, doctors, schedules, fees, wards and beds, capabilities, staff and roles (`FR-ADM-11`, `FR-SUP-01`); the worker that creates each day's sessions from the schedules | A hospital with no seed data can be set up from the screen and its chambers appear for the next seven days |
| 23 | `feat/counter-registration` | `S-B-03` registration, `BTN-B02-WALKIN` (`FR-REC-14`, `FR-REC-20`) | A walk-in is registered and inserted into a running chamber from the counter |
| 24 | `feat/data-import` | `S-B-14`: CSV sets A–C, check, preview, approve, undo, audit (`FR-IMP-01`–`11`) | Each set imports from its template, re-imports without duplicates, and undoes |
| 25 | `feat/patient-otp` | Patient OTP, sign-in, claiming guest and imported records (§4.1) | A patient verifies a phone and sees records made under it |
| 26 | `chore/self-host` | Docker images and compose for a Bangladeshi server, local file storage, backups, `DEPLOY.md` | The whole stack starts from one command on a clean machine and a backup restores |
| 27 | `feat/sms-live` | A real SMS aggregator behind the adapter | Needs an aggregator account — built when one exists (§1.1) |
| 28 | `feat/staff-2fa` | TOTP for staff, required for administrators | An administrator cannot sign in without the second factor |

### 4.3 The platform build — after the handover

Added 2026-10-02, from the owner's implementation brief of that day. The order
of work, branch by branch, is **`docs/PLATFORM_PLAN.md`**: the pilot blockers
the handover audit verified (phase 1), real patient entry (phase 2),
self-service hospital onboarding (phase 3), and an import that maps a
hospital's own export onto the template (phase 4). Same rules as §4: one branch
per row, in order, merged into `mvp` only when §5 is met.

- `docs/PLATFORM_PLAN.md` has no authority over behaviour. A phase that adds
  scope begins with a documents-only branch that adds the requirements to
  `PRD.md`; code follows the documents, as always (§2).
- The only AI in scope is the import mapping, and no patient row is sent to a
  model outside Bangladesh (`FR-SEC-07`, `FR-SEC-08`).
- The decisions that plan lists as the owner's (§7 there) are not to be chosen
  silently.

### 4.4 The V1 pitch build — the active plan (owner, 2026-10-05)

**This is what is being built now.** It replaces the client-readiness freeze
of the same morning ("no feature coding until a hospital agrees to pilot"),
which the owner lifted that evening. The reception-pilot candidate `fb1d1d8`
stays what it was: a tested commit for one hospital's own server.

The goal is a pitch that shows one platform connecting patients and hospitals,
not a reception pilot. Build until that experience is complete, then stop
adding scope. The order, branch by branch with its state, is
`docs/PLATFORM_PLAN.md` §2 (*Now: the V1 pitch build*):

| Phase | What |
|---|---|
| 0 | The direction written into the documents (`chore/v1-direction`) |
| 1 | Pitch foundation: nothing unfinished on show (ambulance and blood leave the patient app's first screen), the navigation the new structure needs |
| 2 | Patient search and discovery across hospitals (`FR-PAT-16`–`19`) |
| 3 | Hospital onboarding from screens: create, set up, checklist, review, go live (`FR-ONB-*`, `S-B-12`) |
| 4 | Mapped CSV import: rules and manual mapping, then a model's suggestions on top (`FR-IMP-13`–`22`) |
| 5 | Design and copy walked through as each role |
| 6 | The whole suite once, demo data reset, `mvp` released to `main` and the public demo |

Rules for it, all the owner's:

- One branch at a time, as always. Say in a line or two what a branch changes
  and why, then build it; **no approval is waited for between branches**, and
  the ten-file rule of §9 is suspended for this build.
- Stop and ask only where two materially different product outcomes are
  possible. Small implementation choices are decided and noted.
- **Redesign is allowed** where a screen fights the new structure, never for
  decoration. `FRONTEND.md` §0.2 still bans what it bans.
- **Not now:** real bKash, Nagad or SMS; merchant onboarding; a production
  monitoring stack; iOS publishing; branded app-store automation; ambulance;
  blood; telemedicine; prescriptions and dispensing; a direct HMS or FHIR
  connection; national integrations.
- **Reschedule** is built only if it is cheap and clean; otherwise it leaves
  the pitch script.
- The only AI is the import mapping. It proposes; a person confirms; the
  existing checker decides what is written. No patient row goes to a model
  (`FR-IMP-17`).

## 5. Definition of Done (every branch)

A step is not done until all of these are true:

1. Implements the requirement IDs named in the step, and nothing outside them.
2. `pnpm typecheck && pnpm lint && pnpm test` all pass.
3. **Demo data updated in the same branch.** If the feature has a screen, the seed produces realistic Bangladeshi data for it (`FR-DEM-*`). No feature ships with an empty screen.
4. **Tests written in the same branch**, not deferred: unit for domain logic, API tests for every new endpoint's auth matrix, Playwright for any user-visible flow.
5. All four UI states exist for every new screen: loading, empty, error, offline (`GR-03`).
6. Both `bn` and `en` message keys exist; no hard-coded strings.
7. No banned pattern from `FRONTEND.md` §0.2 appears.
8. Every live figure renders `<FreshnessLine>`.
9. `docs/` updated if behaviour changed.
10. Commit messages cite requirement IDs.

---

## 6. Testing rules

```
pnpm test            # unit + integration
pnpm test:e2e        # Playwright, against the dev servers
pnpm test:e2e:built  # Playwright, against the console as built (e2e/built/)
pnpm test:e2e:prod   # Playwright, against the production configuration (e2e/production/)
pnpm db:reset        # rebuild demo data
```

**Two levels of gate (owner, 2026-10-05).** Tests are still written with the
feature. What changed is how much is *run* before a branch merges:

| Level | For a branch that touches | Run before merging |
|---|---|---|
| **Focused** | Screens, navigation, design, copy, search and discovery UI, onboarding and mapping UI | `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, the unit and component tests for what changed, and the browser spec(s) for the flow touched |
| **Strict** | The queue engine, migrations, tenant isolation, auth and permissions, patient records, import writes, realtime and sync, anything destructive | The above, plus the API and schema suites for the area and the browser specs that stand on it. The canary whenever the queue, the live serial screen or realtime is touched |

Before a release to `main`: `pnpm verify`, `pnpm build` and every browser
suite, once, and nothing red goes out (§3.1). Before real patients: the whole
production validation again (`pnpm test:e2e:prod`, the dry run in `DEPLOY.md`
S8). A branch's update says which level it ran.

- **Tests are written with the feature, in the same branch. Never "later".**
- Every test runs against seeded demo data, never against hand-written fixtures scattered in test files. If a test needs new data, add it to the seeds.
- Required Playwright specs:
  - `e2e/two-device-queue.spec.ts` — console taps next in one context, patient page in another updates in under 2 s. **This is the product's canary; it must never be skipped or marked flaky.**
  - `e2e/guest-booking.spec.ts` — book with no account, open the SMS tracking link, see the live serial.
  - `e2e/no-show-recovery.spec.ts` — no-show → slot offered → standby accepts → admin recovery figure changes.
  - `e2e/emergency-burn.spec.ts` — capability + freshness ranking, "I'm on my way" reaches the ER console.
  - `e2e/offline-console.spec.ts` — go offline, run five queue actions, reconnect, verify order and idempotency.
- A flaky test is a bug. Fix it or delete the flakiness; never retry-loop around it.

---

## 7. Code rules

- TypeScript strict. No `any`. No `@ts-ignore` without a comment naming the reason.
- Layering (lint-enforced): `routes → controllers → services → repositories → db`. SQL only in repositories. Events and notifications only in services.
- The queue reducer exists once, in `shared/domain`. Never reimplement queue logic in SQL, in a route, or in the client.
- No hex colours, font names, or spacing values in components — tokens only (`FRONTEND.md` §1–3).
- No string literals in JSX — `t()` only.
- Money is integer poisha. Timestamps are UTC in the database. Phones are normalised `+8801…`.
- Every write endpoint accepts an idempotency key. Every queue event carries a `clientEventId`.
- Never log patient identifiers, OTPs, tokens, or payment references.
- No new dependency without asking me first.

---

## 8. Data and safety rules

- The demo and dev databases contain **no real patient data, ever** (`FR-SEC-08`).
- Never invent clinical content, statistics, or hospital names outside the seed file's declared demo set, and keep demo data visibly labelled as demo.
- Never weaken RLS, auth, or audit logging to make a test pass.
- Never show a live number without its freshness stamp, and never fabricate availability when data is missing — degrade honestly (`PRD.md` §3.2).

---

## 9. How to work with me

- **Start each session** by reading `CLAUDE.md`, then `docs/STATUS.md`, then `git status` and `git log --oneline -10`, then tell me which step you are on before writing code.
- **Update `docs/STATUS.md` at the end of every step.** It carries what a fresh session cannot derive from the code: which environment is for what, the decisions still awaiting my ruling, and the gaps that are deliberate. I switch sessions often; that file is what makes it cheap.
- **Plan before building.** For each step, state the files you will create or change, and wait for my go-ahead if the step touches more than ten files.
- **One step at a time.** Finish, test, merge, report, then ask for the next.
- **Report like this:** what you built, requirement IDs covered, tests added and their result, demo data added, anything you could not do and why.
- **During the V1 pitch build (§4.4), report shorter:** after each merged branch, four things in plain words — what changed, what I can now see or do, which tests were run, what the next branch is. Detail only if I ask. Do not wait for my go-ahead between branches.
- **Ask when the documents are silent.** Do not guess product behaviour. Guessing stack details is fine if `BACKEND.md` already fixed the stack.
- If I ask for something that contradicts a document, say so in one line, then do what I ask and note the doc that needs updating.

---

## 10. Commands

```bash
pnpm install
pnpm dev              # all apps
pnpm dev:api          # api only
pnpm dev:patient      # patient PWA
pnpm dev:console      # staff console
pnpm db:migrate
pnpm db:role          # self-host only: the role the API connects as (DEPLOY.md §S2)
pnpm db:seed
pnpm db:reset         # truncate + reseed demo data
pnpm db:verify        # schema invariants
pnpm staff:create     # a hospital's first administrator; --platform for a deployment's first platform administrator (DEPLOY.md S3)
pnpm mapping:try      # what a model would be sent for a CSV, and its suggestions when one is configured (FR-IMP-17)
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:e2e:built   # the specs that need `next build` (offline reload)
pnpm test:e2e:prod    # the canary and the counter, DEMO_MODE=false, built apps, limited DB role
```

---

## 11. Non-negotiables (repeat of the things most likely to be dropped under pressure)

1. Branch per step, off `mvp`, merged back only when green.
2. **Push only what is green.** The owner gave standing permission to push and merge on 2026-10-03 (§3.1); a force-push still needs asking. Green is measured at the level §6 gives the branch.
3. Tests and demo data in the same branch as the feature.
4. The two-device queue test never gets skipped.
5. Bangla is the default language, set properly (line-height ≥ 1.65, Bengali numerals, no letter-spacing).
6. Nothing in `FRONTEND.md` §0.2 ever appears in the UI.
7. Honest degradation: stale data says it is stale.
8. Requirement IDs in commits.
