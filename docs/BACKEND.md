# Backend Document

## National Healthcare Platform — Bangladesh

**Document:** `BACKEND.md` — part of the build set (`PRD.md`, `APP_FLOW.md`, `FRONTEND.md`, `DATABASE.md`, **`BACKEND.md`**)
**Version:** 1.0
**Purpose:** every service, every file, every endpoint, every event, every worker — and what each one connects to. Claude Code should never have to guess where something lives.

---

## 0. Stack decisions (fixed)

| Concern | Choice | Why |
|---|---|---|
| Runtime | **Node.js 20 + TypeScript (strict)** | Shared domain types with the frontend |
| HTTP | **Express 5** | Familiar, boring, fine at this scale |
| Database | **PostgreSQL (Supabase)** | See `DATABASE.md` |
| DB access | **Kysely** (typed query builder) + raw SQL for hot paths | No heavy ORM hiding the event log |
| Realtime | **Socket.IO** over WebSocket | Rooms map cleanly to sessions and hospitals; auto-reconnect built in |
| Background jobs | **pg-boss** (Postgres-backed) | No Redis dependency at launch; Upstash Redis + BullMQ only if load demands |
| Validation | **Zod**, schemas shared with the client | One contract, both sides |
| Auth | JWT access (15 min) + refresh (30 days), Argon2id for staff passwords | |
| Files | Supabase Storage (reports, prescriptions, uploads) | Signed URLs only |
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
│   ├── auth.ts                  # verifies JWT → req.principal {kind, id, hospitalId, roles}
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
│   ├── gov.service.ts           # aggregate-only queries
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
│   └── analytics.repo.ts
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
10. **Broadcast** — `realtime/emit.ts` publishes `queue.updated` to `session:<id>` with `{ seq, state, etas, serverTs }` (≤ 2 s end-to-end, `NFR-01`).
11. **Notify** — publish notification jobs per §6 mapping (called, delayed, two-away, slot offered).
12. **Audit** — write `audit_log` with actor and event.
13. **Return** — new state + ETAs so the caller's optimistic UI can reconcile.

**Undo (`GR-02`)** appends `ACTION_UNDONE` referencing the original event; the reducer treats the pair as a no-op. History is never deleted.

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
- `SY-05` Batch response shape: `{ accepted: [{clientEventId, seq}], conflicts: [{clientEventId, reason, currentState}], state, etas }`.
- `SY-06` A device offline longer than 24 h is forced to a full session re-pull rather than a delta.

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

**Handshake:** JWT (staff/patient) or a guest-link token. A socket may only join rooms its principal is scoped to. **Resume:** client sends `lastSeq`; server replays missed events from `queue_events` before streaming live (`SY-01`).

**Payload envelope (all events):**
```ts
{ type: string, seq?: number, serverTs: string, data: unknown }
```

---

## 7. HTTP API

Base: `/api/v1`. All responses: `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`.

### 7.1 Auth & guest

| Method | Path | Auth | Body → Result | Notes |
|---|---|---|---|---|
| POST | `/auth/otp` | none | `{phone}` → `{ttlSeconds}` | rate-limited (`FR-SEC-05`) |
| POST | `/auth/verify` | none | `{phone, code}` → `{access, refresh, isNew}` | |
| POST | `/auth/refresh` | refresh | → `{access}` | |
| POST | `/auth/logout` | user | | revokes |
| POST | `/staff/login` | none | `{hospitalCode, email, password}` → `{access, refresh, roles, requires2fa}` | |
| POST | `/staff/2fa` | partial | `{code}` → tokens | |
| POST | `/guest/start` | none | `{phone, name}` → `{needsOtp, guestToken?}` | returning guest skips OTP (`FR-GST-12`) |
| POST | `/guest/verify` | none | `{phone, code}` → `{guestToken}` | creates no account (`FR-GST-04`) |
| GET | `/guest/link/:token` | link | → `{booking, session, queueState, etas, record}` | powers the SMS tracking link (`FR-GST-05`); `record` is that booking's signed visit once there is one, else null (`FR-GST-08`) |
| POST | `/guest/claim` | user | `{phone}` → `{claimable: […]}` then `{confirm:true}` | (`FR-GST-09`) |

### 7.2 Discovery (public, no auth)

| Method | Path | Result |
|---|---|---|
| GET | `/hospitals?lat&lng&district&q&bedKind` | list + live capacity from `v_public_hospital_capacity`; `bedKind` keeps hospitals that have that kind of bed, full or not (`S-A-11`) |
| GET | `/hospitals/:id` | detail + departments + capabilities + beds summary |
| GET | `/doctors?specialty&hospitalId&q&availableToday` | list + live status |
| GET | `/doctors/:id` | detail + upcoming sessions |
| GET | `/sessions/:id/availability` | serials taken/total, expected wait |
| GET | `/specialties` | catalogue |

