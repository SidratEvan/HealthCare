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

## Extensions live in their own schema

PostGIS, pgcrypto, uuid-ossp, cube and earthdistance are installed into an
`extensions` schema, not into `public` (0001). That is Supabase's convention,
and following it locally too means the container and the hosted database have
the same layout — so a migration that applies cleanly on one applies cleanly on
the other.

The consequence is that **every connection must carry
`-c search_path=public,extensions`**. `ST_MakePoint`, `geography` and
`gen_random_uuid` are otherwise unresolvable, and the failure appears at
runtime in the emergency geo search rather than at migration time. There is one
definition of it, `PG_CONNECTION_OPTIONS` in `scripts/lib/env.ts`, used by
every connection factory including the API pool.

## Which databases these scripts will touch

`assertSafeTarget` decides on the **host**, not the database name:

- a local host is free
- any other host needs `ALLOW_REMOTE_DB=1`
- a destructive operation on a remote host also needs `ALLOW_DESTRUCTIVE_DB=1`

The database name proves nothing, which is why it is not consulted: a hosted
Postgres is called `postgres` whether it is a scratch project or a pilot
hospital. So pointing the scripts at a Supabase project is deliberate:

```bash
ALLOW_REMOTE_DB=1 pnpm db:migrate
```

## Local database

```bash
docker compose up -d        # Postgres 16 + PostGIS on localhost:5432
```

Two databases are created on first start: `healthcare_dev` for development and
`healthcare_test` for the repository and API suites.

## Commands

```bash
pnpm db:migrate        # apply pending migrations, in order
pnpm db:verify         # assert the DATABASE.md §0 invariants
pnpm test              # unit tests + the schema suite
```

`pnpm db:seed` and `pnpm db:reset` arrive with step 5 (`feat/seed-demo`),
together with `seeds/seed_00` … `seed_07`.

## How the runner behaves

- **Forward-only.** There is no `down`. A mistake is corrected by the next
  numbered migration.
- **One transaction per file.** A failure rolls that file back, so the database
  is never left half-migrated.
- **Checksums are recorded.** Editing an applied migration stops the next run
  with the recorded and on-disk hashes, rather than pretending the database
  matches the repository. If the database is disposable:
  `docker compose down -v && docker compose up -d && pnpm db:migrate`.
- **It refuses remote targets.** `assertNotProduction` blocks anything that is
  neither a local host nor a `_dev`/`_test` database. Production migrations run
  from CI against an explicit target (BACKEND.md §12).

## The schema suite

`db/tests` drops the public schema of the `*_test` database, applies every
migration from scratch, and then attempts the writes the schema is supposed to
refuse — a constraint that is present but misspelled enforces nothing, and only
an attempted insert tells the difference.

Each test runs in a transaction that is rolled back. That is the only cleanup
the design permits: rows in `queue_events` cannot be deleted at all (DB-P1).

The test database name must end in `_test`. `DATABASE_URL_TEST` sets it
explicitly; otherwise it is derived from `DATABASE_URL` by swapping `_dev` for
`_test`, and the suite refuses to run if the result is not obviously
disposable — it drops schemas, and one day it would be pointed at something
that matters.

## Deviations from DATABASE.md worth knowing

Both are flagged for a document edit rather than settled silently:

1. **RLS is enabled in the migration that creates each table**, not deferred to
   `0014_rls.sql`. An enabled table with no policy denies all access to
   non-owner roles, so this fails safe for the several steps between now and
   0014; 0014 still adds the policies (DATABASE.md §5).
2. **`hospitals.settings_id` is not created.** `hospital_settings.hospital_id`
   is already the primary key and the foreign key, so the reverse link listed
   in DATABASE.md §2.2 would be a second source of truth for one relationship,
   free to drift.

A third point is a schema clarification rather than a deviation:
`queue_events.undone_by_event_id` is documented as "set when compensated",
which is necessarily after insert. The append-only trigger therefore permits
exactly one mutation — a null `undone_by_event_id` becoming set, with every
other column unchanged — and refuses everything else, including clearing it
again. The recorded fact stays immutable and undo still appends `ACTION_UNDONE`
(GR-02).
