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
feat/*        # one step of work. Short-lived. Deleted after merge.
fix/*         # bug fixes off mvp
chore/*       # tooling, config, docs
```

**Never commit directly to `main` or `mvp`.** Never work on more than one `feat/*` branch at a time.

**Never push. Ever, without my explicit permission.**
- No `git push`, no `git push -u`, no `--force`, no pushing a branch "just to back it up".
- No creating remotes, no `gh` CLI, no opening pull requests, no publishing a repo.
- Local commits and local merges are fine and expected — the network is the line.
- When a step is merged into `mvp` and you think it is worth pushing, **ask**: say which branch and why, and wait for me to say yes. "Yes" applies to that one push only, not to future ones.
- If I gave permission for a push earlier in the session, that permission is spent. Ask again.

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
- `mvp` merges into `main` only when I say so.

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

### 4.1 Authentication is deferred (step 4 is not built)

**Do not build OTP flows, staff passwords, argon2id, or account management.**
Authentication will be handled by Supabase Auth when this goes beyond the pitch.
Writing our own now would be code thrown away.

What that means concretely:

- **Skipped:** `POST /auth/otp`, `/auth/verify`, `/auth/refresh`, `/staff/login`,
  `/staff/2fa`, `/guest/start`, `/guest/verify`, `/guest/claim`, the argon2id
  dependency, and any write to `sessions_auth`.
- **Kept, because it already exists and Supabase will not replace it:** the
  middleware from step 3 — `attachPrincipal`, `requireAuth`, `requireRole`,
  `requireHospitalScope`, `guestAuth` — plus `config/jwt.ts`. These *verify* a
  token. When Supabase Auth issues the tokens, verification is a configuration
  change, not a rewrite. Deleting them now would be waste.
- **Kept, because the demo depends on it:** the **guest tracking link**
  (`FR-GST-05`). It is not a login — it is how a patient opens an SMS and sees
  their live serial, and both the pitch script (`PRD.md` §24) and the required
  `e2e/guest-booking.spec.ts` need it. Minting one is a single call to
  `signToken({ kind: 'guest', … })`, which already works. Build it when step 9
  or 10 needs it, not as an auth step.
- **How the demo gets a principal:** under `DEMO_MODE=true`, the console picks a
  hospital and a role without a password, and a booking hands back a signed
  guest link. That is the correct implementation for a pitch version (§1.1), not
  a shortcut to apologise for.

Requirements consequently not implemented in this version: `FR-PAT-01`,
`FR-PAT-04`, `FR-GST-03`, `FR-GST-04`, `FR-GST-09`, `FR-GST-12`, `FR-SEC-05`,
`FR-SEC-06`, and the 2FA half of `FR-SUP-01`. They stay in `PRD.md` because they
are still requirements of the product — they are simply not this version's
scope. Do not delete them from the document; do not build them either.

**The build plan therefore runs 0, 1, 2, 3, 5, 6, 7 …** Step numbering is left
alone so that every requirement ID, branch name and commit message already
written still points at the same thing.

---

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
pnpm test:e2e        # Playwright
pnpm db:reset        # rebuild demo data
```

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
pnpm db:seed
pnpm db:reset         # truncate + reseed demo data
pnpm db:verify        # schema invariants
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
```

---

## 11. Non-negotiables (repeat of the things most likely to be dropped under pressure)

1. Branch per step, off `mvp`, merged back only when green.
2. **No pushing to any remote without my explicit permission, every single time.**
3. Tests and demo data in the same branch as the feature.
4. The two-device queue test never gets skipped.
5. Bangla is the default language, set properly (line-height ≥ 1.65, Bengali numerals, no letter-spacing).
6. Nothing in `FRONTEND.md` §0.2 ever appears in the UI.
7. Honest degradation: stale data says it is stale.
8. Requirement IDs in commits.
