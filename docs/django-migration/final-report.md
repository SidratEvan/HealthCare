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

**GO for the next step, NO-GO for replacing the Node API with real patients
today.**

The Django API keeps the Node API's contract as far as the repository's
tests can show it: the same route table, 1,925 of 1,935 Node API cases
(the 10 others proven by pytest equivalents), 220 pytest cases, and the
browser suite with the two-device canary green against it, with the
frontends now in JavaScript. That is enough to **run it beside the Node API
on the demo**, on the same database, where going back is one command
(`deployment.md`).

It is not yet enough to make it the API real patients depend on. It has
never run on the target server (it has run in Docker's Linux containers,
with backup, restore and rollback proved there), it carries a third to a
half of Node's throughput, and the release restrictions of CLAUDE.md §4.6 apply to
it as to everything else. §9 lists what stands between this branch and that
decision; none of it is a known defect in the port.

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
- **Not run against Django:** the built-console configuration
  (`playwright.built.config.ts`); the production run below builds the
  console too.
- **Not run on the target server.** The whole compose stack ran in Docker's
  Linux containers on this Windows machine (§7): the same images, not the
  hospital's hardware. The `DEPLOY.md` S8 dry run is still owed, for either
  API.
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
the TypeScript frontends, and 5/5 with the JavaScript
frontends (in each full run).

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

- **The design system's styles after the conversion** (fixed, `c08f5ef`):
  Tailwind's `@source` still named `*.{ts,tsx}`, so every class used only
  inside a design-system component was dropped; the bottom sheets rendered
  outside the viewport and the ER, referral and undo flows could not be
  finished (10 browser cases on the first full run). Not a security fault,
  but the kind the compiler can no longer catch.

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
| Browser suite, clean full run after every fix | **345 / 346**, canary 5/5. The one other (`publish-controls.spec.ts:80`) found the patient's search page still in its server-rendered state after a reload: the page's script never ran, so no request reached the API. A stall of the Next dev server; it passed in both earlier full runs and 6/6 alone |
| Production browser suite (`playwright.prod.django.config.ts`: built apps, `DEMO_MODE=false`, the limited role, production secrets) | **85 / 85**, the production canary included |
| The whole stack in Docker (`docker-compose.yml` + `docker-compose.django.yml`, Linux containers) | Every service healthy behind Caddy; `/healthz`, `/readyz`, the config, both apps and the Socket.IO handshake answered at their addresses; the first administrator made with `pnpm staff:create` (the `tools` service) signed in through Django and was asked to change the password and set up two-step verification; a backup taken and proved by the script, a hospital added after it, the backup restored, the later hospital gone and the earlier one back; rolled back to the Node API on the same database, where the same account signed in; forward to Django again |
| Browser suite (`playwright.django.config.ts`), earlier full runs | Final full run: **343 / 346**, canary 5/5 (1.0 h). The three others, each
resolved and rerun: two lab-report cases were a race in the spec (it signed
serial 1 after opening the doctor's screen, which since FR-DOC-08 keeps the
patient it loaded); fixed in `234e00a`, the file then 24/24 with every case
run twice. One standby case failed once just after the Next dev server
forced a full page reload, and passed on rerun (14/14 with its file and
lab-report). The first full run (336/346) found the Tailwind fault (§6),
fixed in `c08f5ef`; its four files then 22/22 |

## 8. Performance

`node backend/django/tests/perf/compare.mjs`: the same requests to each API
in turn, on the same seeded database (`healthcare_django_api_test`), on one
Windows development machine, background jobs off, after a warm-up. Not a
server, so the absolute numbers are indicative; the ratio is the finding.

| Request | Node p50 / p95 ms | Node req/s | Django p50 / p95 ms | Django req/s |
|---|---:|---:|---:|---:|
| GET /healthz | 0.6 / 1.1 | 1539 | 2.6 / 3.4 | 365 |
| GET /readyz | 4.8 / 6.5 | 204 | 9.1 / 10.7 | 108 |
| GET /api/v1/hospitals | 15.7 / 18.2 | 63 | 21.3 / 25.2 | 46 |
| GET /api/v1/doctors | 4.3 / 5.2 | 224 | 10.9 / 13.8 | 90 |
| GET /api/v1/hospitals, 10 at once | 39.4 / 66.6 | 234 | 109.3 / 155.6 | 89 |
| GET /api/v1/doctors, 10 at once | 25.6 / 36.9 | 415 | 55.4 / 65.9 | 193 |

In the last row 80 of 400 requests were refused by each API alike: the
per-address rate limiter, which behaves the same in both.

**Django is about two to three times slower per request** and carries about
a third to a half of Node's throughput. For one hospital's traffic that is
far inside what is needed (a request in tens of milliseconds); the measure
that matters to a patient, the two-device canary, stays under 2 s. A
multi-hospital network on one process would reach the ceiling sooner, and
the answer there is more API processes with one running the background jobs
(`deployment.md`).

## 9. Remaining production risks

1. **A new codebase replaces a proven one.** The Node API has carried the
   pitch and the readiness audits; the Django API has passed the same
   suites on one machine, but has never served a real day. Run it beside the
   Node API on the demo first, where the rollback is one command.
2. **Not on the target server.** The whole stack has run in Docker's Linux
   containers on a development machine, with backup, restore and rollback;
   the S8 dry run (`DEPLOY.md`) on the hospital's hardware has never been
   done, for either API.
3. **`DEPLOY.md` S3 names `exec api` for the operator's commands**, which
   holds for the Node API only; with Django they run through `tools`
   (`deployment.md`). `DEPLOY.md` is one of the owner's documents and is not
   edited here.
4. **Two codebases to keep equal** until one is retired: every change made to
   the Node API from here needs its port, or the parity this report records
   decays. The Node suite run against Django is the guard, and it must be
   run on every change to either.
5. **Lower throughput** (§8): fine for a pilot, a sizing question for a
   network.
6. **Weaker static checking in the frontends** (§6). A class of mistake
   the compiler used to stop now reaches the browser tests or the user; one
   did during this migration (the Tailwind source glob, §6).
7. Everything the readiness audit of 18 October lists before real patients
   is unchanged by this migration.

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
