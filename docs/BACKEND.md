# Backend Document

## National Healthcare Platform — Bangladesh

**Document:** `BACKEND.md` — part of the build set (`PRD.md`, `APP_FLOW.md`, `FRONTEND.md`, `DATABASE.md`, **`BACKEND.md`**)
**Version:** 1.0
**Purpose:** every service, every file, every endpoint, every event, every worker — and what each one connects to. Claude Code should never have to guess where something lives.

---

## 0. Stack decisions (fixed)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 24 + TypeScript (strict)** | Shared domain types with the frontend. 22.19 is the floor (`engines`): the test tooling's `undici` needs it. The demo API on Render runs 22 (`.nvmrc`): Render's own 24 has a read-only global directory (`DEPLOY.md` §2) |
| HTTP | **Express 5** | Familiar, boring, fine at this scale |
| Database | **PostgreSQL (Supabase)** | See `DATABASE.md` |
| DB access | **Kysely** (typed query builder) + raw SQL for hot paths | No heavy ORM hiding the event log |
| Realtime | **Socket.IO** over WebSocket | Rooms map cleanly to sessions and hospitals; auto-reconnect built in |
| Background jobs | **pg-boss** (Postgres-backed) | No Redis dependency at launch; Upstash Redis + BullMQ only if load demands. **Not installed yet:** the pilot's first timed job (`sessions.materialise`, step 22) runs on a plain interval inside the API process and is idempotent, so a missed or doubled run is harmless (§8) |
| Validation | **Zod**, schemas shared with the client | One contract, both sides |
| Auth | JWT access (15 min) + refresh (30 days); staff passwords hashed with **scrypt** from `node:crypto` (N = 2^17, r = 8, p = 1, 16-byte salt, 64-byte key) | Changed from Argon2id on 2026-09-28: a real deployment runs on a Bangladeshi server rather than behind Supabase Auth (`CLAUDE.md` §4.1), and scrypt needs no native dependency. The parameters are OWASP's minimum for scrypt |
| Staff second factor | **TOTP** (RFC 6238) from `node:crypto`: HMAC-SHA-1, 6 digits, 30-second step, one step either side accepted, each step accepted once. The secret (160 bits) is stored sealed with **AES-256-GCM** under a key derived (HKDF-SHA-256) from `TOTP_ENCRYPTION_KEY`; ten single-use recovery codes (12 characters, `xxxx-xxxx-xxxx`) kept as HMAC-SHA-256 under the same key. The QR code is drawn in the console with `qrcode` | Pilot step 28 (`FR-SEC-10`). Every authenticator app reads this by default; nothing native is added. A database backup alone cannot mint codes |
| Files | Supabase Storage (reports, prescriptions, uploads) | Signed URLs only. A self-hosted deployment uses `STORAGE_PROVIDER=local` — a disk volume on the same server (§12b) |
| SMS | Aggregator behind an adapter interface | Provider is swappable |
| Push | Web Push (VAPID) for the PWA | |
| Logging | Pino → structured JSON | |
| Errors | Sentry | |
| Tests | Vitest (unit), Supertest (API), Playwright (E2E two-device queue) | |
| Deploy | Render (API + workers), Supabase (DB), Vercel (web) | Matches existing experience |

**Hard rule:** the queue reducer is **shared code** (`shared/domain`), imported unchanged by both the API and the console. The server never re-implements queue logic in SQL.

---

## 1. Repository layout (monorepo)

```
/
├── frontend/                    # everything that runs in a browser → FRONTEND.md
│   ├── patient/                 # Next.js PWA
│   ├── console/                 # Next.js staff web
│   └── site/                    # Next.js marketing
├── backend/                     # everything that runs on a server   ← this document
│   ├── api/                     # Express HTTP + Socket.IO
│   └── workers/                 # pg-boss job processors
├── shared/                      # imported by both sides
│   ├── domain/                  # types + queue reducer + ETA math
│   ├── client/                  # typed API + realtime client (used by web apps)
│   ├── ui/                      # design system
│   ├── i18n/                    # messages + formatters
│   └── config/                  # eslint, tsconfig, tailwind preset
├── database/                    # migrations, seeds, scripts → DATABASE.md
└── docs/                        # PRD.md, APP_FLOW.md, FRONTEND.md, DATABASE.md, BACKEND.md
```

Three top-level directories, divided by **where the code runs**, and a fourth
for the schema.

`shared/` is not a junk drawer — it is the part of this design that carries
the most weight. `shared/domain` holds the queue reducer, and the API and the
console import it *unchanged*. That single import is the whole mechanism
behind `FR-QUE-05`: two programs running the same function over the same event
log cannot disagree about what the queue looks like. It therefore belongs to
neither the frontend nor the backend, and lives in neither.

The boundaries are lint-enforced (`shared/config/eslint/layering.mjs`):
`frontend/` may not import from `backend/` or `database/`, `backend/` may not
import a frontend app, and `shared/domain` may import nothing at all. The two
sides meet at the HTTP and realtime contracts and in `shared/` — nowhere else.

---

## 2. `shared/domain` — the shared brain

This package has **no I/O**. Pure functions and types. Both the API and the console import it, which is what guarantees they can never disagree (`FR-QUE-05`).

```
shared/domain/src/
├── index.ts                     # public exports
├── types/
│   ├── ids.ts                   # branded UUID types (SessionId, BookingId…)
│   ├── enums.ts                 # mirrors DATABASE.md §1 enums
│   ├── entities.ts              # Hospital, Doctor, Session, Booking, Patient, Bed…
│   ├── events.ts                # QueueEvent union + payload types (DATABASE.md §3)
│   └── dto.ts                   # request/response shapes for every endpoint
├── queue/
│   ├── reducer.ts               # (state, event) => state   ← THE core function
│   ├── state.ts                 # QueueState shape, empty state, invariants
│   ├── eta.ts                   # fn: state → ETA per booking + confidence band (FR-QUE-11..13)
│   ├── rate.ts                  # rolling consultation-rate maths (FR-QUE-12)
│   ├── rules.ts                 # grace periods, late re-insertion k, priority rules (FR-QUE-20..22)
│   └── replay.ts                # events[] => state (used by rebuild + tests)
├── beds/
│   ├── board.ts                 # the bed state machine: canApply, applyLocal (FR-BED-01..02)
│   └── capacity.ts              # the public tally, tomorrow's forecast, mirror check (FR-BED-04..06)
├── emergency/
│   ├── cases.ts                 # the ER case state machine: canActOn, applyLocalCase, triage order (FR-EMG-01..04)
│   ├── ranking.ts               # capability → fresh before stale → travel time → load → beds (FR-PAT-43, FR-PAT-45)
│   └── freshness.ts             # a result is as old as its oldest ranked figure (FR-OFF-03..04)
├── schemas/
│   ├── auth.schema.ts           # zod
│   ├── booking.schema.ts
│   ├── queue.schema.ts
│   ├── emergency.schema.ts
│   ├── bed.schema.ts
│   ├── clinical.schema.ts
│   ├── payment.schema.ts
│   └── admin.schema.ts
└── util/
    ├── money.ts                 # poisha helpers (DB-P5)
    ├── phone.ts                 # normalisation/validation (DB-P6)
    └── time.ts                  # UTC ↔ Asia/Dhaka helpers (DB-P4)
```

**Who imports what**

| Consumer | Uses |
|---|---|
| `backend/api` | reducer, eta, rules, schemas, types |
| `backend/workers` | eta, rules, types |
| `frontend/console` | reducer, eta, state, schemas (optimistic UI, offline replay) |
| `frontend/patient` | eta (display only), types, schemas |

---

## 3. `backend/api` — file by file

