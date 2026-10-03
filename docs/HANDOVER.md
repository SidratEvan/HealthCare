# Technical handover

A critical description of the HealthWealthBD codebase as it actually is, for a
founder who did not write most of it and for whoever works on it next.

- **Written:** 2 October 2026, against `mvp` at `ebfcf14` (the same commit as
  `demo`).
- **Method:** read from the code, not from the plans. The queue domain was
  also driven through a 10-patient session by a script against the real
  `shared/domain` functions (§4.9); the bugs called "confirmed" below were
  reproduced that way or traced line by line.
- **Authority:** none. The five documents in `CLAUDE.md` §2 still govern
  behaviour. Where this file says a document is wrong, it is a proposal to fix
  the document or the code, not a ruling.
- **Since it was written:** the text below is left as it was found, so the
  audit stays readable as an audit. What has been fixed since, by branch
  (`docs/PLATFORM_PLAN.md` §9 has the full list):
  - **Fact 3, §4.3, §4.9, §12 item 3 — fixed** (`fix/delay-on-arrival`). A
    delay declared before the arrival is used up by it; one declared after
    holds the chamber until then, and the no-show grace cannot end before the
    hold does. In the §4.9 session serial 1 is told 17:32 and serial 5 17:50.

---

## Read this first

Seven facts that change what you can promise a hospital, all verified in the
code on the date above:

1. **On a real (non-demo) server, patients cannot book from their phones.**
   With `DEMO_MODE=false` a guest booking must prove the phone with a code
   (`patientAuth.service.ts` `guestPhoneCheckRequired`). The only SMS adapters
   are `log` (prints, withholds the code) and an unconfigured one that fails
   every send (`adapters/sms.ts`). So the code is never delivered, and booking,
   standby and bed requests from the app are impossible. Walk-ins registered at
   the counter get no tracking link at all. **Today a real pilot is a
   staff-side queue tool.** The patient half needs an SMS adapter that does not
   exist yet (pilot step 27).
2. **Reception can pause a chamber and can never resume it.** The console has
   a Pause button and no Resume control anywhere (`ReceptionConsole.tsx`); a
   paused session refuses *call next* (`rules.ts` `canCallNext`). One tap
   freezes a chamber until somebody calls the API by hand.
3. **A delay declared before the doctor arrives is never cleared.** After
   `DOCTOR_ARRIVED` the ETA baseline is still `now + delayMinutes`
   (`eta.ts` `baselineFor`). In the reproduced session, the patient at the
   front was told 18:20 while reception was allowed to mark them absent at
   18:06. The bug can manufacture no-shows.
4. **The console's Undo button does nothing.** It sends the *booking* id as
   `undoneEventId` (`ReceptionConsole.tsx`); the server stores a useless
   `ACTION_UNDONE` and nothing is undone.
5. **Hospital isolation is enforced only by application code.** Row-level
   security is enabled on all 55 tables but **no policy exists** in any
   migration, and the API connects as the tables' owner (as the Postgres
   superuser on the self-hosted stack), which bypasses RLS. Every route must
   remember its own scope check.
6. **Offline mode keeps queued actions in memory only.** All three console
   outboxes use memory stores; the IndexedDB store exists and is never used.
   The console has no service worker, so it cannot even load without a
   network. A reload while offline loses everything queued.
7. **The two-device canary and every other end-to-end test are not in CI,**
   and they run only in demo mode against development servers — never against
   the production configuration that a hospital would get.

None of these is hard to fix (§16 gives the order), but none is fixed today.

---

## 1. System map

### 1.1 The pieces

```
 Patient phone                         Hospital PCs
 ┌────────────────────┐                ┌──────────────────────────────┐
 │ frontend/patient   │                │ frontend/console             │
 │ Next.js PWA :3000  │                │ Next.js SPA :3100            │
 │ Bangla-first       │                │ reception, doctor, ward, ER, │
 │ guest booking,     │                │ lab, pharmacy, admin, gov,   │
 │ live serial, ER,   │                │ settings, import             │
 │ beds, records      │                │ optimistic reducer + outbox  │
 └─────────┬──────────┘                └──────────────┬───────────────┘
           │ HTTPS /api/v1  +  Socket.IO (same origin) │
           └───────────────────┬──────────────────────┘
                               ▼
              ┌─────────────────────────────────────┐
              │ backend/api  (Node 24, Express 5)   │
              │ routes → controllers → services →   │
              │ repositories → Postgres             │
              │ Socket.IO rooms, hourly jobs        │
              │ adapters: sms, push, payments,      │
              │ storage, travel time                │
              └───────────────┬─────────────────────┘
                              │ imports, unchanged
              ┌───────────────▼─────────────────────┐
              │ shared/domain  (pure TypeScript)    │
              │ queue reducer, ETA, rules, replay,  │
              │ beds, emergency ranking, referrals, │
              │ lab, refunds, imports, zod schemas  │
              └─────────────────────────────────────┘
                              │
              ┌───────────────▼─────────────────────┐
              │ PostgreSQL 16 + PostGIS             │
              │ 55 tables, 33 migrations (31 files) │
              └─────────────────────────────────────┘
```

| Concern | What is really there |
|---|---|
| **Patient frontend** | `frontend/patient`, Next.js 16 app router (built with webpack), client-rendered screens, a service worker that caches the shell only (never API answers). Bangla by default, English switch. |
| **Staff console** | `frontend/console`, one Next.js page (`src/app/page.tsx`) that switches between consoles. Staff token in `sessionStorage`. Talks to the API over HTTP and one socket. |
| **Backend/API** | `backend/api`, Express 5, run in production by `tsx src/server.ts` (TypeScript compiled at start, no build step). 146 routes in 24 route files under `/api/v1`, plus `/healthz` and `/readyz`. |
| **Shared domain** | `shared/domain`, no I/O. The API and the console import the same reducer, which is why they agree on the queue. |
| **Database** | PostgreSQL (Supabase for the demo, `postgis/postgis:16-3.4` self-hosted). Kysely with raw `sql` templates. |
| **Realtime** | Socket.IO 4.8 in the API process. Rooms: `session:<id>`, `patient:<id>`, `hospital:<id>:beds|emergency|lab|admin`. In-memory, single process. |
| **Auth** | Own JWTs (HS256, `jose`): staff email + scrypt password + TOTP for admins; patients phone + 6-digit code; guests by signed or random-token links. No Supabase Auth. |
| **Notifications** | Outbox rows in `notifications`, written in the queue transaction, sent after commit. SMS adapter `log` only; push adapter unconfigured only. No retry, no worker. |
| **Payments** | Adapter seam. `mock` (always succeeds, demo), `off` (pay at the hospital), `live` (an adapter that refuses every charge). bKash/Nagad files are notes, not code. |
| **File storage** | `adapters/storage.ts`: `mock` (process memory), `local` (disk volume, self-host), `supabase` (bucket). Signed, expiring URLs served by the API. |
| **Deployment** | Demo: Supabase (Singapore) + Render free tier (API) + Vercel (two apps). Real: `deploy/docker-compose.yml` on one Linux server, Caddy for TLS. |
| **External dependencies** | Runtime: Postgres/PostGIS, Let's Encrypt (via Caddy), Google Fonts at build time. Nothing else is called: no SMS gateway, no payment gateway, no error tracker, no maps API. |

### 1.2 A booking, end to end

Real deployment unless marked *demo*.

1. **Patient app** — `frontend/patient/src/app/book/page.tsx`: specialty →
   hospital → doctor → chamber → name, phone, age, sex, reason.
2. **Phone proof** — the app reads `GET /config`; with `guestPhoneCheck: true`
   it calls `POST /guest/start` (phone + any device proof it holds). A device
   that proved this number before skips the code; otherwise a 6-digit code is
   sent by SMS and `POST /guest/verify` returns a guest access token and a
   90-day device proof. *Demo:* the check is off and the app books in one tap.
   **On a real server today the code never arrives (fact 1).**
3. **`POST /api/v1/bookings`** with an `Idempotency-Key` header —
   `routes/booking.routes.ts` → `validate(createBookingBody)` →
   `controllers/booking.controller.ts` (`assertGuestPhoneProven`) →
   `services/booking.service.ts` `createBooking`:
   - takes the session row lock (`SELECT … FOR UPDATE`, `session.repo`),
   - finds or creates the guest identity and the patient,
   - refuses a second booking for the same patient, doctor and day,
   - checks capacity, issues `serial = max + 1`, inserts the booking,
   - commits.
