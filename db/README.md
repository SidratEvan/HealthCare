# db — schema, seeds and scripts

Authority: `docs/DATABASE.md`. If this directory and that document disagree, the
document wins.

## Layout

```
migrations/   0001 … 0015, sequential, forward-only, one concern per file
seeds/        seed_00 … seed_07 plus reset.ts — the demo database (FR-DEM-*)
scripts/      rebuild_queue_state.ts, verify_schema.ts
docker/       first-run init for the local Postgres container
```

## Rules

- **Never edit a shipped migration.** Add the next number instead (DATABASE.md §7).
- **Forward-only, and never destructive in one release.** Schema change → deploy
  migration → deploy API → deploy clients, never the reverse (BACKEND.md §12).
- **`queue_events` is append-only** (`DB-P1`). No UPDATE, no DELETE — enforced by
  `trg_queue_events_no_mutate` and by RLS, not by convention.
- **Nothing is hard-deleted** except on an explicit privacy request (`DB-P2`).
- **Timestamps UTC, money integer poisha, phones normalised `+8801…`**
  (`DB-P4`, `DB-P5`, `DB-P6`).
- **RLS is enabled on every table.** Never weaken a policy to make a test pass
  (CLAUDE.md §8).
- **The demo and dev databases contain no real patient data, ever** (`FR-SEC-08`),
  and every demo row is visibly labelled as demonstration data (`FR-DEM-07`).

## Local database

```bash
docker compose up -d        # Postgres 16 + PostGIS on localhost:5432
```

Two databases are created on first start: `healthcare_dev` for development and
`healthcare_test` for the repository and API suites.

## Commands

`pnpm db:migrate`, `pnpm db:seed`, `pnpm db:reset` and `pnpm db:verify` are wired
up in step 1 (`feat/db-core`), together with migrations 0001–0006.
