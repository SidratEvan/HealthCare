# Django migration — progress checkpoint

The handover file for this migration. A fresh session reads this first, then
`architecture.md` and `compatibility-matrix.md`. Update it at every commit.

## Where the work is

- Worktree `D:\Projects\HealthCare-django`, branch `migration/django-drf`,
  based on `c550343` (`chore/integrate-console-redesign`: the console
  redesign, its safety fixes and the MARKS readiness work). The original
  checkout `D:\Projects\HealthCare` is untouched.
- Nothing is merged, pushed or deployed. `main`, `mvp`, `demo` and the
  public Supabase database are untouched (CLAUDE.md §4.6 restrictions hold).
- Local databases used, all on the `healthcare-db` container and all
  disposable: `healthcare_django_api_test` (migrations + seed + the
  `healthcare_api` role). The other `healthcare_*` databases belong to
  other work and are not touched.

## Environment

```bash
# Python 3.12 virtualenv, pinned requirements
cd backend/django
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt

# Build the Django test database (migrations, seed, API role)
cd ../..
DATABASE_URL_API_TEST=postgresql://healthcare:healthcare@localhost:5432/healthcare_django_api_test \
  pnpm --filter @platform/database exec tsx tests/support/build-api-db.cli.ts

# Python tests (parity vectors regenerate from the TypeScript when stale)
cd backend/django && .venv/Scripts/python -m pytest
```

## Milestones