### 7.3 Booking

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/bookings` | user \| guest | Idempotency-Key required; allocates serial via `fn_next_serial`; emits `queue.updated`; queues confirmation SMS (`FR-PAT-20`) |
| GET | `/bookings/:id` | owner \| staff | |
| GET | `/me/bookings?scope=today\|upcoming\|past` | user \| guest | |
| POST | `/bookings/:id/cancel` | owner \| staff | appends `BOOKING_CANCELLED`, triggers refund eligibility |
| POST | `/bookings/:id/reschedule` | owner \| staff | cancels + creates in one transaction |
| POST | `/bookings/:id/late` | owner | appends `PATIENT_LATE` (`FR-PAT-33`) |
| POST | `/sessions/:id/standby` | none (guest details) | joins a **full** chamber's list; Idempotency-Key required, rate-limited per address; optional `prepay` method charges the fee against the standby row (`FR-PAT-25`, `FR-PAT-26`). Returns the status token |
| GET | `/standby/:token` | the token | `S-A-08s`: waiting / offered / seated / left; records lapsed offers as it answers; mints the seat's tracking link once |
| POST | `/standby/:token/accept` | the token | yes to the open offer; books the chair and pays for it with the chosen method (`FR-PAT-27`) |
| POST | `/standby/:token/decline` | the token | no; `SLOT_EXPIRED`, then the slot is offered to the next patient (`FR-QUE-30`) |
| POST | `/standby/:token/leave` | the token | off the list; a prepayment is marked owed (`standby_unseated`) |
| POST | `/offers/:id/accept` | receptionist | a yes rung in to the counter (`FR-REC-30`) — see §7.4 |

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
| POST | `/sessions/:id/walkin` | receptionist | `WALKIN_ADDED` |
| POST | `/sessions/:id/reorder` | receptionist | `PRIORITY_REORDERED` (reason required) |
| GET | `/sessions/:id/standby` | receptionist, hospital_admin | — (who is waiting and what was offered, no phone numbers; records any lapsed offer as `SLOT_EXPIRED` as it answers) |
| POST | `/bookings/:id/offer-slot` | receptionist | `SLOT_OFFERED` — `BTN-B02-OFFER`: the freed chair to the next person on the standby list, ten-minute window (`FR-QUE-30`, `FR-REC-30`) |
| POST | `/events/:id/undo` | actor, ≤ 10 s | `ACTION_UNDONE` |
| POST | `/sessions/:id/end` | receptionist | `SESSION_ENDED` |

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
| POST | `/bed-requests` | none (guest details in the body, as `POST /bookings`) | (`FR-PAT-52`); returns a signed status token (`bed_request` audience), idempotent on the key and on one open request per patient per hospital |
| GET | `/bed-requests/track/:token` | the token | the family's status; a lapsed hold reads `expired` at once |
| POST | `/bed-requests/:id/respond` | ward | `hold` (reserves a real bed of the kind asked for), `confirm` (admits), `decline`; hold and decline send `bed.request_held` / `bed.request_declined` |

Bed writes return `{ beds, published, duplicate, serverTs }`: the beds as they now stand and the view's row read back after commit, so a console can reconcile without waiting for the broadcast. A replayed `clientEventId` returns the same shape with `duplicate: true` (SY-02). A lapsed hold on a bed about to be acted on is released first, by nobody, so every decision is taken against the bed's real state.

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
| POST | `/visits` | doctor — creates or updates the visit; `sign: true` signs it and advances the queue (`FR-DOC-08`). Prescriptions are out of scope for this version (`PRD.md` §9) |
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
| GET | `/bookings/:id/payments` | what was charged against one booking |
| POST | `/payments/:id/refund` | hospital_admin. **The amount is not in the body either** — the *reason* picks the rule and `refundFor` computes it (`FR-PAY-03`). `FR-PAY-07`'s automatic eligibility does not come through here: it is raised when a session ends |
| GET | `/hospitals/:id/settlement?from=&to=` | hospital_admin (`FR-PAY-05`) |
| POST | `/webhooks/bkash` \| `/nagad` | **no token**: a provider holds none of ours, so the signature over the raw body *is* the authentication. Answers 200 for a replay, because a 4xx makes a provider retry something already done |
| POST | `/webhooks/sms-dlr` | delivery receipts → `notifications.state` |
| GET | `/admin/dashboard?from&to` | aggregates from `v_admin_daily`, `v_no_show_loss`, `v_referral_flow` |
| GET | `/admin/export?view=` | CSV/PDF (audited) |
| CRUD | `/hospital/doctors`, `/hospital/sessions`, `/hospital/templates`, `/hospital/beds`, `/hospital/staff`, `/hospital/settings` | hospital_admin |
| CRUD | `/platform/hospitals`, `/platform/verify-doctor`, `/platform/flags`, `/platform/subscriptions` | platform_admin |
| GET | `/gov/capacity`, `/gov/er-load`, `/gov/signals` | gov_viewer, aggregate only (`FR-GOV-06`) |

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
| `GUEST_LINK_EXPIRED` | 410 | tracking link past expiry |
| `BOOKING_SLOT_TAKEN` | 409 | serial no longer available |
| `BOOKING_DUPLICATE` | 409 | same patient, same doctor, same day |
| `QUEUE_CONFLICT` | 409 | another counter already advanced |
| `QUEUE_GUARD_FAILED` | 422 | rule violation (e.g. no-show before grace) |
| `QUEUE_EVENT_DUPLICATE` | 200 | idempotent replay — returns stored result |
| `PAYMENT_FAILED` | 402 | provider declined |
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
SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_STORAGE_BUCKET
JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL=15m, JWT_REFRESH_TTL=30d
GUEST_LINK_SECRET, GUEST_LINK_TTL_DAYS=30
OTP_TTL_SECONDS=300, OTP_MAX_PER_HOUR=5
SMS_PROVIDER=local|log, SMS_API_KEY, SMS_SENDER_ID, SMS_MONTHLY_CAP
VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
PAYMENT_PROVIDER=mock|live, BKASH_*, NAGAD_*
TRAVEL_TIME_MODE=static|api, MAPS_API_KEY
STALE_THRESHOLD_MINUTES=10
SENTRY_DSN, LOG_LEVEL
DEMO_MODE=true|false        # true seeds/reset allowed, mock payments, banner in UI
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
