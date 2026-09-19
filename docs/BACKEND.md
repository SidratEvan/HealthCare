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
├── emergency/
│   ├── ranking.ts               # capability → travel time → load → beds (FR-PAT-43)
│   └── freshness.ts             # staleness thresholds and labels (FR-OFF-03..04)
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
│   ├── maps/traveltime.ts       # static matrix in v0, routing API later
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
| `hospital:<id>:beds` | ward board, ER console, admin | `bed.updated`, `capacity.updated` |
| `hospital:<id>:emergency` | ER console | `emergency.inbound`, `emergency.updated`, `referral.incoming` |
| `hospital:<id>:lab` | lab console | `test.ordered`, `test.updated` |
| `hospital:<id>:admin` | admin dashboard | `metrics.tick` (throttled 30 s) |
| `patient:<patientId>` | that patient's devices | `record.ready`, `booking.updated`, `offer.received`, `bedrequest.updated` |
| `referral:<id>` | both hospitals | `referral.updated` |

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
| GET | `/guest/link/:token` | link | → `{booking, session, queueState, etas}` | powers the SMS tracking link (`FR-GST-05`) |
| POST | `/guest/claim` | user | `{phone}` → `{claimable: […]}` then `{confirm:true}` | (`FR-GST-09`) |

### 7.2 Discovery (public, no auth)

| Method | Path | Result |
|---|---|---|
| GET | `/hospitals?lat&lng&district&q` | list + live capacity from `v_public_hospital_capacity` |
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
| POST | `/sessions/:id/standby` | user \| guest | joins standby list |
| POST | `/offers/:id/accept` | user \| guest | (`FR-QUE-30`) |

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
| POST | `/sessions/:id/walkin` | receptionist | `WALKIN_ADDED` |
| POST | `/sessions/:id/reorder` | receptionist | `PRIORITY_REORDERED` (reason required) |
| POST | `/events/:id/undo` | actor, ≤ 10 s | `ACTION_UNDONE` |
| POST | `/sessions/:id/end` | receptionist | `SESSION_ENDED` |

### 7.5 Emergency, beds, referrals

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/emergency/search?lat&lng&problem` | none | ranked by `domain/emergency/ranking.ts` (`FR-PAT-43`) |
| POST | `/emergency/inbound` | none \| guest | anonymous allowed; emits `emergency.inbound` (`FR-GST-03`) |
| POST | `/emergency/cases/:id/acknowledge` | emergency | patient sees "hospital ready" |
| POST | `/emergency/cases` | emergency | walk-in ER registration |
| PATCH | `/emergency/cases/:id` | emergency | triage, state |
| PUT | `/hospitals/:id/capabilities` | emergency, admin | publishes to network (`FR-EMG-05`) |
| POST | `/referrals` | emergency | send (`FR-EMG-08`) |
| POST | `/referrals/:id/accept` \| `/decline` | emergency | reason required on decline |
| GET | `/hospitals/:id/beds` | staff | board data |
| POST | `/beds/:id/admit` \| `/discharge` \| `/transfer` \| `/reserve` \| `/oos` | ward | writes `bed_events`, emits `capacity.updated` |
| POST | `/bed-requests` | user \| guest | (`FR-PAT-52`) |
| POST | `/bed-requests/:id/respond` | ward | hold / confirm / decline |

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
| POST | `/consents` / `/consents/:id/revoke` | patient |
| POST | `/consents/qr` | doctor — redeems a scanned QR (`FR-PAT-63`) |
| POST | `/documents` | patient — paper upload |
| POST | `/test-orders` | doctor \| patient booking |
| PATCH | `/test-orders/:id/state` | lab |
| POST | `/test-orders/:id/report` | lab — upload → delivers to wallet (`FR-LAB-03`) |
| POST | `/prescriptions/:id/dispense` | pharmacy |

### 7.7 Payments, admin, platform, gov, webhooks

| Method | Path | Notes |
|---|---|---|
| POST | `/payments/intent` | returns provider redirect/token; idempotent |
| POST | `/payments/:id/refund` | admin or automatic on doctor absence (`FR-PAY-07`) |
| POST | `/webhooks/bkash` \| `/nagad` | signature-verified, idempotent |
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
| Bed request answered | `bed.request_result` | push + SMS |
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