4. **After commit**, in order: `issueTrackingLink` (32 random bytes; only the
   SHA-256 is stored in `guest_links`; expires at planned end + 24 h);
   `queueService.broadcastRoster` (replays the session and emits
   `queue.updated` so reception sees the new row); the `booking.confirmed`
   message is written and dispatched; the payment intent is recorded
   (`at_hospital` stays pending; `mock` settles; `off` refused online methods
   earlier). The response carries `bookingId`, `serial`, `trackingUrl`.
5. **Live serial screen** — `/s?b=<booking>&t=<token>` →
   `GET /guest/link/:token` → `guest.service.openTrackingLink` hashes the
   token, finds the link, returns the booking view and a **15-minute access
   JWT** (`kind: guest`, `bookingId`).
6. **Socket** — the phone connects with that JWT (`realtime/auth.ts`, verified
   with the access secret), sends `session:subscribe {sessionId, lastSeq}`;
   `realtime/handlers.ts` checks the booking is in that session
   (`canJoinSession`), joins `session:<id>`, and sends either the full state or
   the missed events then the state.
7. **Reception** taps *next* — `frontend/console/src/hooks/useSessionQueue.ts`
   applies `PATIENT_DONE` + `PATIENT_CALLED` to its local copy with the shared
   reducer, puts both in the outbox, and flushes to **`POST /sync/events`**
   (the console uses the sync endpoint for every queue action, online or not).
