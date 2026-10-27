# MedLiveBD — a national healthcare platform for Bangladesh

**`master` is the consolidated development branch**, based on the Django migration
`6d29a7f`: approved company website, redesigned staff consoles, safety fixes,
Django API, JavaScript frontends and the original Node API for rollback.
See [branch inventory and verification](docs/BRANCH_INTEGRATION.md) and
[local development](docs/LOCAL_DEVELOPMENT.md). Older reports describe their own
revisions; creating master does not change the public deployment.

## Start the consolidated app on Windows

Requires Node 22.19+ (24 recommended), Corepack, Python 3.12+ for Django,
and local PostgreSQL 16 with PostGIS (Docker, Ubuntu WSL or an existing instance).

```powershell
git switch master
.\run.ps1 -Background
# Patient http://localhost:3000 · Staff http://localhost:3100
# Website http://localhost:3200/en (or /bn) · API http://localhost:4000/readyz
.\run.ps1 -Stop
```

The launcher defaults to Django, installs pinned dependencies, generates missing
local secrets, migrates, seeds only an empty database and verifies its schema.
Existing demo data is preserved. Use `-ApiBackend Node` for the original API,
`-SetupOnly` to prepare without starting, or `-SkipInstall` after dependencies are
installed. Logs and ownership records are in ignored `.local/`.

On the inspected machine the existing demo database is on **localhost:5433**;
5432 belongs to another instance. The ignored `.env` now selects 5433. Start with:

```powershell
.\run.ps1 -Background -DatabaseProvider Existing
```

The frontends and browser packages are JavaScript/JSX. Shared domain rules,
translations, database tools and the original Node API remain TypeScript. Django
uses the existing SQL ledger: do not run Django ORM migrations.

A two-sided healthcare platform: a Bangla-first patient PWA and a set of hospital
staff consoles, built around a **live queue engine** that keeps a doctor's chamber
queue true in real time.

Reception taps _next_; every waiting patient's phone updates within two seconds.
That is the product. Everything else supports it.

## The documents are the source of truth

| Document                             | Authority over                                                          |
| ------------------------------------ | ----------------------------------------------------------------------- |
| [docs/PRD.md](docs/PRD.md)           | Scope and requirements — every requirement has an ID (`FR-QUE-14`)      |
| [docs/APP_FLOW.md](docs/APP_FLOW.md) | Screens, controls and wiring — every control has an ID (`BTN-B02-NEXT`) |
| [docs/FRONTEND.md](docs/FRONTEND.md) | Design system and client architecture                                   |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, RLS, migration order                                            |
| [docs/BACKEND.md](docs/BACKEND.md)   | Services, files, APIs, realtime, sync, workers                          |

If code and a document disagree, the document wins. Working agreements for this
repository — branch policy, definition of done, testing rules — are in
[CLAUDE.md](CLAUDE.md).

## Layout

```
frontend/      Everything that runs in a browser
  patient/     Patient PWA (Part A)              — Next.js, Bangla-first, installable
  console/     Hospital consoles (Part B)        — Next.js, keyboard-first, offline-first
  site/        Marketing website (Part C)        — Next.js, server-rendered
backend/       Everything that runs on a server
  api/         HTTP + realtime                   — Express 5, Socket.IO, the queue service
  django/      New HTTP + realtime API           — Django/DRF, python-socketio
  workers/     Background jobs                   — pg-boss
shared/        Imported by both sides
  domain/      Types, queue event log, reducer, ETA maths — pure, no I/O
  client/      Typed API client, session channel, offline queue
  ui/          Design system: tokens, primitives, signature components
  i18n/        Messages and formatters (bn default, en toggle)
  config/      Shared TypeScript and ESLint configuration
database/      Migrations, seeds, schema scripts
```

Three directories divided by where the code runs, and a fourth for the schema.

`shared/domain` holds the queue reducer, and both the API and the console
import it unchanged. That is the mechanism that stops the server and the client
ever disagreeing about what a queue event means (`FR-QUE-05`) — which is why it
belongs to neither side and sits in neither. The boundaries are lint-enforced:
`frontend/` cannot import from `backend/` or `database/`, and `shared/domain`
imports nothing at all.

## Getting started

Requires Node 22.19+ (24 recommended, and what CI runs) and Docker.

```bash
corepack enable                 # pnpm version comes from package.json
pnpm install
cp .env.example .env            # then fill in the secrets it names
docker compose up -d            # Postgres 16 + PostGIS on localhost:5432
```

## Commands

```bash
pnpm dev              # every app that has a dev server
pnpm dev:api          # the API alone, with reload
pnpm dev:django       # Django API from the root local .env, limited DB role
pnpm dev:site         # company website on :3200
pnpm build
pnpm typecheck
pnpm lint             # includes the architectural boundaries
pnpm format
pnpm test             # unit + api + schema
pnpm verify           # typecheck + lint + format + test, as CI runs them
pnpm test:django      # original API suite against Django (see guide for spy cases)
pnpm test:e2e:django  # browser suite against Django; disposable local DB only
pnpm test:e2e:prod:django # production browser configuration against Django

pnpm db:migrate       # apply pending migrations
pnpm db:verify        # assert the DATABASE.md §0 invariants
```

The test suite runs as three projects: `unit` needs nothing, `api` and `schema`
need `docker compose up -d`. Run one with `pnpm vitest run --project unit`.

`pnpm db:seed`, `pnpm db:reset`, `pnpm dev:patient`, `pnpm dev:console` and
`pnpm test:e2e` are implemented. Browser suites rebuild their configured database
and own their app ports; stop local apps first and use a disposable database as
described in the development guide. CI includes master.

## Toolchain notes

- **pnpm is pinned** by the `packageManager` field, so `corepack enable` gives
  every machine and CI the same version. Do not install it globally at a
  different version.
- **TypeScript is held at 6.x on purpose.** TypeScript 7's native compiler is
  faster, but typescript-eslint does not support it yet, and type-aware lint
  rules — unawaited promises, non-exhaustive switches over the queue event union
  — matter more here than compile speed. One compiler serves both `typecheck`
  and `lint`; revisit when typescript-eslint supports 7.1.
- **`shared/config` owns every tooling decision.** A tsconfig or lint rule
  defined inside an app or package is a bug.

## Boundaries the linter enforces

These are load-bearing, not stylistic:

- `routes → controllers → services → repositories → db`. A controller never
  touches SQL; a repository never emits events or sends notifications.
- SQL exists only in `*.repo.ts`.
- `shared/domain` imports no Node built-in, no database driver and no
  framework, and its queue code may not read the clock or a random number —
  replay determinism is a tested guarantee, not an aspiration.
- The queue reducer is defined once.

## Data and safety

The demo and development databases contain **no real patient data, ever**
(`FR-SEC-08`), all demo content is visibly labelled as demonstration data
(`FR-DEM-07`), and no live figure is ever rendered without its freshness stamp —
when the system does not know, it says so (`FR-OFF-03`, `PRD.md` §3.2).
