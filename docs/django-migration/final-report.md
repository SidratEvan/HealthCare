# Django migration — final acceptance report

Branch `migration/django-drf` (worktree `D:\Projects\HealthCare-django`),
based on `c550343` (the console redesign, its safety fixes and the MARKS
readiness work). Measured on 19 October 2026, on one Windows 11 development
machine, against local databases only. Nothing was merged, pushed or
deployed; `main`, `mvp`, `demo` and the public Supabase database were not
touched (CLAUDE.md §4.6).

Companion documents: `architecture.md` (how the Django API is built),
`compatibility-matrix.md` (what proves each part of the contract),
`spy-tests.md` (the Node cases that cannot see Django, and their pytest
equivalents), `frontend-js.md` (the JavaScript conversion), `deployment.md`
(running it), `PROGRESS.md` (milestone log).

## Recommendation

<!-- RECOMMENDATION -->

## 1. Features migrated

Every router the Node API mounts, in its order, with every route
(`tests/unit/test_route_table.py` reads the TypeScript and requires the same
table), and every background job.

| Brief's module | Django | Evidence |
|---|---|---|
| Patient booking, guest booking, serial management | `booking`, `links`, `queue` services | `booking.routes`, `bookingRetry`, `myBookings`, `queue.routes`, `queueConflict` |
| Reception and live queue | queue service, realtime | `queue.routes`, `sync.routes`, `receptionSafety`, `realtime`, the canary |
| Doctor consultations, signed visit records | clinical service | `clinical.routes`, `doctorSafety` (+ pytest), `prescriptions` |
| Ward, beds, transfers, discharge | beds service | `bed.routes` |
| Emergency intake and referrals | emergency, referral services | `emergency.routes`, `referral.routes` |
| Laboratory orders, processing, report uploads | lab service, storage adapter | `lab.routes`, `labPharmacySafety` (+ pytest) |
| Pharmacy stock and availability | pharmacy service | `lab.routes`, `labPharmacySafety` |
| Hospital administration and reporting | admin, settings services | `admin.routes`, `adminOverview`, `adminChambers`, `hospitalSettings`, `hospitalDesks` |
| Platform onboarding, registration, imports | platform, registration, import services | `platform.routes`, `orgApplication`, `registration.routes`, `import.routes`, `importMapping` |
| Notifications, SMS adapters, payments | sender, SMS and payment adapters | `notifications`, `smsDelivery`, `payment*`, `providers`, `test_sms_redaction.py` |
| National aggregated reporting | gov service as `gov_reader` | `gov.routes` |
| Authentication, permissions, consent, audit | staff and patient auth, consent, audit | `staffAuth.routes`, `patientAuth.routes`, `consent.routes`, `tenantScope`, `test_staff_auth_races.py` |

The frontends (patient app, staff console, company site) and their two
browser packages were converted to JavaScript (`frontend-js.md`).

## 2. Incomplete or blocked

- **Real providers**: SMS aggregator, bKash, Nagad. The adapters are ported
  and tested against stand-ins, as on the Node side; switching one on waits
  for the provider's account (CLAUDE.md §4.6). Not verified against a real
  provider.
- **The schema tool and `staff:create` stay Node.** The database's
  migrations are the SQL ledger applied by `pnpm db:migrate`; Django owns no
  table. A Python runner over the same ledger was not written: the Node one
  works and is what the stack runs.
- **Not run against Django:** the production browser configuration
  (`playwright.prod.config.ts`: built apps, `DEMO_MODE=false`, the limited
  database role) and the built-console configuration. The Docker smoke test
  ran the image in production mode against the local test database, not the
  whole compose stack.
- **`shared/domain` and `shared/i18n` stay TypeScript** (the Node API and the
  parity vectors use them), as do the browser specs and the Node API itself.

## 3. API compatibility

- **Route table**: identical to the Node API's, route for route and in
  order, probes included.
- **The original Node suite, unchanged, against the Django server**: 1,925
  of 1,935 cases on a clean full run (77 files). The 10 others are the cases
  that replace a function inside the Node process (`vi.spyOn`), which the
  Django server never runs; each has a pytest equivalent that injects the
  same failure into the Python module, and all pass.
- Error envelope, codes, status codes, headers (security headers, CORS,
  idempotency) and JSON shapes are asserted by that suite.

## 4. WebSocket compatibility

