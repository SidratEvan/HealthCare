# National Healthcare Platform — Bangladesh

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
apps/
  patient/     Patient PWA (Part A)              — Next.js, Bangla-first, installable
  console/     Hospital consoles (Part B)        — Next.js, keyboard-first, offline-first
  site/        Marketing website (Part C)        — Next.js, server-rendered
  api/         HTTP + realtime                   — Express 5, Socket.IO, the queue service
  workers/     Background jobs                   — pg-boss
packages/
  domain/      Types, queue event log, reducer, ETA maths — pure, no I/O
  client/      Typed API client, session channel, offline queue
  ui/          Design system: tokens, primitives, signature components
  i18n/        Messages and formatters (bn default, en toggle)
  config/      Shared TypeScript and ESLint configuration
db/            Migrations, seeds, schema scripts
```

`packages/domain` holds the queue reducer, and both the API and the console
import it unchanged. That is the mechanism that stops the server and the client
ever disagreeing about what a queue event means (`FR-QUE-05`).

## Getting started

Requires Node 20+ and Docker.

```bash
corepack enable                 # pnpm version comes from package.json
pnpm install
cp .env.example .env            # then fill in the secrets it names
docker compose up -d            # Postgres 16 + PostGIS on localhost:5432
```

## Commands

```bash
pnpm dev              # every app that has a dev server
pnpm build
pnpm typecheck
pnpm lint             # includes the architectural boundaries
pnpm format
pnpm test             # unit + integration
pnpm verify           # typecheck + lint + format + test, as CI runs them
```

`pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset`, `pnpm db:verify` and
`pnpm test:e2e` are wired up by the steps that introduce them (see
[CLAUDE.md](CLAUDE.md) §4).

## Toolchain notes

- **pnpm is pinned** by the `packageManager` field, so `corepack enable` gives
  every machine and CI the same version. Do not install it globally at a
  different version.
- **TypeScript is held at 6.x on purpose.** TypeScript 7's native compiler is
  faster, but typescript-eslint does not support it yet, and type-aware lint
  rules — unawaited promises, non-exhaustive switches over the queue event union
  — matter more here than compile speed. One compiler serves both `typecheck`
  and `lint`; revisit when typescript-eslint supports 7.1.
- **`packages/config` owns every tooling decision.** A tsconfig or lint rule
  defined inside an app or package is a bug.

## Boundaries the linter enforces

These are load-bearing, not stylistic:

- `routes → controllers → services → repositories → db`. A controller never
  touches SQL; a repository never emits events or sends notifications.
- SQL exists only in `*.repo.ts`.
- `packages/domain` imports no Node built-in, no database driver and no
  framework, and its queue code may not read the clock or a random number —
  replay determinism is a tested guarantee, not an aspiration.
- The queue reducer is defined once.

## Data and safety

The demo and development databases contain **no real patient data, ever**
(`FR-SEC-08`), all demo content is visibly labelled as demonstration data
(`FR-DEM-07`), and no live figure is ever rendered without its freshness stamp —
when the system does not know, it says so (`FR-OFF-03`, `PRD.md` §3.2).