```
backend/api/src/
├── server.ts                    # boots express, http server, socket.io; graceful shutdown
├── app.ts                       # express app: middleware chain, route mounting
├── env.ts                       # zod-validated process.env (§10)
├── config/
│   ├── db.ts                    # Kysely instance + pool
│   ├── storage.ts               # Supabase storage client, signed-URL helpers
│   ├── realtime.ts              # socket.io server instance + room helpers
│   ├── jobs.ts                  # pg-boss client (publish only; workers consume)
│   └── logger.ts                # pino
├── middleware/
│   ├── auth.ts                  # verifies JWT → req.principal {kind, id, hospitalId, roles};
│   │                            # a staff token with no hospital whose every role is national
│   │                            # (platform_admin, gov_viewer) → kind 'national', no hospitalId
│   ├── guestAuth.ts             # verifies guest token or guest_link token (FR-GST-05)
│   ├── requireRole.ts           # role + hospital scoping (FR-ROLE-01..02)
│   ├── audit.ts                 # writes audit_log on patient-identifying reads (FR-SEC-03)
│   ├── idempotency.ts           # Idempotency-Key handling for writes (FR-PAY-06, FR-QUE-51)
│   ├── rateLimit.ts             # OTP, guest booking, search limits (FR-SEC-05, FR-GST-14)
│   ├── validate.ts              # zod body/query/params validator
│   └── error.ts                 # maps AppError → HTTP + error code (§9)
├── routes/
│   ├── index.ts                 # mounts every router below
│   ├── auth.routes.ts
│   ├── guest.routes.ts
│   ├── patient.routes.ts
│   ├── discovery.routes.ts
│   ├── booking.routes.ts
│   ├── queue.routes.ts
│   ├── emergency.routes.ts
│   ├── bed.routes.ts
│   ├── clinical.routes.ts
│   ├── lab.routes.ts
│   ├── pharmacy.routes.ts
│   ├── payment.routes.ts
│   ├── notification.routes.ts
│   ├── admin.routes.ts
│   ├── hospital.routes.ts
│   ├── platform.routes.ts
│   ├── gov.routes.ts
│   ├── sync.routes.ts
│   └── webhooks.routes.ts       # bkash/nagad/sms delivery receipts
├── controllers/                 # thin: parse → call service → shape response
│   └── <one per route file>.controller.ts
├── services/                    # all business logic lives here
│   ├── auth.service.ts          # OTP issue/verify, tokens, staff login, 2FA
│   ├── guest.service.ts         # guest identity, guest links, claiming (FR-GST-01..15)
│   ├── patient.service.ts       # profiles CRUD, consents, wallet assembly
│   ├── discovery.service.ts     # hospital/doctor search, live status, capacity view
│   ├── booking.service.ts       # create/cancel/reschedule, serial allocation, standby
│   ├── queue.service.ts         # ⭐ event ingestion + state + broadcast (§4)
│   ├── eta.service.ts           # wraps domain/eta with session context
│   ├── emergency.service.ts     # inbound alerts, triage, capability publish, ranking
│   ├── referral.service.ts      # send/accept/decline, timeline
│   ├── bed.service.ts           # bed events, admissions, requests, public counters
│   ├── clinical.service.ts      # visits, prescriptions, QR consent, records
│   ├── lab.service.ts           # test order state machine, report delivery
│   ├── pharmacy.service.ts      # dispense, stock flags
│   ├── payment.service.ts       # intents, provider adapters, refunds, settlements
│   ├── notification.service.ts  # template render + channel fan-out (publishes jobs)
│   ├── admin.service.ts         # dashboard aggregates, exports
│   ├── hospital.service.ts      # settings, staff, doctors, sessions, templates
│   ├── platform.service.ts      # onboarding, verification, flags, subscriptions
│   ├── gov.service.ts           # aggregate-only assembly; refuses a payload carrying an identifier
│   └── sync.service.ts          # offline event replay + cursors (§5)
├── repositories/                # ONLY place SQL lives
│   ├── booking.repo.ts
│   ├── queueEvent.repo.ts       # append-only writer + seq allocation
│   ├── queueState.repo.ts       # read/write derived cache
│   ├── session.repo.ts
│   ├── patient.repo.ts
│   ├── guest.repo.ts
│   ├── hospital.repo.ts
│   ├── doctor.repo.ts
│   ├── bed.repo.ts
│   ├── emergency.repo.ts
│   ├── referral.repo.ts
│   ├── clinical.repo.ts
│   ├── lab.repo.ts
│   ├── payment.repo.ts
│   ├── notification.repo.ts
│   ├── audit.repo.ts
│   ├── analytics.repo.ts
│   └── gov.repo.ts              # reads the v_gov_* views only, as the gov_reader role
├── realtime/
│   ├── rooms.ts                 # room naming: session:<id>, hospital:<id>:beds, …
│   ├── auth.ts                  # socket handshake auth (JWT or guest link token)
│   ├── handlers.ts              # subscribe/unsubscribe, resume-from-seq
│   └── emit.ts                  # typed emitters used by services
├── adapters/
│   ├── sms/
│   │   ├── index.ts             # SmsProvider interface
│   │   ├── provider.local.ts    # BD aggregator implementation
│   │   └── provider.log.ts      # dev/demo: writes to console + DB
│   ├── push/webpush.ts
│   ├── payments/
│   │   ├── index.ts             # PaymentProvider interface
│   │   ├── bkash.ts
│   │   ├── nagad.ts
│   │   └── mock.ts              # v0 demo: always succeeds
│   ├── traveltime.ts            # static estimate in v0 (TRAVEL_TIME_MODE), routing API later
│   └── bmdc/verify.ts           # manual-assisted verification hook
├── jobs/
│   └── publish.ts               # typed job publishers (workers consume)
├── errors/
│   ├── AppError.ts
│   └── codes.ts                 # §9
└── types/
    └── express.d.ts             # req.principal typing
```

**Layering rule (enforced by lint):** `routes → controllers → services → repositories → db`. A controller never touches SQL; a repository never emits events or sends notifications; only services orchestrate.

---

## 4. The Queue Service — the most important file in the backend

`services/queue.service.ts` is the single entry point for every queue mutation. Everything else is a thin caller.

### 4.1 `appendEvent(input)` — the one function

```ts
appendEvent({
  sessionId, type, payload, actor,           // actor: staff | patient | system
  clientEventId, clientTs                    // present for console/offline writes
}) : { state: QueueState, etas: Eta[], seq: number }
```

**Algorithm**

1. **Idempotency** — if `client_event_id` exists in `queue_events`, return the stored result. This makes offline replay safe (`FR-QUE-51`).
2. **Authorise** — staff must be scoped to the session's hospital; patients may only append `PATIENT_LATE` or `BOOKING_CANCELLED` for their own booking.
3. **Load** — current `queue_state` + events after `rebuilt_from_seq` (usually zero rows).
4. **Validate** — run `domain/queue/rules.ts` guards: cannot call next while one is in chamber unmarked; cannot no-show before grace; cannot reorder without a reason.
5. **Serialise** — `SELECT … FOR UPDATE` on `sessions` row to prevent two counters calling simultaneously (`FR-QUE-53`).
6. **Append** — insert into `queue_events` with the next `seq`, server timestamp authoritative.
7. **Reduce** — `reducer(state, event)` from `shared/domain` → new state.
8. **Persist** — upsert `queue_state`; update `bookings.status` via trigger; update `sessions.avg_consult_seconds` on `PATIENT_DONE`.
9. **Recalculate** — `eta.ts` produces ETAs for all waiting bookings (`FR-QUE-11`), ≤ 500 ms for 100 patients (`NFR-03`).
10. **Broadcast** — `realtime/emit.ts` publishes `queue.updated` to `session:<id>` with `{ seq, state, etas, serverTs }` (≤ 2 s end-to-end, `NFR-01`). **After the transaction has committed, never from inside it** (`queue.service` `committed`): a screen that subscribes mid-write joins the room and then reads its catch-up state, and a broadcast sent before the commit was one it had missed for a write it could not yet see — it showed the previous patient until the next tap. A write that fails tells nobody.
11. **Notify** — publish notification jobs per §6 mapping (called, delayed, two-away, slot offered). Planned and written inside the same transaction, **through its own connection**: every read a function makes while it holds a `trx` goes through that `trx`. A read that went back to the pool from inside the session lock waited for a connection that the counters queued behind the lock were holding — five seconds (`connectionTimeoutMillis`), then a failed tap. `poolStarvation.test.ts` leaves the pool one connection and runs every queue write.
12. **Audit** — write `audit_log` with actor and event.
13. **Return** — new state + ETAs so the caller's optimistic UI can reconcile.

**Undo (`GR-02`)** appends `ACTION_UNDONE` referencing the original event; the reducer treats the pair as a no-op. History is never deleted. The only way to write one is `POST /events/:id/undo` — the original actor, inside `UNDO_WINDOW_SECONDS` (10, in `shared/domain`). A console undoes a whole tap newest event first, and an action it has not yet sent is dropped from its outbox instead: nothing is written for something taken back before the server heard of it.

**Delays (`FR-REC-03`, `FR-QUE-11`).** A delay declared **before** the doctor arrives moves the expected start (planned start + everything declared) and is used up by `DOCTOR_ARRIVED`: from then the queue counts from now. A delay declared **after** the arrival holds the chamber until the moment it was declared plus its minutes (`QueueState.hold`); a second one extends a hold still running. The no-show grace (`FR-QUE-20`) never ends before a hold does. `sessions.delay_minutes` stays the total declared that day; what a patient is shown is `outstandingDelayMinutes` — all of it before the arrival, then a hold's own minutes for as long as it runs.

**Pauses (`FR-REC-05`).** While a session is paused nobody is called (`canCallNext`) and nobody is marked absent (`canMarkNoShow`). `SESSION_RESUMED` records `QueueState.resumedAt`, and the no-show grace for whoever is at the front counts from there: a turn that came round before or during a break is not lost to it.

### 4.2 Other queue-service functions

