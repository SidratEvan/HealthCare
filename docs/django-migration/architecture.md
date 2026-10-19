# The Django API: architecture

For the incoming maintainer, who reads Python and JavaScript. It describes
`backend/django`, the Python port of `backend/api`. The Node API stays the
shipping backend until the Django one passes acceptance
(`final-report.md`); nothing in the frontends, the database or the
deployment has been switched to it.

## What stayed exactly as it was

- **The database.** The schema is `database/migrations` (SQL, 0001 onwards),
  applied by the same `pnpm db:migrate`. Django's ORM migrations are not used
  and Django owns no table. Row-level security, the triggers, the views and
  the append-only `queue_events` are untouched.
- **The HTTP contract.** Every path, method, status code, header, error code
  and JSON shape of `/api/v1/*`, `/healthz` and `/readyz` is the Node API's.
  The original Node test suite is the proof: it runs unchanged against the
  Django server (*How it is tested*, below).
- **The realtime contract.** Socket.IO, on the same path, with the same
  events, rooms, acknowledgements and authorisation, so the frontends'
  `socket.io-client` code does not change.
- **The queue engine's arithmetic.** `medlive/domain/queue` is a line-for-line
  port of `shared/domain/src/queue`, held to it by parity vectors generated
  from the TypeScript (`tests/parity`).

## The stack

| Piece | Choice | Why |
|---|---|---|
| Language | Python 3.12 | Supported until 2028; the maintainer's language. |
| Web framework | Django 5.2 LTS + Django REST Framework 3.18 | The brief's choice; LTS until April 2028. DRF provides the one view every path goes to. |
| Database driver | psycopg 3 (binary) with Django's connection | Raw SQL, as the Node repositories use Kysely's `sql` tag. |
| Realtime | python-socketio 5 on ASGI | It speaks the Socket.IO protocol the frontends already use. Django Channels does not, and would have meant rewriting the clients. |
| Server | uvicorn | ASGI, one port for HTTP and the socket. |
| Tokens | PyJWT, HS256 | Interchangeable with the Node API's tokens, both ways. |
| Passwords, TOTP | `hashlib.scrypt` and `cryptography` | The Node formats (scrypt N=2^17 r=8 p=1 over NFKC; AES-256-GCM under HKDF keys): a hash or seal made by either opens in the other. |
| Tests | pytest + pytest-django, and the Node suite | See below. |

No Redis: the Node API has none (the rate limiter is per process, the outbox
is a table, the session lock is a row lock), and nothing in the port needs one.

## Layout

```
backend/django/
  medlive/
    asgi.py          the process: Django + Socket.IO on one port, background work
    urls.py          every path to one DRF view
    core/            the request pipeline and what every module shares
      pipeline.py      app.ts's middleware order, in one function
      router.py        an Express-ordered route table: the first match answers
      schema.py        a zod-4-compatible validator (the shared schemas port line for line)
      db.py            raw SQL through one door that states the RLS scope first
      scope.py         who a connection works for (config/dbScope.ts)
      auth.py          requireAuth, requireRole, requireHospitalScope, idempotency
      env.py           the Node API's variables and refusals
      errors.py, codes.py   the one error envelope and every code
    domain/          pure rules, ported from shared/domain (queue, beds, emergency, imports, ...)
    repositories/    SQL only (one module per Node repository)
    services/        the work: transactions, events, notifications, broadcasts
    controllers/     thin: parse what the route validated, call a service, shape the answer
    routes/          the route tables, mounted in routes/index.ts's order
    realtime/        the Socket.IO server, rooms, handlers, emit
    adapters/        SMS, push, payments (mock, bKash, Nagad), storage, travel time, mapping model
  tests/
    parity/          the queue engine against the TypeScript
    api/             the cases that spy on Node modules, against Django in-process
    unit/            adapters and rules with no database
    node_suite/      the shims that point the Node suite at the Django server
```

The layering is the Node API's and is kept the same way: routes call
controllers, controllers call services, services call repositories, and only
repositories hold SQL. Events and notifications are written only by services.

## A request, end to end

`core/pipeline.py` runs `app.ts`'s middleware in its order: the client
address (from `TRUST_PROXY_HOPS`, as Express's `trust proxy`), a request id,
security headers, the CORS allowlist, the JSON body (256 kB, or the route's
own limit), the patient's origin, the principal from the bearer token or the
tracking link, the anonymous ceiling, the database scope, the module gate,
the idempotency header, then the route table. The first route that matches
the method and path answers; a path no route has is 404, and a known path
with another method is 404 too, as in Express.

A route's own body parser can sit after its first steps (`parse_after`), as
`json()` sits after `requireAuth` on the import routes, so an unauthenticated
body is refused before it is read.

Errors: anything raised becomes `{ ok: false, error: { code, message,
details } }` through `core/errors.as_app_error`; a raw SQL or provider
message never reaches a client.

## The database scope (RLS)

Every statement goes through `core/db.py`, which states `app.scope`,
`app.hospital_id`, `app.person_id` and `app.booking_id` on the connection
first (`set_config`), as `connectScoped` does in Node. The scope comes from
the principal (`core/scope.py`); work outside a request (the hourly jobs, the
sender) is `system`. Inside a transaction the scope is stated once, at its
start. The national layer reads as `gov_reader`, which can open only the
aggregate views.

## Background work

`services/jobs.py`, started by the ASGI lifespan when `RUN_BACKGROUND_JOBS`
is on: the outbox sender (every five seconds and on each commit), the hourly
jobs (chambers from schedules, imported rows cleared after 30 days, message
words cleared after 90), lapsed standby offers every 30 seconds, and payment
holds every 30 seconds. Each reports to the heartbeat that `/readyz` reads.

## How it is tested

1. **The Node suite against Django.** `pnpm exec vitest run -c
   vitest.django.config.ts` runs every file of `backend/api/src/__tests__`
   unchanged, with `../app.js` resolved to a shim that forwards each request
   to the Django server. Seams, honoured only under `NODE_ENV=test`, keep the
   original assertions meaningful: the test's clock, the `env` values it
   changed, adapters it installed (SMS, payments, mapping), the rate
   limiter's resets, heartbeats, and service calls a test makes directly,
   which run in the Django process.
2. **pytest for what the Node suite cannot see.** A Node test that spies on a
   Node module tests Node; each such case is ported to `tests/api` with the
   same failure injected into the Python module (`spy-tests.md`).
3. **Parity vectors** for the queue engine (`tests/parity`).
4. **The browser suites and the two-device canary** against the Django
   server (`final-report.md`).

## Decisions taken, and why

- Raw SQL repositories rather than the ORM: the schema belongs to the SQL
  migrations, and every query ports one for one, which is what makes the
  behaviour the same.
- A zod-compatible validator rather than DRF serializers or Pydantic: those
  coerce what zod refuses (`"5"` to `5`), and the API must refuse what the
  browsers' schemas refuse, with the same messages.
- An Express-ordered route table behind one DRF view, because Express's
  first-match order decides several answers.
- JavaScript's arithmetic where an answer depends on it: `Math.round`,
  `Number.isInteger`, `localeCompare` (ICU root collation), UTF-16 lengths,
  `Buffer` decoding and hashing of text.