| # | Commit | What | Verified |
|---|---|---|---|
| 16 | (this commit) | CSV import (template, check, preview with warnings, commit, undo, discard) and the mapped import (analyse, confirm, saved mappings, the model adapter, off by default); the import domain (CSV reader, sets, warnings, mapping rules); router: a route's own body parser can sit after its first steps, as Express places it; harness: a mapping provider a test installs answers the server | `import.routes`, `importMapping`: 57/57 |
| 15 | `f55cb52` | The platform's side of onboarding (workspaces, approve/send back/suspend/reinstate/close, doctor verification, portal domain, modules, agreement, audit trail, health) and a hospital applying by itself; harness: a test's heartbeats reach the server, and `portals.hospitalLinkOrigin` is answered by it | `platform.routes`, `platformHealth`, `platformAgreement`, `orgApplication`, `portalAddress`, `readiness`: 115/115 |
| 14 | `c84b749` | The national layer: district capacity, ER load by hour, symptom signals, anonymised benchmarks, read as `gov_reader` and walked for identifiers before sending | `gov.routes` 59/59 |
| 13 | `5548147` | Hospital settings (profile, rules, publishing, brand and logo, departments, doctors, schedules, wards and beds, staff and resets, capabilities, desks, asking for review); the workspace lifecycle rules; the session materialiser | `hospitalSettings`, `hospitalDesks`, `adminDeskSafety`, `publishing`, `hospitalFace`, `workspaceBrand` pass |
| 12 | `a1d8a0b` | Admin dashboard, overview, export | `admin.routes`, `adminOverview`, `adminChambers`, `smsDelivery` pass |
| 11 | `f23c56e` | Emergency (search, inbound, ER console) and referrals | `emergency.routes` 35/35, `referral.routes` 24/24 |
| 10 | `df03d80` | The ward board: board, panel (audited), admit (desk, request, ER hand-off), discharge, transfer, hold, release, cleaning, out of service, discharge forecast, lapsed holds; families' bed requests and the ward's answer; the board and capacity rules and the ER case rules ported; harness: `counter.reset()` and each new test file empty the server's rate limiter | `bed.routes` 34/34; `patientAuth.routes`, `standby`, `paymentHolds` still pass (102/102 together) |
| 9 | `329bb2f` | Consent: the chamber code, a doctor redeeming it, the patient granting and revoking from the app, the patient's view of who read their records | `consent.routes` 20/20 |
| 8 | `7ca5c4d` | The doctor's consultation (read, save, sign and call next), the patient's records and the read audit, formulary search, a patient's own papers (upload by bytes, list, remove, signed link) | `clinical.routes`, `doctorSafety`, `patientDocuments`, `prescriptions`: 60 of 63; the 3 others spy on Node modules (`spy-tests.md`) |
| 7 | `a721367` | Counter registration (lookup, register, walk-in) and the standby list (join, status, accept, decline, leave) | `registration.routes`, `receptionSafety`, `standby`: 52 of 54; the 2 others spy on Node modules (`spy-tests.md`) |
| 6 | `d942eac` | Offline sync, payment routes, provider and SMS-receipt webhooks, the simulated payment page; harness: any adapter a test installs (SMS, payment provider) answers Django's calls method by method | `sync.routes` 35/35; payment, holds, providers, no-show prepay, SMS delivery, patient auth, notifications: 121 of 127 before the undefined-argument fix, the rest wait for the admin routes |
| 5 | `ae7adbb` | Staff sign-in (scrypt passwords and TOTP, interoperable with Node's both ways), refresh families, 2FA, demo picker; harness: Socket.IO forwarded to Django, direct queue-service and notification-sender calls run in Django (`call.ts`), adapter throws carried over the SMS bridge | 265 of 272 across 13 ported suites; the 7 others are 3 spy cases and routes not yet ported |
| 4 | `2c316df` | Payments (intent, confirm, holds, refunds, settlement), patient sign-in and guest phone proof, booking, tracking links, lab and pharmacy, storage adapter; harness seams for `env` changes and test-installed SMS adapters; tokens follow the API clock | `booking.routes`, `bookingRetry`, `myBookings`, `patientAuth.routes`, `lab.routes`, `labPharmacySafety`, `app.test`: 144 of 148 pass; one waits for beds, one is a Node spy case (`spy-tests.md`) |
| 3 | `eaf767e` | Discovery (search, needs, config, logo) ported; every repository of `backend/api/src/repositories` ported to raw-SQL Python (28 modules, same SQL); payment adapters (mock, bKash, Nagad request signing) | `search.routes`, `queue.routes`, `queueConflict` pass; `app.test` 21/22 (the remaining one waits for the lab routes); every repository imports |
| 2 | `5e136d0` | Queue service, its repositories, notifications outbox and sender, links, realtime server (python-socketio), queue routes; Node-suite harness (`vitest.django.config.ts`) with a test-only clock and emission seam | `queue.routes.test.ts` 35/35 and `queueConflict.test.ts` 3/3 of the original Node suite, against the Django server |
| 1 | `0f4dead` | Django/DRF foundation: env, pipeline, scoped db, zod-compatible validator, JWT, logging, health routes; queue engine port | 161 parity cases vs the TypeScript engine; two mutations confirmed to fail it; `/healthz`, `/readyz` against the seeded DB as `healthcare_api` |

## Next exact steps

1. Done: the harness (`pnpm exec vitest run -c vitest.django.config.ts <filter>`).
2. Port module by module in `routes/index.ts` order, re-running the suite:
   discovery, guest, demo, staff auth, patient auth, booking, queue (+ the
   realtime handlers), registration, standby, clinical, consent, beds,
   emergency, referrals, lab, payments, admin, hospital settings, import,
   platform, gov, webhooks, mock pay, sync. Then the background jobs.
3. Realtime: python-socketio ASGI server (`medlive/asgi.py`) with the same
   events and rooms; the two-device canary against it.
4. Frontend TS → JS conversion, then the browser suites against Django.
5. Docker, deployment and rollback docs; final report.

## Decisions taken (routine, recorded)

- Raw SQL repositories, not the Django ORM: the schema is the SQL
  migrations', and the queries port one for one. Django's ORM migrations are
  not used.
- A zod-compatible validator instead of Pydantic or DRF serializers:
  Pydantic coerces types zod refuses (`"5"` to `5`, `true` to `1`) and zod
  4's uuid is stricter; the schemas must refuse what the browser's refuse.
- An Express-ordered route table behind one DRF view: the first matching
  route answers, as in Express.
- python-socketio over Django Channels: it speaks the Socket.IO protocol the
  frontend's `socket.io-client` already uses, so the frontend's realtime
  code does not change.

## Open questions for the owner

None yet that block the build.