| Function | Purpose |
|---|---|
| `getState(sessionId)` | Reads cache; rebuilds via `replay.ts` if `rebuilt_from_seq < last_event_seq` |
| `rebuild(sessionId)` | Full replay, used by the script and by tests |
| `offerFreedSlot(sessionId, freedBookingId)` | Creates `slot_offers`, notifies standby patients, expires automatically (`FR-QUE-30`) |
| `acceptOffer(offerId, patientOrGuest)` | Creates a booking, appends `SLOT_ACCEPTED`, records recovered value |
| `openScheduledSessions()` | Called by cron each morning |
| `autoEndSessions()` | Ends sessions idle past `planned_end` + buffer |

---

## 5. Offline sync protocol

Consoles operate fully offline (`FR-OFF-01`). The protocol is deliberately small.

### 5.1 Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/sync/events` | Batch of locally-queued events, each with `clientEventId` + `clientTs`, ordered by `clientTs` |
| `GET` | `/sync/session/:id?sinceSeq=` | Events the device missed while offline |
| `POST` | `/sync/cursor` | Device acknowledges `lastAckSeq` per session |

### 5.2 Rules

- `SY-01` Server ordering is authoritative; client timestamps only order the batch within itself (`FR-QUE-51`).
- `SY-02` Every event is idempotent by `clientEventId`; a replayed batch is safe.
- `SY-03` Conflicting events (two counters calling different patients) resolve by server arrival; the losing device receives a `conflict` entry in the batch response and rolls that row back.
- `SY-04` Bookings created online while the console was offline appear in the missed-events pull and are inserted into the local queue as new arrivals, never dropped (`FR-QUE-52`).
- `SY-05` Batch response shape: `{ accepted: [{clientEventId, seq, eventId}], conflicts: [{clientEventId, reason, code}], state, etas }`. `eventId` is the stored event, which is what `POST /events/:id/undo` names: a console knows an action only by its own `clientEventId`, and cannot undo what it synced without it (`GR-02`).
- `SY-06` A device offline longer than 24 h is forced to a full session re-pull rather than a delta.
- `SY-07` A batch carries only what a counter can do offline, and each entry only from a role its own route admits (`OFFLINE_ACTION_ROLES` in `shared/domain`): `DOCTOR_ARRIVED`, `DELAY_DECLARED`, `PATIENT_CALLED`, `PATIENT_DONE` from a receptionist or a doctor; `SESSION_PAUSED`, `SESSION_RESUMED`, `PATIENT_LATE`, `PATIENT_NO_SHOW`, `PATIENT_REINSERTED`, `PATIENT_ARRIVED`, `PRIORITY_REORDERED` from a receptionist. Anything else — `ACTION_UNDONE`, `SLOT_*`, `BOOKING_CANCELLED`, `SESSION_ENDED`, `SESSION_OPENED`, `WALKIN_ADDED` — has a route of its own with rules a replay would skip, and comes back as a `conflict` (`NOT_AN_OFFLINE_ACTION`, or `ROLE_NOT_ALLOWED`) with nothing written. The rest of the batch still applies.
- **`SY-08` and `SY-09` are decided and only partly built** (owner, 2026-10-05). Built: the reception console shows the queue from a push's answer and no longer waits for the broadcast (`fix/console-ack-rollback`). Not built: `applied` on `queue.updated`, `unanswered` on subscribe, `version` on beds and emergency cases, and the ward and ER consoles' use of their answers. They are `PLATFORM_PLAN.md` 1.9c–1.9e and wait until after the first pilot.
- `SY-08` **One action is shown once, whichever of its two answers arrives first.** The server states the result of a write by two roads, the answer to the request and a broadcast. They are different connections: either can be first, and either can be missing. So every statement of a queue names the console actions it has just taken in, by the console's own key: the answer in `accepted` (`SY-05`), a `queue.updated` in `applied: [{clientEventId, seq, eventId}]`. A console draws an action of its own on top of the server's queue from the tap until the first statement that names it, or refuses it, and never after (`FRONTEND.md` §11.1). Which of two statements is the newer is decided by `seq`, never by arrival. A console that subscribes with actions still unanswered sends their keys, and the catch-up names those the log already holds, so an answer lost on the way is settled by the socket alone. Nothing in this rule is a timer, and nothing in it depends on how long the answer takes: an answer that waits on notifications being sent is slow, not wrong.
  - **`applied` is bounded by what it is about.** A live broadcast names the events of the one write behind it and nothing older. A catch-up names only keys the subscriber asked about (at most 500). No statement carries the history of the log.
  - **A tap is one thing on the screen.** One tap can be more than one event (*next* finishes one patient and calls the other). A console queues a tap's events together and sends them together, so the server takes them in one write and names them in one statement. A statement that names some of a tap's events and not the rest leaves the rest drawn until they are named or refused, and an answer's accepted and refused entries are applied in one redraw. The screen therefore shows half a tap only when that is the queue's true state — the server took one event and refused the other — and then it shows it once, with the refusal.
- `SY-09` **A bed and an emergency case have no shared sequence, so each carries its own.** `version` on a bed and on an emergency case is raised by the database on every change to that row, by a trigger, in the statement that makes the change and so in the same transaction: no path can change a row without raising it, and a change that rolls back raises nothing. Every statement about one carries it — a board read, a broadcast, the answer to a write — and a console keeps, for each, the statement with the highest version, whichever road it came by. The answer to a write carries the rows it changed as they stand after the commit, and the broadcast names the action by its `clientEventId`; a console takes its own optimistic drawing of the action off at the first of the two, as in `SY-08`. A timestamp is not used for this: the server's clock is read after the row is, not with it, and two writes to one bed can be stamped in the opposite order to the one they happened in.

---

## 6. Realtime channels