8. **Server** — `sync.service.pushBatch` → `queue.service.appendBatch`: one
   transaction, session row locked, the whole log replayed, each entry guarded
   by `shared/domain/src/queue/rules.ts`, appended to `queue_events`
   (`clock_timestamp()`, unique `client_event_id`), folded; then `settle`
   writes `queue_state`, `sessions` and every booking's projection, computes
   ETAs, **emits** `queue.updated` (and `patient.called` to the called
   patient's room), writes the called / two-away messages; commit; dispatch
   SMS.
9. **Phone** — `shared/client/src/realtime/session.ts` folds the update by
   `seq` (older ones ignored) and re-renders `<LiveSerialCard>`. The canary
   (`e2e/two-device-queue.spec.ts`) asserts this takes under 2 s.

The doctor's **Sign and next** goes a different way: `POST /visits` →
`clinical.service.saveVisit` → `queueService.callNext`, where the server picks
the next patient under the lock.

---

## 2. Repository map

| Folder | Does | Read first | Core logic | Dangerous to change |
|---|---|---|---|---|
| `shared/domain` | Pure rules for every module; zod schemas used by both sides | `queue/reducer.ts`, `queue/state.ts`, `queue/eta.ts`, `queue/rules.ts` | `queue/*`, `beds/board.ts`, `emergency/{cases,ranking,referrals}.ts`, `lab/orders.ts`, `payments/refund.ts`, `imports/sets.ts` | **`queue/reducer.ts`** — every stored event is re-folded through it on every read; a change alters history. `types/events.ts` — payload shapes are stored as JSON forever. `types/enums.ts` mirrors Postgres enums. |
| `shared/client` | Typed API client, realtime subscriptions, offline outboxes | `realtime/session.ts`, `offline/queue.ts` | `foldUpdate` (seq ordering), outbox flush | `realtime/session.ts` — a fold bug shows patients an old queue |
| `shared/ui`, `shared/i18n` | Design system; messages, Bangla digits, clock words, SMS templates | `i18n/src/templates.ts` | `formatClock`, `numeralsFor` | `templates.ts` — SMS wording and its parameters |
| `backend/api` | HTTP, sockets, services, repositories, adapters, CLI scripts | `services/queue.service.ts`, `controllers/queue.controller.ts`, `middleware/auth.ts`, `env.ts` | `services/*.ts` (queue, booking, bed, emergency, referral, lab, payment, import, staffAuth, patientAuth, consent, clinical) | **`queue.service.ts`** (the only writer of the log), **`middleware/auth.ts`** and every `assert*Scope` (tenancy), `env.ts` (production refusals), `config/jwt.ts` (secrets and audiences), `repositories/queueEvent.repo.ts` |
| `backend/workers` | Nothing: a 5-line stub | — | — | — |
| `frontend/patient` | Patient PWA | `app/book/page.tsx`, `app/s/page.tsx`, `lib/bookings.ts` | booking flow, live serial | `public/sw.js` (cache version is bumped by hand) |
| `frontend/console` | All staff screens | `hooks/useSessionQueue.ts`, `components/ReceptionConsole.tsx`, `app/page.tsx` | optimistic queue, outboxes, picker/sign-in | `useSessionQueue.ts` (what reaches the server and in what order) |
| `frontend/site` | Empty | — | — | — |
| `database` | Migrations, seeds, migrate/verify/reset scripts | `migrations/0005`, `0006`, `scripts/migrate.ts` | constraints and triggers in the migrations | **Any shipped migration** (checksummed; never edit, add a new one). `seeds/*` order (seed 08 must run last). `scripts/demo-refresh.ps1` truncates the remote demo. |
| `e2e` | 26 Playwright specs, 136+ tests | `two-device-queue.spec.ts`, `support/*` | — | `support/globalSetup.ts` (migrates and resets the E2E database) |
| `deploy` | Self-host compose, Caddy, backup, restore | `docker-compose.yml`, `.env.example` | — | `restore.sh` drops the database |
| `docs` | The five documents, STATUS, DEPLOY, this file | `STATUS.md` | — | — |

---

## 3. Database

### 3.1 Tables by domain (55)

- **Identity:** `users` (patient accounts), `guest_identities` (one per phone),
  `patients` (profiles; owned by a user, a guest identity, or — imported — a
  hospital), `staff_users`, `staff_roles`, `sessions_auth` (refresh tokens,
  hashed), `guest_links` (tracking links, hashed), `otp_challenges`,
  `device_tokens` (empty: no push).
- **Facilities:** `hospitals`, `hospital_settings` (queue rules, SMS budget,
  refund policy), `departments`, `doctors`, `doctor_hospitals`,
  `capabilities`, `session_templates` (weekly schedules).
- **Queue:** `sessions`, `bookings`, `queue_events`, `queue_state` (cache),
  `standby_list`, `slot_offers`, `sync_cursors`.
- **Clinical:** `visits`, `consents`, `test_orders`, `reports`,
  `patient_documents` (unused), `medicines`, `prescriptions`,
  `prescription_items` (seeded formulary; prescribing not built), `feedback`.
- **Beds / ER:** `wards`, `beds`, `bed_events`, `admissions`, `bed_requests`,
  `emergency_cases`, `referrals`.
- **Money:** `payments`, `counter_shifts`, `subscriptions`, `invoices` (last
  two empty).
- **Messaging / audit:** `notification_templates`, `notifications`,
  `audit_log`, `analytics_refresh`.
- **Ancillary:** `ambulances`, `ambulance_requests`, `blood_donors`,
  `blood_requests`, `pharmacy_stock`.
- **Import:** `import_batches`, `import_rows`, `external_refs`.

### 3.2 Key relationships

`hospitals` 1–n `departments`, `session_templates`, `sessions`, `wards`,
`staff_users`. `sessions` belongs to one doctor and one department at one
hospital; `bookings` n–1 `sessions` and n–1 `patients`; `queue_events` n–1
`sessions` (and optionally one booking). `visits` 1–1 `bookings`. A patient's
owner is exactly one of `owner_user_id`, `owner_guest_id`, `owner_hospital_id`
(`patients_one_owner`). `payments` points at exactly one subject (booking,
standby place, and others: `payments_one_subject`).

### 3.3 Patient-identifiable data

`patients` (name, date of birth or age, sex, blood group, phone through the
owner), `guest_identities` and `users` (phone), `bookings` (reason, intake
answers), `visits` (diagnosis, advice), `reports` (files) and `test_orders`,
`consents`, `emergency_cases` (phone, age, sex), `bed_requests`, `admissions`,
`standby_list` (contact phone), `notifications` (**phone and message params,
including full tracking links**), `otp_challenges` (phone, IP), `audit_log`
(who read whom), `import_rows` (raw uploaded rows, cleared 30 days after
commit), `external_refs` (the hospital's patient numbers).

### 3.4 Append-only

Enforced by trigger (no UPDATE, DELETE or TRUNCATE): **`queue_events`**
(except setting `undone_by_event_id` once) and **`bed_events`**. Amount
columns of `payments` and the fare on `ambulance_requests` cannot change.
**Everything else, including `audit_log`, is mutable** — `audit_log` has only
an `updated_at` touch trigger.

### 3.5 Row-level security — what it does and does not do

Every table has `ENABLE ROW LEVEL SECURITY`. **No migration contains a single
`CREATE POLICY`, and none uses `FORCE ROW LEVEL SECURITY`.** Consequences:

- Roles other than the owner see nothing. On Supabase this genuinely blocks
  the `anon`/`authenticated` roles from reading tables through Supabase's REST
  API. That is the only protection RLS gives here.
- The API connects as the owner (Supabase: `postgres`; self-host: the
  `POSTGRES_USER`, which the Postgres image makes a **superuser**). Owners and
  superusers bypass RLS. **RLS does nothing for tenant isolation.**
- The one real database-level fence is the government layer:
  `gov.repo.ts` runs `SET LOCAL ROLE gov_reader`, a role that can read six
  aggregate views and nothing else (`0026`). That works because the API is
  privileged enough to switch roles.

**Document disagreement:** `DATABASE.md` plans `0014_rls.sql` with policies,
and STATUS open decision 3 says "0014 still adds the policies". There is no
0014; the policies were never written. The security review's "RLS on all 55
tables" is true and misleading.

### 3.6 Audit logging

`audit_log` actions allowed: `RECORD_VIEW`, `QUEUE_ACTION`,
`SETTINGS_CHANGE`, `EXPORT`, `LOGIN`. Written from seven repositories:
record reads (doctor history, consent redemption), bed panel and pending-list
reads, the ER phone reveal, counter phone lookups, settings changes, imports,
exports, staff and patient sign-in events. **Not written:** queue actions
(`QUEUE_ACTION` is never used; the actor is on each `queue_events` row
instead — step 12 of `BACKEND.md` §4.1 is unbuilt, `middleware/audit.ts` does
not exist). Audit rows can be edited or deleted by the API's database user.

### 3.7 Migrations

`database/migrations/0001…0033` (0014 and 0015 never existed), applied by
`database/scripts/migrate.ts` in filename order, checksummed, forward-only.
`pnpm db:verify` checks schema invariants. A remote database needs
`ALLOW_REMOTE_DB=1`; destructive operations also need
`ALLOW_DESTRUCTIVE_DB=1`; `db:seed`/`db:reset` refuse unless `DEMO_MODE=true`.
On the self-hosted stack the `migrate` container runs on every `up`.

### 3.8 How tenancy is enforced, and how it could leak

A staff JWT carries `hospitalId` and `roles`. Isolation is three habits in
application code:

1. `requireHospitalScope('hospitalId')` on routes whose path names a hospital.
2. `assertSessionScope` / `assertBookingScope` in controllers for routes that
   name a session, booking, bed, case, order (they load the row and compare its
   `hospital_id` with the token's).
3. Repositories that filter by the principal's hospital (the admin dashboard
   ignores any hospital in the request).

**Ways a mistake leaks across hospitals:** a new route that takes an id and
forgets its `assert*Scope`; a repository query that filters by id but not by
hospital; a socket room joined without `canJoinSession`; a new public route
(no `requireAuth`) returning rows. Nothing at the database level would stop
any of these. On a per-hospital self-hosted server the blast radius is that
hospital's own data; on a shared multi-hospital deployment it is everybody's.

### 3.9 Backups and restore

`deploy/backup.sh` runs in its own container: nightly at
`BACKUP_AT_UTC_HOUR` (20 UTC = 02:00 Dhaka), `pg_dump --format=custom` plus a
tarball of the files volume, into `deploy/backups/` **on the same disk**,
keeping `BACKUP_KEEP_DAYS` (14). Not encrypted, not copied anywhere, not
verified; a failure is one line on stderr. `deploy/restore.sh` terminates
connections, drops and recreates the database, `pg_restore`s, and replaces
the files. Proven once, by hand, on 29 September. The `TOTP_ENCRYPTION_KEY`
must match the restored database or every administrator's two-step stops
working. (`DEPLOY.md` says "a backup is useless without the password that
opens it" — the dump has no password; anyone with the file can read it.)

---

## 4. The live queue engine

### 4.1 Event types (19)

`SESSION_OPENED`, `DOCTOR_ARRIVED`, `DELAY_DECLARED`, `SESSION_PAUSED`,
`SESSION_RESUMED`, `PATIENT_CALLED`, `PATIENT_DONE`, `PATIENT_LATE`,
`PATIENT_NO_SHOW`, `PATIENT_REINSERTED`, `PATIENT_ARRIVED` (check-in with a
quoted wait), `WALKIN_ADDED`, `BOOKING_CANCELLED`, `SLOT_OFFERED`,
`SLOT_ACCEPTED`, `SLOT_EXPIRED`, `PRIORITY_REORDERED`, `SESSION_ENDED`,
`ACTION_UNDONE` — `shared/domain/src/types/events.ts`. Each stored row has
`seq` (bigserial, the only ordering), `server_ts` (`clock_timestamp()`),
`client_ts`, `client_event_id` (unique), actor columns, JSON payload.

### 4.2 State model

`state = replay(seed, events)` where the **seed** is the session plan
(planned start/end, capacity, the doctor's default consult minutes) plus the
roster of bookings (id, serial, patient, source, created time — never status).
There is no "booking created" event: a new booking changes the seed, and
`broadcastRoster` re-sends the state. `QueueState` holds the session status,
doctor arrival, cumulative delay, pause bookkeeping, **all** entries in staff
order (settled ones too), the rate, offers, `lastSeq`, the undone ids and
**anomalies** (an event naming an unknown booking is recorded, not thrown).

The reducer is pure (no clock; lint forbids it), total (exhaustive switch)
and idempotent (an event with `seq <= lastSeq` is skipped).

### 4.3 ETA (`eta.ts`)

- Baseline: before arrival, `max(plannedStart + delay, now)`; after arrival,
  **`now + delay`** (this is the bug in fact 3 — the delay is never consumed).
- Walk the active queue: the patient in the chamber costs
  `max(0, rate − time already spent)`; each waiting patient is `cursor`, then
  `cursor += rate`.
- Band: `ceil(sqrt(patientsAhead) × spread)`, clamped to 5–45 minutes; 45 when
  confidence is `unknown` (doctor not arrived, paused, ended).
- `movedEarlier` is computed but nothing acts on it (`FR-QUE-15` is not
  enforced: an ETA can move earlier with no notification).

### 4.4 Doctor pace (`rate.ts`)

Starts at the doctor's default. Each `PATIENT_DONE` folds the measured
seconds, clamped to 30 s–60 min, with weight `max(0.3, 1/n)` — a plain mean for
the first three, then an exponentially weighted average. Spread is the standard
deviation of the last 12, floored at 15% of the rate (40% before two samples).
`consultSeconds` is measured from `calledAt` by the server (`measuredConsultSeconds`)
online; the console computes it for offline batches and the server clamps it.

### 4.5 Late, no-show, reinsert, check-in

- **Late** (`PATIENT_LATE`): moved to sit after `k` more active patients,
  counted from where they stand; `k` is the facility's `lateReinsertAfter`
  (default 3), overwritten server-side whatever the console sent.
- **No-show**: allowed only for the patient at the front with the chamber
  empty, after `max(noShowGraceMinutes, noShowGracePatients × rate)` from the
  latest departure (done, no-show, or doctor arrival). Default
  `max(15, 2 × rate)`.
- **Reinstate** (`PATIENT_REINSERTED`): a no-show or late patient back to
  `waiting` at a chosen position.
- **Check-in** (`PATIENT_ARRIVED`): `booked`/`late` → `waiting`, keeps its
  place, records the server time and the quoted minutes (0–480). First
  arrival wins.
- *Call next* takes the first waiting patient who is not late, else the first
  late one. Checked-in or not makes no difference to who is called.

### 4.6 Standby

`POST /sessions/:id/offer-slot` (reception's card) → `offerFreedSlot`: only a
`no_show` or `cancelled` booking frees a chair; one outstanding offer per
chair; the next person is claimed with `FOR UPDATE SKIP LOCKED`; a 10-minute
window. A prepaid person is seated in the same transaction (`SLOT_ACCEPTED`),
their payment moved onto the new booking. Otherwise they answer from their
status link (or reception records a yes). A cancelled serial still ahead of
the chamber is reissued; otherwise the new booking gets `max + 1`. **Offers
expire only when someone reads the session** (`expireLapsedOffers` on the
reception read path) — no timer; acceptance is refused by the clock anyway.

### 4.7 Undo

Server route `POST /events/:id/undo`: same session, within **10 seconds**,
only by the original actor; appends `ACTION_UNDONE`, marks the original, and
replays the whole log so the pair nets out. **The console never calls it** —
its toast sends `ACTION_UNDONE` through `/sync/events` with a booking id
(fact 4), which bypasses the window and actor checks and undoes nothing.

### 4.8 Concurrency, idempotency, sockets, failure

- **Two receptionists press Call Next at once.** Through `/sync/events`
  (what the console uses): both batches name the same booking; the first takes
  the row lock and applies; the second then fails the guards
  (`BOOKING_SETTLED` for the done, `PATIENT_IN_CHAMBER` for the call) and gets
  `conflicts`; its console rolls those rows back. Through `POST
  /sessions/:id/next` the server decides the patient inside the lock, so the
  second call simply calls the next person. `queueConflict.test.ts` covers it.
- **Idempotency.** `client_event_id` is unique; `findReplay` answers a repeat
  with the stored result. A *concurrent* duplicate passes the pre-check, then
  hits the unique index and rolls back with a 500; the client's retry then gets
  the stored result. `callNext` derives two keys from one (`…d…`, `…c…`).
- **Every write replays the whole session log** inside the lock, and every
  read replays it (twice when a socket subscribes: `getState` then
  `getEtas`). The `queue_state` row is written but never used to build state.
  Fine for 100–300 events a session; it is O(events) per action.
- **Broadcast happens inside the transaction.** `settle` emits before commit.
  If anything after the emit throws (writing the messages, seating a prepaid
  standby patient's SMS), the transaction rolls back but every screen has
  already been told. Rare, but it is a real way to show a state that never
  happened.
- **Browser disconnects.** Socket.IO reconnects (ping 25 s, timeout 60 s,
  polling fallback); on resubscribe with `lastSeq` the server replays up to 500
  missed events then sends the state. The console keeps queuing taps in its
  memory outbox and retries with backoff (1 s → 30 s).
- **Server restarts.** All state is rebuilt from `queue_events` on the next
  read; nothing is lost that was committed. Sockets drop (SIGTERM closes them
  first) and reconnect. In-memory things are lost: rate-limit windows, the
  socket session map, the mock payment and mock storage contents (demo), and
  the log-SMS adapter's array. Hourly jobs restart on boot.
- **Reconstructed from events:** queue order, every status, called/done/arrival
  times, the rate, delay, pause, offers. **Stored directly:** the booking roster
  itself, standby rows, offer rows (claimed/accepted/declined), payments, and
  the projections (`queue_state`, `sessions.status`, `bookings.status` etc.),
  which are caches rewritten on every event.

### 4.9 A worked example — 10 patients (real output of the domain code)

A chamber planned 17:00–20:00 Dhaka, 10 booked, default 8 min per patient.
Times are Dhaka; `@` is the ETA shown to that patient.

| When | Action | What the engine says |
|---|---|---|
| 16:50 | nothing yet | #1 @17:00, #2 @17:08 … #10 @18:12, band ±45 ("unknown": doctor not here) |
| 16:55 | reception declares a 30-min delay (traffic) | everything +30: #1 @17:30 … #10 @18:42 |
| 17:32 | doctor arrives | **#1 @18:02** — the doctor is in the room and the chamber is empty, but the 30 minutes are still added (fact 3). Band narrows to ±5. |
| 17:32 | #3 checks in, quoted 25 min; next → #1 called | #3 becomes `waiting`, still third |
| 17:38 | done #1 (6 min); #2 called | rate 8 → 6 min (first sample replaces the default) |
| 17:38 | #4 phones: 20 min late | #4 moved behind #5, #6, #7 (k = 3) |
| 17:43 | done #2 (5 min); next → #3 | rate 5.5 min |
| 17:50 | done #3 (7 min) | chamber empty, #5 is at the front; **#5's phone says 18:20** |
| 17:55 | try to mark #5 absent | refused: "grace still running, 10 of 15 minutes left" |
| 18:06 | mark #5 absent | **allowed** — 14 minutes before the time #5 was told |
| 18:06 | pause (prayer) | `canCallNext` → `SESSION_NOT_RUNNING` — and the console has no Resume (fact 2) |
| — | console-style Undo of the no-show | nothing changes (fact 4); the same undo with the real event id restores #5 to `booked` |

Without the delay bug the same session is sound: the ordering, the late
reinsertion, the grace window and the undo-by-replay all behaved as specified,
with no anomalies.

### 4.10 Known failure modes

Fact 2, 3 and 4 above; the sync path accepting all 19 types unguarded
(§12); broadcast before commit; offers lapsing only on read; a forgotten
*done* is clamped to an hour (the rate is protected, the record is not
accurate); a booking created between a console's seed and an event yields an
`UNKNOWN_BOOKING` anomaly until reload; `minutesLate` from the console is
always 0.

---

## 5. Authentication and permissions

| Path | How it works | Lifetime |
|---|---|---|
| **Guest booking** | Real: phone code once per device → guest access JWT (no booking) + device proof bound to a hash of the user agent. Demo: no code. | access 15 min; device proof 90 days |
| **Patient phone OTP** | `POST /auth/otp`: 6 digits, keyed hash stored, latest only, 5 per hour per number, 5 wrong → number locked 15 min. `POST /auth/verify` → access + rotating refresh bound to the browser; reuse revokes all. Claiming guest/imported records by the same number in one step. | code 5 min; access 15 min; refresh 30 days |
| **Tracking link** | Random 32 bytes in the SMS/screen URL; SHA-256 stored in `guest_links`; exchanged at `GET /guest/link/:token` for a booking-scoped access JWT. | planned end + 24 h |
| **Other links** | Standby, bed request, ER case, consent offer: JWTs on the guest-link secret, each with its own audience. | 30 days / 30 / 24 h / 3 min |
| **Staff login** | Email + scrypt password (N 2^17); 5 failures → 15 min lock; one message for every wrong combination; hospital code asked only when the password opens two facilities. | access 15 min |
| **Refresh** | Opaque, hashed in `sessions_auth`, rotates on use; a reused token revokes every session of that account. | 30 days |
| **Admin TOTP** | Required for `hospital_admin`/`platform_admin`; secret sealed AES-256-GCM under `TOTP_ENCRYPTION_KEY`; each step once; 10 recovery codes (HMAC); wrong codes count toward the password lock. | challenge 5 min |
| **Password reset** | No self-service. An administrator issues a temporary password on `S-B-11` (forces change); the first admin comes from `pnpm staff:create`; 2FA reset from `S-B-11` or `pnpm staff:reset-2fa`. | — |
| **Demo** | `DEMO_MODE=true`: password-less role picker (`POST /demo/token`, 12-hour tokens); refused when off; production refuses to boot with it on. | 12 h |

**Role checks:** `requireRole(...)` on routes, plus service-level checks for
the sensitive ones (only `doctor` writes a visit; only `hospital_admin` runs
settings and imports). National roles become a separate `national` principal
that every hospital guard refuses.

**Doctor access:** a doctor-role account can open a patient's history if the
patient has **any booking ever at the doctor's hospital** (even cancelled, even
one in the future) or a live consent. What it then sees is **every signed visit
from every hospital** (`clinical.repo.findVisits` has no hospital filter). No
column links a login to a `doctors` row, so "only my own patients" is not
enforceable.

**Weaknesses that still exist (most serious first):**

1. No patient-facing auth works on a real server without an SMS adapter
   (fact 1).
2. Tenancy in application code only; RLS without policies; superuser DB role
   on self-host (§3.5).
3. `/sync/events` accepts every event type from any console role, including
   unguarded `ACTION_UNDONE` (any event, any age, any actor), `SLOT_*`,
   `BOOKING_CANCELLED` (no refund logic) and `SESSION_ENDED` (no refund
   eligibility raised on this path).
4. Cross-hospital visit history readable by any doctor at a hospital the
   patient ever booked with, without consent.
5. Sockets are authenticated at the handshake only: logging out, deactivation
   or token expiry does not disconnect a socket already in a room.
6. A deactivated staff member's access token keeps working for up to 15
   minutes (stateless JWT).
7. Tracking links stored in plaintext in `notifications.params` and printed
   by the `log` SMS provider (bypassing the logger's redaction), so database
   readers, backups and container logs hold working links until they expire.
8. No abuse limits on `POST /bookings` (`FR-GST-14` unbuilt): in demo mode a
   script can fill every chamber; in production the limit is the OTP rate.
9. Every patient in a chamber receives the whole queue state over the socket,
   including every other booking's and patient's id (no names).
10. The device proof is stateless: it cannot be revoked one by one.
11. No security headers (HSTS, CSP, frame options) from Caddy or the apps.
12. Staff refresh tokens in `sessionStorage`, patient refresh in
    `localStorage`: any XSS in either app steals a session.

---

## 6. Patient records and consent

- **Who creates records:** doctors (`POST /visits`: diagnosis, Bangla advice,
  follow-up, optional disease tag; a signed visit is final); labs (uploading a
  report delivers it to the patient and the ordering doctor in one
  transaction); imports (set D is not built, so no old records yet).
- **Who sees them:** the patient's account (profiles they own); a guest
  through a tracking link (that one booking's visit and reports, until the link
  expires a day after the chamber); doctors as in §5; no other staff role; the
  national layer never.
- **Consent:** the patient's app mints a 3-minute code (`BTN-A12-QR`; a code
  to paste, not a QR); a doctor redeems it (`POST /consents/qr`), writing a
  `consents` row and an audit row together; the grant is **hospital-wide**
  (not per doctor) and lasts **24 hours** (hard-coded). Patients can list
  grants, see the access log and revoke (a timestamp). A guest can offer
  consent only under `DEMO_MODE`.
- **Imported vs claimed patients:** an imported patient is owned by the
  hospital (`owner_hospital_id`) and visible only to that hospital's staff;
  when somebody verifies the same phone number, `S-A-20` offers the record and
  one tap moves ownership to their account.
- **Audit:** every successful history read writes `RECORD_VIEW` after the
  read; a refusal writes nothing.
- **Phone number changes:** there is no flow. Records follow the patient row;
  the phone lives on the owning user or guest identity. A patient with a new
  number starts empty; claiming needs a code sent to the old number. Staff
  cannot re-point a patient to a new number from any screen.
- **Gaps that matter in a hospital:** no per-doctor scoping; cross-hospital
  history without consent; consent always 24 h; no record correction or
  addendum after signing (a signed visit cannot be amended at all); no
  "break-glass" emergency access; no export or deletion request flow
  (`FR-SEC-09`); an unconscious ER patient cannot be admitted without a phone
  number.

---

## 7. Offline behaviour

| Screen | Offline? | What is queued | Where |
|---|---|---|---|
| Reception (`useSessionQueue`) | While the tab stays open | every queue action except walk-in, standby offer | **memory** (`createMemoryStore`) |
| Ward board (`useBedBoard`) | While the tab stays open | bed actions, admits | **memory** (`createMemoryBedStore`) |
| ER console (`useEmergencyConsole`) | While the tab stays open | case actions, referral answers | **memory** |
| Doctor, lab, pharmacy, admin, settings, import | No (online-first) | nothing | — |
| Patient app | Shell loads from cache; last screen shows its age | nothing (cancel/late need a connection) | — |

- **Lost on refresh:** everything queued, and the page itself — the console has
  no service worker, so with no network a reload is the browser's error page.
  The comment in `useSessionQueue.ts` saying "the Dexie store is swapped in by
  the app shell" is false; `createDexieStore` has no caller.
- **On reconnect:** the outbox flushes all of a session's entries in one
  `POST /sync/events`; the server replays them in client-timestamp order under
  one lock; accepted ones are removed; guard failures come back as conflicts
  and the rows roll back on screen. Arrival and call times are the **sync**
  time (the server stamps them), so waits measured across an offline period
  are wrong.
- **Conflicts:** first writer wins under the session lock; the loser's action
  is dropped with a reason. A batch that fails for a non-guard reason (a
  constraint error) is retried forever as if offline and blocks every later
  action for that session (`stuck` after 8 attempts, but never cleared).
- **Access token:** 15 minutes. The console refreshes in the background; a
  long outage needs the refresh token to still be valid (30 days) — fine.
- **Safe enough for a hospital?** Not as built. It survives a few seconds or
  minutes of lost signal with the tab open. It does not survive a reload, a
  crashed tab, a laptop going to sleep and the browser discarding the tab, or a
  power cut. **Must fix before pilot:** wire `createDexieStore` (and the bed/ER
  equivalents), add a service worker to the console, make a poison event not
  block the outbox, and tell staff exactly what "offline" covers.

---

## 8. Emergency, beds, lab, pharmacy

| | Emergency | Beds | Lab | Pharmacy |
|---|---|---|---|---|
| **Workflow** | Public search → ranked ERs → "I'm on my way" (anonymous, 10 per IP per 10 min) → ER console rings → prepare/accept/decline → family's status page | Ward board tiles; admit/transfer/discharge → cleaning → free; requests held with expiry; ER hand-offs | Doctor ticks tests → bench queue → collected → processing → upload = delivered | Counter marks in/out of stock → public medicine search |
| **Source of truth** | `emergency_cases`, `capabilities`, bed tallies (`v_public_hospital_capacity`) | `beds` + append-only `bed_events` | `test_orders`, `reports`, storage files | `pharmacy_stock` |
| **Realtime** | ER console: socket (`hospital:<id>:emergency`); family's page **polls every 5 s** | Board: socket; public bed search **polls every 30 s** | Bench: socket (`:lab`); patient: on next open | none (read on search) |
| **Freshness** | Capability and bed figures stale after `staleThresholdMinutes` (10); stale ranks below fresh within the capability tier | A kind's age = its newest bed event; a quiet ward looks stale | Turnaround from order to ready | "In stock" becomes "unknown" after 12 h; "out" stands |
| **Failure modes** | Static travel time (12/18/28 km/h by hour, ×1.4 straight line); 50 km radius; prank alerts; only hospitals on the **same deployment** are searchable | Lapsed holds swept on read only; offline outbox in memory; a hospital that stops tapping goes stale | Report > storage limit; `mock` storage loses files on restart (demo only) | Lapses quietly; nobody reminded to update |
| **Demo-grade** | The whole public network (needs many hospitals on one server) | public capacity network | patient self-booking of tests (not built) | public search across pharmacies |
| **Pilot-grade** | ER console inside one hospital | ward board inside one hospital | bench + report delivery | stock flags |
| **Manual staff updates** | capabilities, case states | every bed state | every order step | every stock flag |

**Architectural tension, not a bug:** a self-hosted server per hospital (the
Bangladesh-data decision) makes each hospital an island. Emergency search
across hospitals, referrals between ERs, the national dashboard and a patient's
wallet across hospitals all assume one shared deployment. With Marks on its own
server, those features show only Marks.

---

## 9. Payments and notifications

### 9.1 Payments

- **Adapters:** `mock` (always succeeds, keeps an in-memory key map; refused
  in production), `off` (online methods refused before anything is written;
  pay at the hospital), `live` → `UnconfiguredPaymentProvider` (refuses every
  charge). `adapters/payments/bkash.ts` and `nagad.ts` contain the call
  sequence as comments; no HTTP calls exist.
- **Idempotency:** unique `payments.idempotency_key`, an advisory lock per key,
  and the key passed to the provider; amounts always from the server
  (`fee_poisha` copied onto the booking); amount columns locked by trigger.
- **Refunds:** the amount comes from `shared/domain/src/payments/refund.ts` and
  the hospital's policy; doctor absence (session ended with no
  `DOCTOR_ARRIVED`) or an unfinished session marks every paid, unseen patient
  eligible — **eligible, not paid**: nothing sweeps them; an administrator
  calls the refund endpoint. Only raised on the `POST /sessions/:id/end` path,
  not on the sync path.
- **Real bKash/Nagad would need:** merchant accounts and credentials;
  redirect/callback (webhook) URLs reachable from the internet; implementing
  create → execute → query for bKash and the Nagad equivalent; webhook
  signature checks (the mock uses `JWT_ACCESS_SECRET` as its HMAC key — must
  not survive); reconciliation against provider statements; a manual refund
  path for Nagad (no refund API, per the notes); handling of "paid at the
  provider but our request timed out" (query by our payment id); sandbox
  testing.
- **What could go wrong:** a booking whose online payment fails still holds
  its serial (by design: logged and swallowed); timeouts leaving a payment
  `pending` forever with no reconciliation job; settlement dated by session,
  not clearance.

### 9.2 Notifications

- **Outbox:** `notifications` rows written inside the same transaction as the
  event (so a rolled-back event sends nothing); `dispatch` runs after commit,
  **inside the HTTP request** (the response waits for every send).
- **Retry:** none. A failed send is `failed` with a reason and stays that way.
  No worker exists (`backend/workers` is a stub; `pg-boss` is not installed).
- **SMS adapter:** `log` prints recipient and body with `console.log`
  (OTP bodies withheld) and keeps every message in an array that is never
  cleared; any other value fails every send. `SMS_PROVIDER` accepts only
  `local` and `log`.
- **Push:** recorded as skipped (`no_device_token`) for everybody; no VAPID,
  no subscription flow.
- **Quiet hours:** 22:00–07:00 Dhaka, overridden by `queue`, `booking`,
  `session`, `emergency`, `bed` messages — i.e. by everything the product
  currently sends.
- **Failure handling:** never throws into the request; marks the row; logs.
  Monthly SMS budget per hospital suppresses SMS beyond it (emergencies
  exempt); cost per segment is a placeholder 35 poisha.
- **Before real patients use it:** an aggregator adapter (HTTP call, sender
  ID, delivery reports via `/webhooks/sms-dlr`, which is not built); a retry
  worker; moving dispatch out of the request path; stop printing bodies and
  storing full links; the leave-home and two-away timing (two-away is sent;
  leave-home is not); push or accept SMS-only.

---

## 10. Deployment

### 10.1 Production architecture for one hospital (as built)

| Item | Value |
|---|---|
| **Server** | One Linux machine with Docker Engine + compose. **Not measured yet.** `DEPLOY.md` says 4 cores / 8 GB / 100 GB "comfortable". Estimate: it would run on 2 vCPU / 4 GB, but the image builds (two Next.js builds) need ~3 GB of RAM on their own, so **4 vCPU / 8 GB RAM / 100 GB SSD** is the honest minimum while builds happen on the server. Add a UPS. |
| **Services** | `db` (postgis 16), `migrate` (one-shot), `api` (:4000), `console` (:3100), `patient` (:3000), `web` (Caddy :80/:443), `backup` |
| **Ports** | Only 80 and 443 are published; 4000/3000/3100/5432 stay on the compose network |
| **HTTPS** | Caddy obtains and renews Let's Encrypt certificates for three names; needs public DNS and port 80 reachable. On an intranet with no public DNS there is no certificate (http only, or bring your own). |
| **Secrets** (`deploy/.env`) | `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `GUEST_LINK_SECRET`, `TOTP_ENCRYPTION_KEY`; later SMS key and sender. Keep a copy off the machine. |
| **Database** | Named volume `db-data`; the API connects as the superuser |
| **Files** | Named volume `files` (`STORAGE_PROVIDER=local`) |
| **Backups / restore** | §3.9 — on the same disk until somebody copies them off |
| **Updates** | `git pull` + `up -d --build` on the server: 10–15 min build, then containers are recreated — **a few minutes of downtime**, sockets drop and reconnect. Take a backup first (migrations are forward-only). |
| **Migrations** | Run by the `migrate` container on every `up`; the API waits for it |
| **Monitoring** | None. The API image has a Docker `HEALTHCHECK` on `/healthz`; nothing alerts anybody. |
| **Logs** | `docker compose logs`; pino JSON for the API; the Docker default json-file driver has **no rotation** configured, so logs grow until the disk fills |
| **Restart** | `restart: unless-stopped` on every long-running service; `uncaughtException` triggers a graceful exit and Docker restarts it |
| **Power failure** | Postgres recovers from its WAL on boot; containers come back with Docker; committed data survives; console outboxes (memory) are lost; nightly backup only — up to 24 h at risk if the disk dies |
| **Internet outage** | If the server is in the hospital: staff on the LAN keep working only if the console can reach the server by its names (Caddy's certificates and DNS must resolve locally); patients outside cannot reach it at all. If the server is in a data centre: the hospital's consoles go "offline" (memory outbox) and cannot reload. |

Also true: containers run as root; each image carries the whole monorepo with
development dependencies; the API compiles TypeScript at start (`tsx`).

### 10.2 "Marks wants to go live next Monday"

What is honest: **a supervised, staff-side pilot of the queue in one to three
chambers is reachable; patient-facing features are not.** What you would
personally have to make happen:

1. **Fix before anything:** Resume button, Undo, the delay bug, Dexie outbox
   wiring (§16 — about two to three days of work with tests).
2. **Decide the patient side:** either (a) no patient app at the pilot
   (counter registration and walk-ins only; set `GUEST_BOOKING_OTP=false`
   *and* add it to the compose file, which does not pass it through today, if
   you want app bookings without codes — a fraud risk you must accept in
   writing), or (b) an SMS aggregator account, a sender ID approved for it
   (the approval can take longer than a week; check), and an adapter to write
   (a day or two once there is an API to call).
3. **Server:** Marks' server room or a Bangladeshi data centre; Ubuntu 24.04,
   Docker; three DNS names; ports 80/443; a UPS; a second machine or disk for
   backups.
4. **Secrets:** generate the five values; store them off the machine (a
   password manager the two founders share). Losing `TOTP_ENCRYPTION_KEY`
   means resetting every admin's two-step; losing `POSTGRES_PASSWORD` with the
   volume intact is recoverable, losing the volume without backups is not.
5. **Bring it up:** `up -d --build`; `staff:create` for Marks' first admin;
   their admin sets up two-step.
6. **Data:** set up departments, doctors, schedules, wards in `S-B-11`, or get
   the CSV exports (column headers first) and run sets A–C through `S-B-14`;
   `pnpm doctor:verify` for every doctor's BMDC number; the ward confirms every
   bed on the day.
7. **Accounts:** one per staff member from `S-B-11`; temporary passwords handed
   over in person.
8. **Training:** an hour per counter: next, done, late, absent, check-in, and
   **never press Pause** until Resume exists.
9. **Operations:** an off-machine backup copy (a cron `rsync` to the second
   machine) and a restore rehearsal; log rotation; an uptime check that texts
   you; a named person at Marks IT; your phone on for the first week.
10. **Paper:** a written agreement covering data ownership and processing
    (the handbook already says the hospital owns the data); no real patient
    data before it (`FR-SEC-08`).
11. **Verify on the real build:** run the canary and the reception specs
    against the production configuration, not demo mode, before the first
    patient.

---

## 11. Tests

Last full count: about 4,577 unit/integration tests and 136+ Playwright tests
in 26 specs. Numbers matter less than what they prove.

- **Unit (`shared/*`, 39 files):** the reducer, ETA, rate, rules and replay
  (including replay-determinism properties over generated logs and invariant
  checks after every event), bed/ER/referral/lab state machines, ranking,
  refunds, import parsing, Bangla formatting, design-token contrast. **They
  prove the rules do what the code says.** They encode the rules as written,
  so they pass with the delay bug in place (no test declares a delay and then
  an arrival).
- **API (`backend/api`, 34 files) — real Postgres, seeded demo data:** every
  route's auth matrix, the queue chains through HTTP, the call-next race
  (`queueConflict.test.ts`), idempotent payments (five concurrent identical
  requests), webhooks, imports, sign-in, two-step, consent, CORS verbs, the
  government role's reach. Realtime is mostly asserted against a recording
  emitter; one test binds a real socket. SMS, payment and storage use the
  log/mock adapters. **These are the most valuable tests in the repository.**
- **Schema (`database/tests`, 9 files):** migrations build from nothing,
  constraints, triggers, seed counts.
- **E2E (26 specs):** two browsers on dev servers with `DEMO_MODE=true`:
  booking, the 2-second canary, offline console (tab kept open), emergency,
  referrals, lab, ward, dashboard, sign-in and two-step, import, language.
- **Not tested at all:** the console's Pause/Resume and Undo buttons; reload
  during offline; the production configuration end to end (OTP on, log SMS,
  `NODE_ENV=production`, production Next builds); backup and restore
  (manual, once); load and memory over days; real phones and real Bangla
  rendering on cheap Android devices; any real SMS or payment provider (none
  exists); multiple API instances; security headers; RLS policies (none to
  test); frontend logic outside E2E (no frontend unit test project).
- **Mocks that can hide production failures:** the recording emitter (a
  broadcast-before-commit cannot fail a test); the log SMS adapter always
  "succeeds" (so the undeliverable OTP never shows up); E2E runs demo mode,
  where the OTP is off (so "patients cannot book on a real server" is
  invisible to the whole suite); `self-host.spec.ts` stubs `/config`.
- **Most important:** `two-device-queue.spec.ts`, `queue.routes.test.ts`,
  `queueConflict.test.ts`, `offline-console.spec.ts`, the reducer/replay
  property tests, the auth matrix tests.
- **False confidence?** Yes, in specific places: the suite is green while
  facts 1–4 and 6 are true. And **CI runs typecheck, lint, format, migrate,
  verify and the unit/API/schema tests, but no E2E and no `pnpm build`** — the
  canary that "must never be skipped" is enforced only by people running it.

---

## 12. Technical debt and fragility, ranked

**CRITICAL**

1. No SMS adapter: OTP, app booking, sign-in and tracking links do not work on
   a real server; `DEPLOY.md` S2/S6 imply they do (fact 1).
2. Pause without Resume in the console (fact 2).
3. Pre-arrival delay never consumed after arrival; ETAs late by the delay for
   the rest of the session; can cause no-shows (fact 3).

**HIGH**

4. Console Undo sends a booking id; silent no-op that writes junk events
   into the append-only log (fact 4).
5. `/sync/events` accepts all 19 types from any console role; unguarded
   `ACTION_UNDONE`, `SLOT_*`, `BOOKING_CANCELLED`, `SESSION_ENDED` bypass the
   service rules (window/actor, offers table, refunds).
6. Offline outboxes in memory; no console service worker; reload loses work;
   a poison entry blocks a session's outbox forever (fact 6).
7. Tenant isolation in application code only; RLS without policies; API as
   database superuser on self-host (fact 5).
8. Doctors read a patient's visits from every hospital without consent once
   the patient has any booking at their hospital; no per-doctor scope.
9. E2E (the canary included) not in CI, never run against production
   configuration or builds.
10. Backups on the same disk, unencrypted, unverified, unmonitored.
11. `log` SMS adapter prints phone numbers and full bodies (tracking links) to
    stdout in production, bypassing pino redaction, and grows an in-memory
    array forever.

**MEDIUM**

12. Broadcast inside the transaction (before commit).
13. Full tracking links stored in `notifications.params`; no purge job for the
    documented 90-day retention.
14. No worker: offers lapse only on read, failed SMS never retried, refunds
    eligible but unpaid, leave-home message never sent.
15. Notification dispatch awaited inside the request; a slow SMS gateway will
    slow every queue tap.
16. `audit_log` mutable; queue actions not audited there; `QUEUE_ACTION`
    unused.
17. Sockets not revoked on logout/deactivation/expiry; 15-minute stateless
    access after deactivation.
18. One process only: in-memory Socket.IO rooms and rate limits; no way to run
    two API instances.
19. Booking not idempotent: a lost response then a retry gets
    `BOOKING_DUPLICATE` and the patient never sees their tracking link.
20. No booking abuse limits (`FR-GST-14`).
21. Containers as root; fat images with dev dependencies; `tsx` at runtime;
    builds on the hospital's server.
22. No log rotation, no monitoring or alerting, no security headers.
23. Each hospital on its own server breaks the network features (§8).
24. `FR-QUE-15` (no earlier ETA without notice) computed but not enforced.
25. Arrival/call times for offline actions are the sync time.

**LOW**

26. `intake.demo = true` stamped on every booking, real ones included
    (`booking.service.ts`).
27. Doctor-arrived button always sends `minutesLate: 0`.
28. Unique-violation races surface as 500 rather than a mapped code.
29. Full log replay on every read and write (fine at pilot scale).
30. Patients receive every booking/patient id in their chamber.
31. Hard-coded values: SMS 35 poisha/segment, travel speeds, 50 km radius,
    quiet hours, 10-min offer window, 24 h consent, 12 h stock lapse, 90-day
    device proof, 10 s undo window, 500-event delta cap.
32. Dead or empty code: `backend/workers`, `frontend/site`, `createDexieStore`
    (unused), `patient_documents`, `subscriptions`, `invoices`, prescription
    tables.
33. Stale documentation and comments (§14.3).
34. Next.js pinned to webpack; the service-worker cache name bumped by hand.
35. Demo on Render's free tier sleeps (demo only).

Code hygiene, for balance: no TODOs, no `any`, no `@ts-ignore`, strict
TypeScript, lint-enforced layering, consistent error codes, comments that
explain why. The weaknesses are in what is missing and in a few wrong wires,
not in sloppy code.

---

## 13. Production readiness

| Module | Rating | Why |
|---|---|---|
| Booking (app) | **Not ready** | Blocked on a real server by the undeliverable code; demo works |
| Booking (counter walk-in) | Pilot-ready with supervision | Registered and inserted under the lock; no tracking link for the patient |
| Reception queue | **Not ready as shipped** → pilot-ready with supervision after fixes 2–4 | Engine is sound; Pause traps the chamber; Undo is dead; delay bug |
| Live patient tracking | Demo-ready only | No way to get a link on a real server; delay bug; works in the demo within 2 s |
| Doctor console | Pilot-ready with supervision | Visit record, sign-and-next, tests and history work; scoping is hospital-wide and cross-hospital |
| Records | Pilot-ready with supervision (staff side) | Patients cannot reach them on a real server without SMS |
| Consent | Demo-ready only | Needs patient accounts (SMS); pasted code; fixed 24 h |
| Lab | Pilot-ready with supervision | Delivery is transactional; files on local disk; patient access as above |
| Pharmacy | Pilot-ready with supervision | Simple and honest; little value inside one hospital |
| Beds | Pilot-ready with supervision | Sound state machine; manual updates; offline in memory |
| Emergency | Demo-ready only | Its value is a multi-hospital network; static travel times |
| Referrals | Demo-ready only | Needs two hospitals on one deployment |
| Payments | **Not ready** (online) | Only mock; `off` (pay at the hospital) is the safe pilot setting |
| Notifications | **Not ready** | No SMS provider, no push, no retry |
| Admin dashboard | Pilot-ready with supervision | Figures derive from real events; wait needs check-ins; feedback is demo rows |
| CSV import | Pilot-ready with supervision | Checked, previewed, all-or-nothing, undoable; untested on a real export |
| Authentication | Staff: pilot-ready with supervision. Patients: **not ready** | Staff: scrypt, lockout, rotation, TOTP. Patients need SMS |
| Offline mode | **Not ready** | Memory-only, no reload survival |
| Self-hosting | Pilot-ready with supervision | Proven once from clean; superuser DB, root containers, no monitoring, no log rotation |
| Backups | **Not ready** until an off-machine copy exists | Same disk, unencrypted, unmonitored |
| National dashboard | Demo-ready only | Needs a national multi-hospital deployment and a data source |

Nothing is production-ready in the sense of "runs unattended with real
patients". That is consistent with what this repository is (`CLAUDE.md` §1.1),
but it should be said plainly to a hospital.

---

## 14. If the builder disappeared

### 14.1 Knowledge that lives outside the repository

- **The owner's Windows machine:** scheduled tasks `HealthCare demo refresh`
  (daily reset of the deployed demo until 16 Oct, via
  `database/scripts/demo-refresh.ps1` started through `conhost.exe
  --headless`), `HealthCare pitch reset`/`pitch prep` (finished), and
  `%LOCALAPPDATA%\HealthCareDemo\` (pitch-prep scripts, refresh log, the Marks
  handbook builder `build.mjs`/`build-v2.mjs`/`build-intro.mjs` and its
  screenshots).
- **Hosted demo configuration:** the Render service was created by hand, so
  its build and start commands live in Render's dashboard, not in
  `render.yaml`; Vercel project settings; the deployed URLs (not recorded in
  the repo); which migrations Supabase has (all up to 0033 as of 30 Sep).
- **The local `.env`** (Supabase connection and dev secrets).
- **Company and prospect context** (registration, Marks contacts) — not code.

### 14.2 Hardest to understand for a new developer

The seed-plus-events queue model (§4.2) and why the reducer must never change
meaning; the sync path versus the dedicated routes (two ways to write the same
event, with different guards); `derive()`d idempotency keys; date handling
between UTC storage and the Dhaka day (six-hour trap, STATUS "things learned");
the token zoo (nine kinds, three secrets, audiences); seed ordering.

### 14.3 Documentation that is wrong or missing

Wrong today (code is right unless noted):
- `DATABASE.md` §7 / STATUS decision 3: `0014_rls.sql` with policies — never
  existed.
- `DEPLOY.md` S2/S6: with `SMS_PROVIDER=log` "patients follow their serial
  from the link on the booking screen" — they cannot book on a real server.
- `DEPLOY.md` S2: backups "opened by a password" — they are plain dumps.
- `BACKEND.md` §0: Supabase Storage, Sentry, Web Push as the stack — none is
  wired on a self-hosted server; pg-boss not installed.
- STATUS "Known gaps": several entries are stale (OtpInput has callers;
  notifications are published from the queue service; `/sync/*` is built;
  production build script — `tsx`).
- Code comments: `state.ts` and the `bookings` table comment name a
  `trg_booking_status_from_events` trigger and `fn_next_serial` that do not
  exist; `useSessionQueue.ts` says Dexie is swapped in; `ReceptionConsole.tsx`
  says P pauses (no such key); `backend/workers` says jobs arrive with step 11.

Missing: an incident runbook; a monitoring/alerting setup; an on-call
procedure; a release process (`mvp` → `main` → which deployment, how); a
data-processing agreement template (outside the repo, legal); a threat model;
a developer onboarding page (setup in one page — `README.md` is short); how to
write an SMS or payment adapter; what each secret protects and what breaks if
it changes.

### 14.4 Credentials and configuration to preserve

Supabase project access and database password; Render and Vercel accounts;
the GitHub account; any domain registrar; for each hospital deployment its
`deploy/.env` (five secrets) kept off the server; the demo staff password is
documented (`demo-password-2026`, demo only).

### 14.5 Procedures to write down now

Daily: check the backup ran and copy it off. Weekly: restore a backup on a
spare machine. On incident: how to read `docker compose logs api`, restart a
service, roll back to the previous image or commit, restore. Account
management: issuing and revoking staff accounts, a lost admin phone. Release:
backup → pull → up → smoke test (sign in, call next on a test chamber).

---

## 15. Founder crash course

### 15.1 Ten concepts

1. **Session, serial, booking.** A session is one doctor, one chamber, one
   date; a booking is a claim on a serial in it.
2. **The queue is derived, not stored:** roster + append-only events →
   state, through one pure reducer shared by server and console.
3. **`seq` orders everything,** never timestamps; it is what makes replay and
   socket resume work.
4. **Guards vs reducer:** rules decide if an event may be written; the reducer
   folds whatever is written, without judgement.
5. **The session row lock** serialises every write to one chamber.
6. **Idempotency by `client_event_id`:** a retry returns the stored result.
7. **Optimistic console + outbox:** the screen moves first, the server
   confirms or rolls back.
8. **Honest degradation:** every live figure has an age; stale is said and
   ranked lower; unknown is shown as unknown.
9. **Principals and scope:** staff (one hospital, roles), patient, guest (one
   booking), national (aggregates); every route checks its own scope.
10. **Adapters and modes:** `DEMO_MODE`, `SMS_PROVIDER`, `PAYMENT_PROVIDER`,
    `STORAGE_PROVIDER` decide what is real; production refuses the unsafe
    combinations (`env.ts`).

### 15.2 Ten files to read first

1. `shared/domain/src/queue/state.ts`
2. `shared/domain/src/queue/reducer.ts`
3. `shared/domain/src/queue/eta.ts` and `rate.ts`
4. `shared/domain/src/queue/rules.ts`
5. `backend/api/src/services/queue.service.ts`
6. `backend/api/src/controllers/queue.controller.ts` (scope checks, undo)
7. `backend/api/src/realtime/handlers.ts`
8. `frontend/console/src/hooks/useSessionQueue.ts`
9. `backend/api/src/services/booking.service.ts`
10. `backend/api/src/env.ts` and `deploy/docker-compose.yml`

### 15.3 Ten commands

```bash
pnpm install
docker compose up -d                       # local Postgres for tests/dev
pnpm db:migrate && pnpm db:reset           # local demo data (DEMO_MODE=true)
pnpm dev                                   # api :4000, console :3100, patient :3000
pnpm verify                                # typecheck + lint + format + tests (the real gate)
pnpm test:e2e e2e/two-device-queue.spec.ts # the canary
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
docker compose -f deploy/docker-compose.yml --env-file deploy/.env logs -f api
docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm backup once
docker compose -f deploy/docker-compose.yml --env-file deploy/.env exec api pnpm staff:create --hospital-code … --email … --name …
```

### 15.4 Ten failure scenarios

| Scenario | Response |
|---|---|
| A chamber "will not call next" | Paused (no Resume button) → `POST /api/v1/sessions/:id/resume` with a receptionist token, until the button exists; or the doctor is not marked arrived |
| Patients say the time on their phone is late | A delay was declared before arrival (fact 3) — until fixed, avoid declaring delays before arrival |
| A console shows "pending" that never clears | A stuck outbox entry; note what it was, reload (losing it), redo the action by hand |
| The API is down | `logs api`; a missing env value lists itself at boot; `restart api`; DB health: `logs db` |
| Certificate error | DNS or port 80 (`logs web`) |
| Disk full | Docker logs (no rotation) or backups; prune old logs and backups, add rotation |
| A staff member leaves | Deactivate on `S-B-11` (sessions end; sockets stay until reload, access token up to 15 min) |
| Admin lost phone | Another admin resets on `S-B-11`, or `pnpm staff:reset-2fa` |
| Server died | New machine, same `deploy/.env`, `up`, `restore.sh` the latest off-machine dump, same `TOTP_ENCRYPTION_KEY` |
| Suspected wrong queue | Replay is the truth: `queue_events` for the session in `seq` order; `queueService.rebuild(sessionId)` rewrites the caches |

### 15.5 Ten questions a YC partner or hospital CTO may ask

1. **How do you keep every screen consistent?** One pure reducer imported by
   server and console; an append-only event log ordered by a database
   sequence; a row lock per session; clients fold by sequence. Proven by a
   two-browser test under 2 s — run locally, not yet in CI.
2. **What happens when the internet drops at reception?** Today: the open
   console keeps working and syncs on reconnect, first writer wins; a reload
   loses queued actions. Making it survive reloads is a known, scoped fix.
3. **Where does patient data live?** In the hospital's own server in
   Bangladesh (Postgres in Docker); the demo is separate and synthetic.
4. **How do you isolate hospitals?** Separate servers per hospital for the
   pilot; within a server, role and hospital checks in the API. Database-level
   policies are not written yet — say so.
5. **How do you authenticate staff?** Individual accounts, scrypt, lockout,
   rotating refresh tokens, mandatory TOTP for admins.
6. **How does the ETA work?** Patients ahead × the doctor's measured pace (a
   recency-weighted average), adjusted for delays and pauses, with an honest
   band; "unknown" before the doctor arrives.
7. **Can it integrate with our HMS?** Not live. CSV import of structure,
   patients and appointments with preview, approval and undo; a read-only
   database or FHIR link is planned, not built.
8. **What does it cost to run?** One mid-range server, an SMS account, no
   licences; nothing else is called.
9. **How do you know it works?** ~4,600 automated tests against a real
   database plus ~140 browser tests; a security review on 30 Sep fixed four
   holes. Be ready to say what is not tested (§11).
10. **What breaks at scale?** One API process (in-memory sockets and rate
    limits), full replay per action, per-hospital islands. Fine for one
    hospital; a shared multi-hospital service needs a Socket.IO adapter,
    database policies and a worker.

---

## 16. Final honest assessment

**Can it run a small real hospital pilot today?** Not as shipped. The
staff-side queue engine is genuinely good and close; three wiring bugs and the
missing SMS adapter stand between it and a pilot.

**Minimum blockers** (in order): Resume control; delay consumed on arrival;
Undo through the real route; persistent outbox + console service worker;
an off-machine backup copy with a restore rehearsal; log rotation and an
uptime alert; either an SMS adapter or an explicit decision to run without the
patient app; the canary and reception specs run against the production
configuration.

**The most dangerous thing you may not have understood:** that "the patient
watches the queue move on their phone" — the pitch — does not happen on a real
server yet, because it depends on an SMS integration that is not written; and
that "RLS on all tables" does not mean the database isolates hospitals.

**Least confident in:** the offline story and the sync endpoint's breadth (the
two places where the code is most permissive and least tested), and the
behaviour of the whole stack over days of continuous use (memory, logs, disk —
never observed).

**Most confident in:** the queue domain (reducer, replay, guards, rate) and
the server's serialisation of writes under the session lock; the money
invariants; the staff authentication.

**If 7 days before real patients:**
1. Day 1: Resume button; delay consumed on arrival (with a test that declares
   a delay, then arrives); Undo via `POST /events/:id/undo` with the event id;
   restrict `/sync/events` to the reception types and guard the rest.
2. Day 2: Dexie stores for the three outboxes; a console service worker;
   poison-entry handling; E2E for pause/resume, undo and offline reload.
3. Day 3: SMS adapter for the chosen aggregator (or the documented no-SMS
   decision and `GUEST_BOOKING_OTP` passed through compose); stop printing
   bodies; stop storing links in `notifications.params`.
4. Day 4: deployment hardening — non-superuser database role for the API,
   log rotation, uptime alert, off-machine backup cron, restore rehearsal.
5. Day 5: run the canary and reception specs against the production compose
   on the real server; put E2E in CI.
6. Days 6–7: install at Marks, import or set up, train staff, dry-run a whole
   chamber with staff playing patients.

**If 30 days:** all of the above, then: database RLS policies keyed on a
per-request hospital setting (or a non-owner role with policies) so isolation
no longer depends on every route; per-doctor scoping and hospital-scoped
history with consent for other hospitals' records; a worker process (offer
expiry, SMS retry, refunds, leave-home, notification retention); dispatch out
of the request path; booking idempotency that returns the original tracking
link; abuse limits; audit log made append-only and queue actions audited;
socket revocation; slimmer non-root images with a compiled API; monitoring;
a paid penetration test; and fix the stale documents listed in §14.3.