python-socketio speaks the Socket.IO protocol the frontends'
`socket.io-client` already uses, so no client code changed for it. Rooms,
the resume handshake (`session:subscribe` with `lastSeq` and unanswered
keys), acknowledgements, authorisation and revocation sweeps are covered by
`realtime.test.ts` and the socket cases of the Node suite, all passing.

**The two-device canary** (`e2e/two-device-queue.spec.ts`, reception taps
*next*, the patient's phone updates in under 2 s): 5/5 against Django with
the TypeScript frontends, and <!-- CANARY-JS --> with the JavaScript
frontends.

## 5. Database compatibility

- Same database, same schema (`database/migrations`, 0001–0063), no ORM
  migrations, no table owned by Django. Triggers, views, the append-only
  `queue_events` and row-level security are untouched.
- Every statement states `app.scope`, `app.hospital_id`, `app.person_id`
  and `app.booking_id` first (`core/db.py`), as the Node API does; the API
  connects as the limited `healthcare_api` role; the national layer reads as
  `gov_reader`. `tenantScope.test.ts` and the cross-hospital cases pass.
- Passwords (scrypt), TOTP seals and JWTs are the Node formats: an account,
  a second factor or a token made by either API works in the other, so the
  two can be switched on the same database (the rollback, `deployment.md`).

## 6. Security findings

Found and fixed during the port:

- **Connection-pool starvation** (fixed, `b1477b5`): under ASGI every worker
  thread that touched the database kept its connection; enough sockets and
  jobs took the whole pool from HTTP requests. Each request, socket task and
  job tick now returns its connection. Before the fix, Django also answered
  one request at a time; requests now interleave as Node's do.

Open, for the owner's attention:

- **Type-aware lint is gone from the frontends.** The rules that needed
  types (floating promises, exhaustive switches over the event union, `any`)
  cannot run on JavaScript. Lint keeps undefined names, unused code, cycles,
  the boundaries and no-console; the live serial channel now checks the
  shape of what it is sent. This is the cost the brief accepted.
- **`ALLOWED_HOSTS = ["*"]`**: the API trusts the web server (Caddy) to
  route only its own names, as the Node API did. Pin it to the API's host
  if the API is ever reachable without Caddy in front.
- **The rate limiter is per process**, as in Node: a second API process
  doubles every allowance.
- Unchanged from the Node API and still open before real patients: the items
  in `docs/audit/marks-readiness-2026-10-18.md` (no server, no restore on
  target hardware, unencrypted backups, no alerting).

No patient identifier, OTP, token or payment reference is logged
(`test_sms_redaction.py`, the Node suite's redaction cases). All data used was
synthetic (FR-SEC-08).

## 7. Automated test results

| Suite | Result |
|---|---|
| pytest (`backend/django`) | 220 / 220 (161 queue parity vectors, 59 API and unit) |
| Node API suite against Django | 1,925 / 1,935; the 10 others are the spy cases, covered by pytest |
| Unit and component tests (`--project unit --project ui`, the converted frontends) | 82 files, 5,979 / 5,979 |
| `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | pass |
| `next build` of console, patient app and site (JavaScript) | pass |
| Docker image, production mode, local database | healthy; `/healthz`, `/readyz`, `/api/v1/config` 200; unauthenticated `/staff/me` 401; Socket.IO handshake; clean shutdown on SIGTERM (exit 0) |
| Browser suite (`playwright.django.config.ts`), Django API, JavaScript frontends | <!-- BROWSER --> |

## 8. Performance

<!-- PERF -->

## 9. Remaining production risks

<!-- RISKS -->

## 10. Local development

```bash
docker start healthcare-db
cd backend/django
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.lock.txt
cp .env.example .env
.venv/Scripts/python -m uvicorn medlive.asgi:application --port 4000 --no-proxy-headers
# in another terminal, from the repository root
pnpm dev:console      # http://localhost:3100
pnpm dev:patient      # http://localhost:3000

# tests, one at a time
cd backend/django && .venv/Scripts/python -m pytest
pnpm exec vitest run -c vitest.django.config.ts
pnpm exec playwright test -c playwright.django.config.ts
node backend/django/tests/perf/compare.mjs
```

## 11. Deployment and rollback

`deployment.md`. In short: the self-hosted stack with
`deploy/docker-compose.django.yml` added swaps only the API; the rollback is
the same command without that file, on the same database, with no data
migrated either way.