| Room | Who joins | Events emitted |
|---|---|---|
| `session:<sessionId>` | patients with a booking (or guest link), reception console, doctor app | `queue.updated`, `session.delayed`, `session.ended`, `patient.called` (targeted) |
| `hospital:<id>:beds` | ward board, ER console, admin | `bed.updated` (the beds an action changed, no patient identity), `capacity.updated` (the `v_public_hospital_capacity` row, read back after commit), `bedrequest.updated` (id and state only — the pending list is re-read through the audited endpoint), `emergency.handoff` (an ER case handed to the ward, or placed; id and state only) |
| `hospital:<id>:emergency` | ER console | `emergency.inbound` (the case as the console lists it — never a phone number), `emergency.updated` (the case and the ER's load), `capabilities.updated`, `referral.incoming` (a referral another ER just sent this one — the console rings), `referral.updated` (a step of any referral this ER sent or was sent: seen, answered, withdrawn, arrived). The console also hears the beds room's `capacity.updated` for its bed counters |
| `hospital:<id>:lab` | lab console | `test.ordered`, `test.updated` |
| `hospital:<id>:admin` | admin dashboard | `metrics.tick` (throttled 30 s) |
| `patient:<patientId>` | that patient's devices | `record.ready`, `booking.updated`, `offer.received`, `bedrequest.updated` |

There is no room per referral. Both ends of a referral are ER consoles, already in their own `hospital:<id>:emergency` rooms, so `referral.updated` goes to both of those (step 16). A `referral:<id>` room would be one more subscription every console had to remember to make, and a forgotten one reaches nobody, silently.

**Handshake:** JWT (staff/patient) or a guest-link token. A socket may only join rooms its principal is scoped to: staff their own hospital's, a patient the sessions they hold a booking in, a guest only the session of the one booking its token names — never by the guest identity behind it (`FR-GST-05`). **Resume:** client sends `lastSeq`; server replays missed events from `queue_events` before streaming live (`SY-01`). A console also sends `unanswered`, the keys of its own actions the server has not yet answered (at most 500, staff only); the `queue.updated` that ends the catch-up names in `applied` those this session's log already holds (`SY-08`).

**Payload envelope (all events):**
```ts
{ type: string, seq?: number, serverTs: string, data: unknown }
```

**What a statement names (`SY-08`, `SY-09`; decided, not built yet).** `queue.updated` also carries `applied: [{clientEventId, seq, eventId}]`: the events the write behind it appended, or on a catch-up the subscriber's `unanswered` keys that are in the log. It is empty when the broadcast is not the result of an action (a roster change, a catch-up with nothing to name). `bed.updated` and `emergency.updated` carry `clientEventId`, the key of the action behind them, when there was one; each bed and each case in them carries its `version`.

---

## 7. HTTP API

Base: `/api/v1`. All responses: `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`.

### 7.1 Auth & guest

| Method | Path | Auth | Body → Result | Notes |
|---|---|---|---|---|
| POST | `/auth/otp` | none | `{phone}` → `{ttlSeconds, resendAfterSeconds, demoCode?}` | pilot step 25. Six digits by SMS, marked sensitive so no provider prints it; `demoCode` only under `DEMO_MODE`. At most `OTP_MAX_PER_HOUR` per number and 30 per address per ten minutes (`FR-SEC-05`); a locked number is `AUTH_LOCKED` |
| POST | `/auth/verify` | none | `{phone, code}` → `{access, refresh, accessExpiresAt, user, isNew, claimable}` | makes or finds the account. Five wrong codes lock the number fifteen minutes. `claimable` counts the patients the number holds that no account owns (`S-A-20`) |
| POST | `/auth/refresh` | refresh | `{refresh}` → the same as verify | rotates; a reused token ends every session of the account; a refresh from another device than the one that signed in is refused (`FR-SEC-05`) |
| POST | `/auth/logout` | refresh | `{refresh}` | revokes that session |
| GET | `/me/profiles` | user | → `{profiles}` | the account's own patients, with booking and record counts. Records are `GET /patients/:id/records` |
| POST | `/staff/login` | none | `{hospitalCode?, email, password}` → `{requires2fa: false, access, refresh, roles, hospital, staff, mustChangePassword, twoFactor}` or `{requires2fa: true, challenge, challengeExpiresAt}` | `hospitalCode` only when the email exists at more than one facility. Five consecutive failures lock the account for fifteen minutes (`AUTH_LOCKED`). The same answer for an unknown email and a wrong password (`AUTH_INVALID_CREDENTIALS`). With the second factor on, a right password gets a five-minute challenge and no tokens, and the failure count is not cleared until the code is right. `twoFactor` is `{enabled, required, recoveryCodesLeft}`; an administrator (`hospital_admin`, `platform_admin`) with it off gets a token carrying `tfa: 'setup'`, which opens only `/staff/2fa/setup`, `/staff/2fa/enable`, `/staff/me` and `/staff/logout` (`AUTH_2FA_SETUP_REQUIRED`) |
| POST | `/staff/refresh` | refresh | → `{access, refresh}` | rotates: the old refresh row is revoked (`DATABASE.md` §2.1) |
| POST | `/staff/logout` | staff | | revokes this refresh token |
| GET | `/staff/me` | staff | → `{staff, hospital, roles, mustChangePassword}` | |
| POST | `/staff/password` | staff | `{current, next}` | clears `must_change_password`; revokes the account's other refresh tokens |
| POST | `/staff/2fa` | challenge | `{challenge, code}` → the session, as `/staff/login` | step 28 (`FR-SEC-10`). `code` is six digits from the app or a recovery code; the shape says which. A wrong or already-used code is `AUTH_2FA_INVALID` and counts towards the lock; a challenge that ran out, or whose account was reset since, is `AUTH_TOKEN_INVALID`. The challenge is a JWT with its own audience, so it is never accepted as a bearer token |
| POST | `/staff/2fa/setup` | staff | → `{secret, otpauthUri}` | the secret for the app — the same unconfirmed one until it is turned on, so a reload or a second tab shows the same QR code; `AUTH_2FA_ALREADY_ON` when it is on |
| POST | `/staff/2fa/enable` | staff | `{code}` → `{recoveryCodes, session}` | a code from the app turns it on; the ten recovery codes are shown once; every other session of the account ends. Audited (`SETTINGS_CHANGE`, `two_factor_enabled`) |
| POST | `/guest/start` | none | `{phone, name, deviceProof?}` → `{needsOtp: false, guestToken, deviceProof}` or `{needsOtp: true, ttlSeconds, …}` | a number proves itself once **per device** (`FR-GST-12`, decision 85): the code is skipped only for the `deviceProof` `/guest/verify` gave this device for this number — checked against the number's guest identity and the device, and handed back fresh. Anybody else, including somebody typing a number that proved itself elsewhere, is sent a code. With `GUEST_BOOKING_OTP` off — the default on a demonstration — `{needsOtp: false, guestToken: null}` |
| POST | `/guest/verify` | none | `{phone, name, code}` → `{guestToken, deviceProof}` | creates no account (`FR-GST-04`). `deviceProof` is a signed token (`guest-device` audience, 90 days) the device keeps for its next `/guest/start`. `POST /bookings`, `POST /sessions/:id/standby` and `POST /bed-requests` with guest details then need the guest token for the same number, where the check is on (`AUTH_REQUIRED`, `reason: phone_unverified`) |
| GET | `/guest/link/:token` | link | → `{booking, session, queueState, etas, record}` | powers the SMS tracking link (`FR-GST-05`); `record` is that booking's signed visit once there is one, else null (`FR-GST-08`) |
| POST | `/guest/claim` | user | `{confirm?}` → `{claimable: […], claimed}` | (`FR-GST-09`, `FR-PAT-04`, `FR-IMP-10`). The number is the account's own verified one, never one in the body. Without `confirm`, the preview; with it, every patient held for the number as a guest or imported by a hospital becomes the account's, in one transaction, audited |

### 7.2 Discovery (public, no auth)

| Method | Path | Result |
|---|---|---|
| GET | `/search?q&need&lat&lng&limit` | one search across the network (`S-A-07s`, `FR-PAT-16`–`18`). `need` is a need's key — `specialty:<code>`, `bed:<kind>`, `capability:<kind>` — and `q` is typed text. Returns `{ need, text, hospitals, doctors, asOf }`: the hospitals that can provide the need, each a hospital card with its live figures and beds (most free first for a bed kind, never-confirmed counts last), and the doctors matched by name or in the specialty. Text that names a need ("ICU", "বার্ন") is read as that need by `readSearch` in `shared/domain`, the same table the patient app offers needs from; a need the data does not hold is a 400, not an empty list |
| GET | `/config?scope` | what this deployment offers (`demo`, `onlinePayments`, `guestPhoneCheck`) and, with `scope`, whose app this is: `scope: { code, nameBn, nameEn, theme }`, where `theme` is the hospital's brand tokens if it has set readable ones (`FR-BRD-02`, `FR-BRD-03`); `scope: null` without it |
| GET | `/hospitals?lat&lng&district&q&bedKind` | list + live capacity from `v_public_hospital_capacity`; `bedKind` keeps hospitals that have that kind of bed, full or not (`S-A-11`) |
| GET | `/hospitals/:id` | detail + departments + capabilities + beds summary |
| GET | `/doctors?specialty&hospitalId&q&availableToday` | list + live status |
| GET | `/doctors/:id` | detail + upcoming sessions |
| GET | `/sessions/:id/availability` | serials taken/total, expected wait |
| GET | `/specialties` | catalogue |

**Hospital scope (`FR-BRD-02`, `FR-PAT-19`).** `/search`, `/hospitals`, `/doctors` and `/config` take `scope=<hospital code>` (`hospitals.code`, matched upper-case). With it they answer for that hospital only: one hospital in a list, a doctor's chambers there and not elsewhere, no other hospital found by name. It is what a hospital-branded patient app sends on every discovery call. It is not a permission — everything it narrows is public — so a code no live hospital has is a 404, never a quiet fall back to the whole network: an app built for one hospital must not show its competitors because of a mistake in its configuration. The emergency search (`/emergency/search`) does not take it; whether a hospital's own app should show other hospitals' emergency departments is the owner's to rule on (`docs/STATUS.md`).

**Links and origins (`FR-BRD-04`), `config/links.ts`.** Every link this API gives a patient is built by `patientLink(path, query)`, and the browser origins it answers — for CORS and for the socket handshake alike — are `allowedOrigins()`: the patient app's, the console's, and any exact origins in `EXTRA_ALLOWED_ORIGINS`. Both answer today what the six call sites and two lists they replaced answered. They exist so that a hospital's own address (`code.platform-domain`) is a change in one function.

### 7.3 Booking

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/bookings` | user \| guest | Idempotency-Key required; allocates serial via `fn_next_serial`; emits `queue.updated`; queues confirmation SMS (`FR-PAT-20`) |
| GET | `/bookings/:id` | owner \| staff | |
| GET | `/me/bookings?scope=today\|upcoming\|past` | user \| guest | |
| POST | `/bookings/:id/cancel` | owner \| staff | appends `BOOKING_CANCELLED`, triggers refund eligibility |
| POST | `/bookings/:id/reschedule` | owner \| staff | cancels + creates in one transaction |
| POST | `/bookings/:id/late` | owner — a guest token only for the booking it names (`FR-GST-05`) | appends `PATIENT_LATE` (`FR-PAT-33`) |
| POST | `/sessions/:id/standby` | none (guest details) — the phone proved first where a guest booking must (`FR-GST-03`: the guest token from `/guest/verify`, else 401 `phone_unverified`) | joins a **full** chamber's list; Idempotency-Key required, rate-limited per address; optional `prepay` method charges the fee against the standby row (`FR-PAT-25`, `FR-PAT-26`). Returns the status token |
| GET | `/standby/:token` | the token | `S-A-08s`: waiting / offered / seated / left; records lapsed offers as it answers; mints the seat's tracking link once |
| POST | `/standby/:token/accept` | the token | yes to the open offer; books the chair and pays for it with the chosen method (`FR-PAT-27`) |
| POST | `/standby/:token/decline` | the token | no; `SLOT_EXPIRED`, then the slot is offered to the next patient (`FR-QUE-30`) |
| POST | `/standby/:token/leave` | the token | off the list; a prepayment is marked owed (`standby_unseated`) |
| POST | `/offers/:id/accept` | receptionist | a yes rung in to the counter (`FR-REC-30`) — see §7.4 |
| GET | `/registration/patients?phone=` | receptionist | pilot step 23 (`FR-REC-20`). Everybody the number reaches — through the guest identity or account it owns, or as a patient's own contact number — for the counter to pick the person standing there. The phone is normalised (`DB-P6`) or refused. One `RECORD_VIEW` audit row per patient shown (`DB-P7`) |
| POST | `/registration/patients` | receptionist | `{phone, fullName, ageYears, sex}` → a guest identity for the phone and a patient under it, as a guest booking makes (`FR-GST-13`: no account). The same name under the same number is the same person. Idempotency-Key required. The serial is then `POST /sessions/:id/walkin` |

### 7.4 Queue (console)

| Method | Path | Role | Event appended |
|---|---|---|---|
| GET | `/sessions/:id/queue` | staff | — |
| POST | `/sessions/:id/arrived` | receptionist, doctor | `DOCTOR_ARRIVED` |
| POST | `/sessions/:id/delay` | receptionist, doctor | `DELAY_DECLARED` |
| POST | `/sessions/:id/pause` \| `/resume` | receptionist | `SESSION_PAUSED` / `_RESUMED` |
| POST | `/sessions/:id/next` | receptionist, doctor | `PATIENT_DONE` + `PATIENT_CALLED` |
| POST | `/bookings/:id/done` | receptionist, doctor | `PATIENT_DONE` |
| POST | `/bookings/:id/late` | receptionist | `PATIENT_LATE` |
| POST | `/bookings/:id/no-show` | receptionist | `PATIENT_NO_SHOW` + auto slot offer |
| POST | `/bookings/:id/reinstate` | receptionist | `PATIENT_REINSERTED` |
| POST | `/bookings/:id/check-in` | receptionist | `PATIENT_ARRIVED` — body `{ quotedWaitMinutes }` 0–480; the arrival is the server's clock (`FR-REC-18`) |
| POST | `/sessions/:id/walkin` | receptionist | `WALKIN_ADDED`. The booking is created under the session lock, so the serial is the chamber's next; a request replayed with the same `clientEventId` is answered from the log before any booking is written (pilot step 23) |
| POST | `/sessions/:id/reorder` | receptionist | `PRIORITY_REORDERED` (reason required) |
| GET | `/sessions/:id/standby` | receptionist, hospital_admin | — (who is waiting and what was offered, no phone numbers; records any lapsed offer as `SLOT_EXPIRED` as it answers) |
| POST | `/bookings/:id/offer-slot` | receptionist | `SLOT_OFFERED` — `BTN-B02-OFFER`: the freed chair to the next person on the standby list, ten-minute window (`FR-QUE-30`, `FR-REC-30`) |
| POST | `/events/:id/undo` | actor, ≤ 10 s | `ACTION_UNDONE` |
| POST | `/sessions/:id/end` | receptionist | `SESSION_ENDED`. **Refused while a patient is in the chamber** (owner's decision, 2026-10-05; `BTN-B02-END`): the queue's ordinary guard refusal (`QUEUE_GUARD_FAILED`, guard `PATIENT_IN_CHAMBER`), and no event is written. Once that patient is finished the end goes through. Patients who are waiting, late or booked do not block it, and ending changes none of their statuses: the console states their number and asks for a deliberate confirmation instead. Whoever paid and was not seen is owed a refund the moment it ends (`FR-PAY-07`), as before |

### 7.5 Emergency, beds, referrals

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/emergency/search?lat&lng&problem&from&capability&bedKind` | none | `fn_nearby_hospitals` for geography, `v_public_hospital_capacity` for figures, the travel-time adapter for minutes, ranked by `domain/emergency/ranking.ts` (`FR-PAT-43`, `FR-PAT-45`). Lists only facilities with an ER console. Every field optional; `from=<hospitalId>` searches from that ER and leaves it out — the decline's suggestion (`FR-EMG-02`) and the refer-out search (`FR-EMG-07`). `capability` and `bedKind` need `from`: the coordinator's named need replaces the problem's default, so "an ICU bed" can be searched for. The console keeps only ERs with the capability and a free bed (`referralCandidates`) and says how many it left out |
| POST | `/emergency/inbound` | none | anonymous allowed (`FR-GST-03`). Idempotency-Key required; rate-limited per address (10 per 10 minutes). The ETA comes from the position, which is not stored. Emits `emergency.inbound`; returns a signed case token (`emergency_case` audience, 24 h) and `trackUrl` |
| GET | `/emergency/track/:token` | the token | `S-A-10c`: state, hospital, ETA, decline reason. Names nobody |
| POST | `/emergency/track/:token/cancel` | the token | `BTN-A10C-CANCEL`; emits `emergency.updated` |
| GET | `/hospitals/:id/emergency` | emergency, admin | `S-B-07`: open cases (no phone numbers), load, capabilities, the published bed figures, the bed kinds a handoff can ask for, and the referrals this ER sent or was sent — every open one and today's closed ones, each with its timeline |
| GET | `/emergency/cases/:id/contact` | emergency | the number a caller left; writes `audit_log` when there is one (`DB-P7`) |
| POST | `/emergency/cases/:id/acknowledge` | emergency | patient sees "hospital ready"; `emergency.acknowledged` to a number if one was left |
| POST | `/emergency/cases` | emergency | walk-in ER registration; `clientEventId` is the idempotency key |
| PATCH | `/emergency/cases/:id` | emergency | `{action}`: `accept` (a token is given), `decline` (reason required; `emergency.declined`), `triage`, `handoff` (a bed kind the hospital has), `discharge`. Guarded by `canActOn`; a replay answers `duplicate: true` |
| PUT | `/hospitals/:id/capabilities` | emergency, admin | confirms each listed row with this person and instant — re-sending an unchanged list renews its freshness; a kind the hospital never declared is refused (`FR-EMG-05`) |
| POST | `/referrals` | emergency | send (`FR-EMG-08`): `{emergencyCaseId, toHospitalId, requiredCapability?, requiredBedKind?, note?}` — at least one of the two needs. Only a case in this ER (`arrived`), only one open referral per case, only to another facility with an ER console. The summary's problem, colour, age and sex are read from the case, not sent. `clientEventId` is the idempotency key; a replay answers `duplicate: true`. Emits `referral.incoming` to the receiver |
| POST | `/referrals/:id/seen` | emergency, receiver | the first touch of the card in `LIST-B07-IN` — a person looked, not a list that loaded. Stamped once |
| POST | `/referrals/:id/accept` \| `/decline` | emergency, receiver | reason required on decline. An answer nobody saw stamps `seen` with it |
| POST | `/referrals/:id/cancel` | emergency, sender | `BTN-B07-REFER-CANCEL`: withdraw before arrival |
| POST | `/referrals/:id/arrive` | emergency, receiver | `BTN-B07-IN-ARRIVED`, the handover (owner's ruling 2026-09-22): in one transaction, a case with a token at the receiving ER (the summary's facts, no phone), the sending case closed as `referred`, the referral `arrived` |

Every referral step returns `{ referral, duplicate, serverTs }` and broadcasts `referral.updated` to both ERs after commit. A step belongs to one side — the other side's is `AUTH_FORBIDDEN_SCOPE` — and a step already taken is a replay. While a referral is open, `PATCH /emergency/cases/:id` refuses `handoff` and `discharge`, and the ward's admit refuses the case, with `details.guard = 'REFERRAL_OPEN'`.
| GET | `/hospitals/:id/beds` | any staff role at the hospital | board data: wards, beds, the published row, stale threshold, Dhaka date. Writes the logged RELEASE of any lapsed hold first. No patient identity |
| GET | `/beds/:id` | ward | the bed panel; names the occupant and writes `audit_log` when it does (`DB-P7`) |
| POST | `/beds/:id/admit` \| `/discharge` \| `/transfer` \| `/reserve` \| `/oos` | ward | writes `bed_events`, emits `bed.updated` + `capacity.updated`. Admit takes a pending `bedRequestId`, the patient at the desk (name, phone, age, sex), or an `emergencyCaseId` **with** the patient at the desk — the stay is `source = 'er'` and the case closes as `admitted` |
| POST | `/beds/:id/release` \| `/restore` \| `/clean-start` \| `/clean-done` | ward | the rest of the state machine: without `clean-done` a discharged bed could never be free again. `release` refuses a bed held for a request — answer the request instead |
| POST | `/beds/:id/expected-discharge` | ward | `SEL-B06-EXPDIS` (`FR-BED-04`); not an event, idempotent by nature |
| GET | `/hospitals/:id/bed-requests` | ward | `LIST-B06-PENDING`; audited per request shown. `handoffs` is the ER half (`FR-BED-07`): token, problem, colour, age, sex, bed kind — names nobody, so not audited |
| POST | `/bed-requests` | none (guest details in the body, as `POST /bookings`) — the phone proved first, as a guest booking's is (`FR-GST-03`) | (`FR-PAT-52`); returns a signed status token (`bed_request` audience), idempotent on the key and on one open request per patient per hospital |
| GET | `/bed-requests/track/:token` | the token | the family's status; a lapsed hold reads `expired` at once |
| POST | `/bed-requests/:id/respond` | ward | `hold` (reserves a real bed of the kind asked for), `confirm` (admits), `decline`; hold and decline send `bed.request_held` / `bed.request_declined` |

Bed writes return `{ beds, published, duplicate, serverTs }`: the beds as they now stand and the view's row read back after commit, so a console can reconcile without waiting for the broadcast. The ward board does not do that yet: it reads the board again after the answer. `SY-09` says what it will do, and gives each bed a `version` (decided, not built). A replayed `clientEventId` returns the same shape with `duplicate: true` (SY-02). A lapsed hold on a bed about to be acted on is released first, by nobody, so every decision is taken against the bed's real state.

The patient's bed search (`S-A-11`) re-reads `/hospitals?bedKind=` every thirty seconds while visible rather than joining a room: the board room is staff-only, and this version has no anonymous socket.

### 7.6 Clinical, lab, pharmacy

> **Permission on the record endpoints is not a role.** `FR-DOC-10` is a
> *relationship* — has this patient been in a chamber at this hospital, or did
> they consent — so `clinical.routes` requires only authentication and
> `clinical.service` decides. It is the one router in this API whose guard is
> not visible in the route table; `clinical.routes.test.ts` carries the matrix
> that a `requireRole` line would otherwise have documented. Every read that
> passes writes an `audit_log` row and every refused read writes none
> (`DB-P7`, `FR-SEC-03`).

| Method | Path | Role |
|---|---|---|
| POST | `/visits` | doctor — creates or updates the visit; `sign: true` signs it and advances the queue (`FR-DOC-08`). A signed visit is final: a later save is refused (`VISIT_ALREADY_SIGNED`), and a sign sent again only replays the queue step. Prescriptions are out of scope for this version (`PRD.md` §9) |
| GET | `/patients/:id/records?booking=` | patient (own) \| doctor (own sessions or consent). `booking` returns that booking's pre-visit intake alongside the history, so `S-B-05` opens in one request (`FR-DOC-03`, `NFR-04`) |
| POST | `/patients/:id/consent-offer` | patient (own) — mints the short-lived signed code `BTN-A12-QR` shows, with the grant's length (`FR-PAT-63`). Returns `{code, expiresInSeconds, grantHours}` |
| POST | `/consents` / `/consents/:id/revoke` | patient |
| POST | `/consents/qr` | doctor — redeems the patient's code: writes the `consents` row and its `audit_log` row together (`FR-PAT-63`, `FR-SEC-03`). The code is pasted until a QR encoder and scanner are agreed; the endpoint is the same either way |
| GET | `/patients/:id/access` | patient (own) — `BTN-A12-ACCESS`: the grants made and every staff read, with name, hospital and time (`FR-PAT-64`) |

> **Under `DEMO_MODE` only, a guest speaks for the patient their own booking
> names** on the offer, the access log and a revoke (`CLAUDE.md` §4.1). This
> version has no accounts, so without it the consent handshake is unreachable
> from the patient side. With `DEMO_MODE` off a guest is refused all three, and
> when accounts exist the branch is deleted (`assertSpeaksFor` in
> `consent.service`).
| POST | `/documents` | patient — paper upload |
| GET | `/lab/catalogue` | doctor — the chips `BTN-B05-TEST` renders |
| POST | `/test-orders` | doctor. Several tests in one request; the patient and the hospital are read from the booking's visit, never from the body |
| GET | `/hospitals/:id/test-orders?state=&days=` | lab \| hospital_admin — the bench queue and its turnaround figures (`FR-LAB-01`, `FR-LAB-04`) |
| PATCH | `/test-orders/:id/state` | lab \| hospital_admin. `collect`, `process`, `ready`, `cancel` — never `deliver`, which is the server's own step |
| GET | `/test-orders/:id/patient` | lab \| hospital_admin — the name a bench calls somebody by; a separate, audited read (`DB-P7`) |
| POST | `/test-orders/:id/report` | lab \| hospital_admin — upload → delivers to wallet **and the ordering doctor**, in one transaction (`FR-LAB-03`). Its own 14mb body limit; every other route stays at 256kb |
| GET | `/hospitals/:id/pharmacy-stock` | pharmacy \| hospital_admin |
| PUT | `/hospitals/:id/pharmacy-stock` | pharmacy \| hospital_admin — the whole list confirmed, which renews its freshness (`FR-PHR-02`) |
| GET | `/medicines?q=&lat=&lng=` | **public** — the availability search. A stock flag names nobody |
| GET | `/files/:key?expires=&sig=` | **public by URL, private by signature** — a stored report. A bad or expired signature is a 404, never a 403 |
| GET | `/guest/link/:token/reports/:reportId` | the link is the credential. Scoped to that link's own booking, so a live token cannot open another patient's result |
| ~~POST~~ | ~~`/prescriptions/:id/dispense`~~ | **not built** — prescribing is out of scope this version, so there is nothing to dispense against (`PRD.md` §12) |

> **"Signed URLs only" (§0) is a rule about reads.** No public bucket, every
> fetch signed and expiring — and that holds under `STORAGE_PROVIDER=mock`,
> which signs with the same trust root and serves through `/files/:key`. The
> *upload* goes to the endpoint above rather than direct to a bucket, which is
> what §7.6 has always said and the only arrangement that works identically
> under both providers.

### 7.7 Payments, admin, platform, gov, webhooks

| Method | Path | Notes |
|---|---|---|
| POST | `/payments/intent` | patient \| guest. Idempotent three ways (`FR-PAY-06`). **The amount is not in the body** — it is read from the booking's own `fee_poisha`, so a client cannot decide what it owes. Only a booking is chargeable in this version |
| GET | `/bookings/:id/payments` | owner (a guest link only for its own booking) \| staff at the booking's hospital — the fence `GET /bookings/:id` has. What was charged against one booking |
| POST | `/payments/:id/refund` | hospital_admin. **The amount is not in the body either** — the *reason* picks the rule and `refundFor` computes it (`FR-PAY-03`). `FR-PAY-07`'s automatic eligibility does not come through here: it is raised when a session ends |
| GET | `/hospitals/:id/settlement?from=&to=` | hospital_admin (`FR-PAY-05`) |
| POST | `/webhooks/bkash` \| `/nagad` | **no token**: a provider holds none of ours, so the signature over the raw body *is* the authentication. Answers 200 for a replay, because a 4xx makes a provider retry something already done |
| POST | `/webhooks/sms-dlr` | delivery receipts → `notifications.state` |
| GET | `/admin/dashboard?from&to` | aggregates from `v_admin_daily`, `v_no_show_loss`, `v_referral_flow` |
| GET | `/admin/export?view=` | CSV/PDF (audited) |
| GET | `/hospital/setup` | hospital_admin. Everything `S-B-11` draws, for the administrator's own facility (step 22). No path in this group names a facility: it comes off the principal (`FR-ROLE-01`) |
| PATCH | `/hospital/profile`, `/hospital/rules` | hospital_admin. Names, address, phones, coordinates (both or neither); the queue rules and the SMS budget (`FR-QUE-20`, `FR-QUE-21`, `FR-OFF-04`, `FR-NOT-06`) |
| POST, PATCH | `/hospital/departments`, `/hospital/departments/:id` | hospital_admin. A code twice is `SETTINGS_DUPLICATE` |
| POST, PATCH | `/hospital/doctors`, `/hospital/doctors/:id` | hospital_admin. A BMDC number already known links that doctor rather than making a second. Names and degrees change only while unverified and sat nowhere else (`FR-SUP-02`); a fee or room change reaches chambers still scheduled from today, never a booking already made (DB-P5) |
| POST, DELETE | `/hospital/templates`, `/hospital/templates/:id` | hospital_admin. Adding a weekly chamber writes its sessions at once (§8); an overlap with the doctor's own is `SETTINGS_DUPLICATE`. Removing one removes its future chambers nobody booked and reports how many booked ones stayed |
| POST | `/hospital/wards`, `/hospital/beds` | hospital_admin. Beds come several at a time and start `out_of_service` with the reason code `setup:unconfirmed`, so no public count includes a bed the ward has not looked at; the ward brings each into service from the board |
| PATCH | `/hospital/beds/:id` | hospital_admin. Label and nightly charge |
| PUT | `/hospital/capabilities` | hospital_admin. The kinds this facility offers (`FR-EMG-05`). A newly offered kind starts unavailable; whether it is available now is `PUT /hospitals/:id/capabilities`, which refuses a kind never declared |
| POST, PATCH | `/hospital/staff`, `/hospital/staff/:id` | hospital_admin (`FR-ADM-11`). Creating answers with a temporary password, once; roles are the facility's seven, never `platform_admin` or `gov_viewer`. Deactivating or changing roles ends the account's refresh tokens. An administrator cannot deactivate themself or drop their own `hospital_admin` (`SETTINGS_NOT_ALLOWED`) |
| POST | `/hospital/staff/:id/reset-password` | hospital_admin. A new temporary password; not for one's own account |
| POST | `/hospital/staff/:id/reset-2fa` | hospital_admin (step 28). Turns the second factor off for a lost phone and ends every session; not for one's own account (`own_two_factor`). Audited (`two_factor_reset`). A facility's only administrator is reset on the server with `pnpm staff:reset-2fa --email … [--hospital-code …]`, audited with no actor |
| POST | `/hospital/go-live` | hospital_admin. Sets `is_live` and `onboarded_at`; refused while there is no department or no active doctor. Doctors still appear only once verified |
| GET | `/hospital/imports/templates/:set` | hospital_admin. The CSV template for a set: header row, then one example row marked as an example (`FR-IMP-09`) |
| POST | `/hospital/imports` | hospital_admin. `{set, fileName, csv}` — the file as UTF-8 text, at most 5 MB, no multipart dependency. Checks every row and writes nothing but the batch and its rows (`FR-IMP-05`) → the preview |
| GET | `/hospital/imports`, `/hospital/imports/:id` | hospital_admin. History, and one batch's counts and error rows |
| POST | `/hospital/imports/:id/commit` | hospital_admin. All or nothing (`FR-IMP-06`); a batch not in `checked` is `IMPORT_STATE` |
| POST | `/hospital/imports/:id/undo` | hospital_admin. Refused with the blocking rows while anything outside the batch refers to them (`FR-IMP-07`) |
| POST | `/hospital/imports/:id/discard` | hospital_admin. Drops a checked batch and its rows |
| CRUD | `/platform/hospitals`, `/platform/verify-doctor`, `/platform/flags`, `/platform/subscriptions` | platform_admin |
| GET | `/gov/capacity`, `/gov/er-load`, `/gov/signals`, `/gov/benchmarks` | gov_viewer, aggregate only (`FR-GOV-06`). No parameters: no hospital, no patient, no range to widen. Guarded by `requireNationalRole('gov_viewer')`, which admits a `national` principal and nothing else — the mirror of every hospital route, which refuses that kind. Each read runs read-only as the `gov_reader` database role (DATABASE.md §5), and the payload is walked for identifiers before it is sent (`findIdentifiers`). `/gov/benchmarks` is `FR-GOV-04`, which `S-B-13` shows and this table had not yet routed |

---

## 8. `backend/workers` — background jobs

```
backend/workers/src/
├── index.ts                     # pg-boss subscriber registration
├── jobs/
│   ├── notify.send.ts           # renders template, picks channel, calls adapter, records result
│   ├── notify.retry.ts          # backoff for failed sends
│   ├── queue.autoNoShow.ts      # marks no-shows past grace (FR-QUE-20)
│   ├── queue.leaveNow.ts        # fires leave-home alerts (FR-PAT-32)
│   ├── queue.twoAway.ts         # "two patients away" notices
│   ├── offers.expire.ts         # expires unaccepted slot offers
│   ├── sessions.materialise.ts  # nightly: templates → tomorrow's sessions
│   ├── sessions.autoEnd.ts      # closes stale running sessions
│   ├── beds.staleCheck.ts       # flags hospitals whose capacity data is stale (FR-OFF-04)
│   ├── reports.deliver.ts       # pushes ready reports into wallets
│   ├── followups.remind.ts      # follow-up + medicine reminders
│   ├── analytics.refresh.ts     # refreshes v_admin_daily every 5 min
│   ├── invoices.generate.ts     # monthly hospital invoices
│   └── retention.enforce.ts     # applies DATABASE.md §8 retention rules
└── cron.ts                      # schedule table
```

**In the pilot** (`CLAUDE.md` §4.2) one job runs, with no scheduler dependency, **inside the API process** rather than in `backend/workers`: `sessions.materialise` (`services/sessionMaterialise.service.ts`) at start-up and then hourly, writing `sessions` for today and the next seven days (`MATERIALISE_DAYS` = 8) from `session_templates`, and once more straight after `POST /hospital/templates`. `backend/workers` has no database access yet and a single Bangladeshi server runs one API, so a second process would be a second deployment for one query. It inserts `ON CONFLICT DO NOTHING` against `sessions_template_date_key` (0028), so running it twice, from two processes, or after a missed night is harmless. It skips an inactive doctor and a removed schedule. `SESSION_MATERIALISE=false` switches it off in a process that must never write. The same hourly tick (`services/jobs.service.ts`) clears `import_rows.raw` 30 days after a batch closes (`FR-IMP-08`, step 24), and clears the words of `notifications` older than 90 days (`DATABASE.md` §8; plan 1.9), which is the one rule `retention.enforce` applies so far. The rest of this table waits for pg-boss.

**What a message leaves behind.** A tracking or status link is a credential (`FR-GST-05`). It is composed into the text that is sent and into nothing that is kept: every outbox row is written by one function (`notification.service` `writeOutbox`), which stores the words with `{link}` where the link went, and the table refuses a stored link (`DATABASE.md` §2.7). No SMS provider prints or logs a number or a text; `SMS_PROVIDER=log` writes one line per message naming the notification and its template.

**Schedule**

| Job | Cadence |
|---|---|
| `sessions.materialise` | 02:00 daily |
| `analytics.refresh` | every 5 min |
| `queue.autoNoShow`, `queue.twoAway`, `queue.leaveNow` | every 60 s during open sessions |
| `offers.expire` | every 30 s |
| `beds.staleCheck` | every 5 min |
| `notify.retry` | every 2 min |
| `invoices.generate` | 1st of month |
| `retention.enforce` | weekly |

**Notification mapping (event → template → channels)**

| Trigger | Template key | Channels |
|---|---|---|
| Booking created | `booking.confirmed` | push + SMS |
| `DOCTOR_ARRIVED` | `queue.doctor_arrived` | push + SMS |
| `DELAY_DECLARED` | `queue.delayed` | push + SMS |
| Two away | `queue.two_away` | push + SMS |
| `PATIENT_CALLED` | `queue.called` | push + SMS |
| `PATIENT_NO_SHOW` | `queue.no_show` | SMS |
| `SLOT_OFFERED` | `queue.slot_offer` | push + SMS |
| Report ready | `lab.report_ready` | push |
| Bed request held | `bed.request_held` | push + SMS — names the hospital, the kind of bed and when the hold runs out; exempt from quiet hours, because a hold is measured in minutes |
| Bed request declined | `bed.request_declined` | push + SMS — says what to do next, and never claims the hospital is full |
| ER acknowledged an alert | `emergency.acknowledged` | push + SMS, only when a number was left — names the hospital, never the problem; exempt from quiet hours and from the SMS budget |
| ER declined an alert | `emergency.declined` | as above, linking to `S-A-10c`, where the reason is |
| Follow-up due | `care.followup` | push |

All templates exist in `bn` and `en` (`FR-NOT-04`); the recipient's `locale` picks one at send time.

---

## 9. Errors

`errors/codes.ts` — stable string codes the client maps to Bangla copy.

| Code | HTTP | Meaning |
|---|---|---|
| `AUTH_OTP_RATE_LIMIT` | 429 | too many OTP requests |
| `AUTH_OTP_INVALID` | 401 | wrong/expired code |
| `AUTH_FORBIDDEN_SCOPE` | 403 | staff outside hospital scope |
| `AUTH_INVALID_CREDENTIALS` | 401 | staff email or password wrong — one answer for both, so an address cannot be tested for existence |
| `AUTH_LOCKED` | 423 | five consecutive failures; `details.until` says when it opens |
| `AUTH_HOSPITAL_REQUIRED` | 409 | the email exists at more than one facility; ask for the hospital code |
| `AUTH_PASSWORD_WEAK` | 422 | a new staff password shorter than 10 characters or the same as the old one |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | the token was issued on a password an administrator set; only the password change is open |
| `AUTH_2FA_INVALID` | 401 | the second-factor code is wrong, too old or already used; counts towards `AUTH_LOCKED` (step 28) |
| `AUTH_2FA_SETUP_REQUIRED` | 403 | an administrator without a second factor; only its setup is open (step 28) |
| `AUTH_2FA_ALREADY_ON` | 409 | setting up a second factor that is on; an administrator resets it first (step 28) |
| `SETTINGS_DUPLICATE` | 409 | a department code, a doctor already in that department, an overlapping weekly chamber, a bed label, an email or a staff code already exists at this facility; `details.field` says which (and `details.labels` for beds) |
| `SETTINGS_NOT_ALLOWED` | 422 | a settings change the rules refuse; `details.reason` is `own_access`, `own_password`, `own_two_factor`, `doctor_verified`, `doctor_shared` or `nothing_to_publish` |
| `IMPORT_FILE` | 422 | the file cannot be read as the set at all — empty, an unclosed quote, the template's columns missing (`details.columns`), more than 20,000 rows; refused before any batch exists |
| `PAYLOAD_TOO_LARGE` | 413 | a body over its route's limit: 256 KB, or the report (14 MB) and import (6 MB) routes' own |
| `IMPORT_STATE` | 409 | the batch is not in the state that action needs |
| `IMPORT_UNDO_BLOCKED` | 409 | rows outside the batch refer to its rows; `details.blocking` lists them |
| `GUEST_LINK_EXPIRED` | 410 | tracking link past expiry |
| `BOOKING_SLOT_TAKEN` | 409 | serial no longer available |
| `BOOKING_DUPLICATE` | 409 | same patient, same doctor, same day |
| `QUEUE_CONFLICT` | 409 | another counter already advanced |
| `QUEUE_GUARD_FAILED` | 422 | rule violation (e.g. no-show before grace) |
| `QUEUE_EVENT_DUPLICATE` | 200 | idempotent replay — returns stored result |
| `PAYMENT_FAILED` | 402 | provider declined |
| `PAYMENT_UNAVAILABLE` | 422 | an online method on a deployment with `PAYMENT_PROVIDER=off`; refused before the booking is written (step 26) |
| `CONSENT_REQUIRED` | 403 | doctor lacks record consent |
| `CAPACITY_STALE` | 200 + flag | data returned but marked stale |
| `BED_TRANSITION_INVALID` | 422 | the bed's state does not allow that action (the shared `canApply` guard); `details.guard` names the rule |
| `BED_CONFLICT` | 409 | another change got there first: the patient is already in a bed, or the request was already answered |
| `EMERGENCY_TRANSITION_INVALID` | 422 | the case's state does not allow that action (`canActOn`); `details.guard` names the rule |
| `REFERRAL_TRANSITION_INVALID` | 422 | the referral's state does not allow that step, or the case cannot be referred now (`canActOnReferral`, `canRefer`); `details.guard` names the rule |
| `VALIDATION_FAILED` | 400 | zod details attached |

Rule: an error never returns a raw SQL or provider message to a client.

---

## 10. Environment variables

```
NODE_ENV, PORT, API_BASE_URL, WEB_BASE_URL
DATABASE_URL, DATABASE_POOL_MAX
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET   # only with STORAGE_PROVIDER=supabase
STORAGE_PROVIDER=mock|local|supabase, STORAGE_DIR   # local: files on this server's disk (step 26)
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL=15m, JWT_REFRESH_TTL=30d
GUEST_LINK_SECRET, GUEST_LINK_TTL_DAYS=30
GUEST_BOOKING_OTP=true|false # a guest proves the phone before booking (FR-GST-03); unset: on unless DEMO_MODE
OTP_TTL_SECONDS=300, OTP_MAX_PER_HOUR=5
EXTRA_ALLOWED_ORIGINS=      # comma-separated exact origins the API also answers (a hospital's portal, a branded app's web origin); empty by default (FR-BRD-04)
ADDRESS_RATE_LIMIT_FACTOR=1 # 1–100: multiplies every limit keyed on the caller's address, for a deployment whose callers share one; never the per-number limits
SMS_PROVIDER=local|log, SMS_API_KEY, SMS_SENDER_ID, SMS_MONTHLY_CAP
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
PAYMENT_PROVIDER=mock|live|off, BKASH_*, NAGAD_*   # off: pay at the hospital only (step 26)
TRAVEL_TIME_MODE=static|api, MAPS_API_KEY
STALE_THRESHOLD_MINUTES=10
SENTRY_DSN, LOG_LEVEL
DEMO_MODE=true|false        # true seeds/reset allowed, mock payments, banner in UI
SESSION_MATERIALISE=true    # write each day's chambers from the weekly schedules (§8)
STORAGE_PROVIDER=mock|supabase|local, STORAGE_LOCAL_DIR   # local: a disk volume (§12b)
STAFF_LOCKOUT_ATTEMPTS=5, STAFF_LOCKOUT_MINUTES=15
TOTP_ENCRYPTION_KEY         # staff second factors (step 28); required in production, derived from JWT_REFRESH_SECRET elsewhere
```

`env.ts` validates all of these with zod at boot and refuses to start if any required key is missing.

---

## 11. Testing

| Layer | Tool | Must cover |
|---|---|---|
| Domain | Vitest | reducer against every event type; replay determinism (random event sequences → same state); ETA maths; late re-insertion; grace rules |
| Repos | Vitest + test DB | serial allocation under concurrency; append-only enforcement |
| API | Supertest | every endpoint's auth matrix (patient / guest / each staff role / wrong hospital) |
| Realtime | Socket.IO test client | resume-from-seq, room scoping |
| Sync | Vitest | offline batch replay, idempotency, conflict responses |
| E2E | Playwright | **two-device queue test**: console taps next → patient page updates < 2 s; guest booking via SMS link; no-show → offer → accept |

CI gates: typecheck, lint (layering rule), unit, API, one E2E smoke, and `db:verify`.

---

## 12. Deployment

| Piece | Where | Notes |
|---|---|---|
| `backend/api` | Render web service | health `/healthz`, readiness `/readyz`, autoscale on CPU |
| `backend/workers` | Render background worker | separate service, same image |
| Database | Supabase Postgres | daily backups, PITR on paid tier |
| Storage | Supabase Storage | private buckets, signed URLs only |
| `frontend/patient` / `console` / `site` | Vercel | separate projects, same monorepo |
| Migrations | CI step before API deploy | forward-only, never destructive in one release |

**Rollout rule:** schema change → deploy migration → deploy API → deploy clients. Never reverse.

### 12b. Self-hosted in Bangladesh (pilot, step 26)

A deployment holding real patients runs in Bangladesh (`PRD.md` `FR-SEC-07`). **Since 2026-10-05 the default is one shared platform there, with every hospital a workspace inside it**; a hospital's own server room is an exception for a later day. This stack is the same either way — it is what runs on the machine, whoever's machine it is — and what a shared one still needs before a second real hospital is in it is `FR-SEC-11` (`PLATFORM_PLAN.md` 1.10): today hospitals are kept apart by the API's checks, not by the database. The same repository, packaged as containers:

Built in step 26 as `deploy/docker-compose.yml` from the root `Dockerfile`; one command starts it:

| Container | What |
|---|---|
| `db` | PostGIS 16 (the image the schema's extensions need), data on a named volume |
| `migrate` | one-shot `pnpm db:migrate && pnpm db:role` on every `up`, as the database's owner; the API waits for it to succeed. The second command creates the role the API connects as and puts it back to exactly its privileges (`DATABASE.md` §5.1) |
| `api` | `backend/api`, `NODE_ENV=production`, `DEMO_MODE=false`, files on a named volume (`STORAGE_PROVIDER=local`), and the hourly jobs (§8) — there is no separate `workers` container while `backend/workers` has nothing to run. Connects as `API_DB_USER`, never as the owner; runs as `node`, not root; its container health is `/readyz`, so it is unhealthy while it cannot reach the database |
| `patient`, `console` | the two Next.js apps, built with the API's address baked in; run as `node`, start once the API is healthy |
| `web` | Caddy: three names (patient app, console, API), certificates obtained and renewed on their own, the realtime socket upgraded through |
| `backup` | nightly `pg_dump` and a tarball of the file volume into `deploy/backups`; the dump is restored into a scratch database to prove it restores, both are copied to `BACKUP_SECOND_DIR` and checksummed there, and the last `BACKUP_KEEP_DAYS` are kept in both. The result of each run is the container's health (`backup.sh check`); `restore.sh` puts one back |

Until merchant accounts and an SMS aggregator exist it runs `PAYMENT_PROVIDER=off` (pay at the hospital only; the patient app asks `GET /config` and offers nothing else) and `SMS_PROVIDER=log`. Production's boot checks accept both, and no longer demand Sentry or VAPID keys that nothing uses yet. `DEPLOY.md` Part S is the runbook. Every container's log rotates (five files of ten megabytes). There is still no alert: the health of each service is there to be read with `docker compose ps`, and nothing sends it anywhere.

---

## 13. Build order for Claude Code

1. `db/migrations` 0001–0006 + `shared/domain` (types, reducer, eta, rules) with unit tests. **Nothing else until the reducer is green.**
2. `backend/api`: env, db, auth, guest, discovery, booking, queue service + queue routes, realtime.
3. `frontend/console`: reception console wired to queue endpoints, offline queue, optimistic reducer.
4. `frontend/patient`: booking flow, guest flow, live serial screen on the session channel.
5. **Checkpoint:** run the two-device Playwright test. If it passes, the product exists.
6. Then: clinical, beds, emergency, referrals, lab, pharmacy, payments, admin, platform, gov — in that order.

---

*End of `BACKEND.md`. Build set complete: `PRD.md` (what), `APP_FLOW.md` (screens and wiring), `FRONTEND.md` (look and client), `DATABASE.md` (schema), `BACKEND.md` (services).*
