# Compatibility matrix: the Node API and the Django API

What proves, for each part of the Node API's contract, that the Django API
keeps it. Measured on `migration/django-drf`, 19 October 2026, against the
local test database only.

## Summary

| Contract | Evidence on the Django side | Result |
|---|---|---|
| Every route, in Express's order | `backend/django/tests/unit/test_route_table.py` reads `routes/index.ts` and every `*.routes.ts` it mounts, and compares the Django table route for route and in order; the probes (`/healthz`, `/readyz`) likewise | pass |
| Every endpoint's behaviour, status, error code and JSON | The original Node suite, unchanged, sent over HTTP to Django (`vitest.django.config.ts`) | 1,925 of 1,935 |
| The 10 Node cases that spy on a Node module | One pytest equivalent each, through the whole Django pipeline (`spy-tests.md`) | pass |
| The queue engine's arithmetic | 161 parity vectors generated from `shared/domain` (`tests/parity`) | pass |
| Concurrency, audits, redaction, the clock's jobs | `backend/django/tests/api`, `tests/unit` | pass |
| Realtime (Socket.IO rooms, catch-up, auth) | `realtime.test.ts` and the other socket cases of the Node suite, against Django's python-socketio server | pass |
| The browsers' flows and the two-device canary | `playwright.django.config.ts`: the same specs, the API on uvicorn | not yet run |

pytest: 220 passed (161 parity, 59 in `tests/api` and `tests/unit`).

The Node suite passes every case of 71 of its 77 files. The 10 cases that do
not pass are exactly the spy cases of `spy-tests.md`: a spy replaces a
function in the Node process, which the Django server never runs, so the
Node case cannot see Django at all. Their equivalents are what counts.

## The Node suite, file by file

Files that do not appear below passed every case. The run log's duration
was 17.5 minutes, one worker.

| Node test file | Cases | Passed against Django | Not passed |
|---|---:|---:|---:|
| `__tests__/broadcastAfterCommit.test.ts` | 2 | 0 | 2 |
| `__tests__/doctorSafety.routes.test.ts` | 13 | 10 | 3 |
| `__tests__/labPharmacySafety.routes.test.ts` | 16 | 15 | 1 |
| `__tests__/receptionSafety.routes.test.ts` | 5 | 4 | 1 |
| `__tests__/registration.routes.test.ts` | 11 | 10 | 1 |
| `__tests__/staffAuth.routes.test.ts` | 23 | 21 | 2 |
| **Total (77 files)** | **1,935** | **1,925** | **10** (pytest equivalents, `spy-tests.md`) |

The full list of the 77 files run is `backend/api/src/**/*.{test,spec}.ts`
(`vitest.django.config.ts`, `include`).

## How to reproduce

```bash
# pytest (needs the local healthcare-db container)
cd backend/django && .venv/Scripts/python -m pytest

# the Node suite against Django (builds healthcare_django_api_test, starts
# Django on 127.0.0.1:4199, about 18 minutes)
pnpm exec vitest run -c vitest.django.config.ts
```

Run one at a time: both use `healthcare_django_api_test`.
