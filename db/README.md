# db — schema, seeds and scripts

Authority: `docs/DATABASE.md`. If this directory and that document disagree, the
document wins.

## Layout

```
migrations/   0001 … 0015, sequential, forward-only, one concern per file
seeds/        the demo database (FR-DEM-*)
  data/       the declared demo set — facilities, doctors, name pools
  lib/        the machinery — runner, seeded RNG, batch insert, event log
  seed_00 … seed_07, run.ts (order), seed.ts + reset.ts (commands), graph.ts
scripts/      migrate.ts, verify_schema.ts
docker/       first-run init for the local Postgres container
tests/        the schema suite and the seed suite
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
pnpm db:seed           # write the demo data into an empty database
pnpm db:reset          # truncate every application table, then reseed
pnpm test              # unit tests, the schema suite and the seed suite
```

Both refuse to run unless `DEMO_MODE=true`. Every row they write is labelled as
demonstration data (`FR-DEM-07`), and a database that is not in demo mode is
not a database to put it in (`FR-SEC-08`).

## The seeds

`seeds/` is the one description of demo data in this repository. `data/` holds
the **declared demo set** — six facilities, forty doctors, the name pools
patients are composed from — and CLAUDE.md §8 forbids inventing a facility,
practitioner or clinical string outside it. `lib/` holds the machinery; the
numbered modules write the rows; `run.ts` holds the order they run in.

The schema suite builds its fixtures from the same declaration
(`seeds/graph.ts`), so there is no second description to drift.

### It derives, it does not invent

`queue_state`, `bookings.status` and the projections on `sessions` are never
written directly. The seeds append a real event log and replay it through the
reducer in `@platform/domain`, then write whatever the reducer says (`DB-P1`).
A seed that wrote a plausible-looking cache would produce a demo that disagrees
with its own log the moment step 6 replays it.

### A reset is a known state, not merely a plausible one

Every random draw comes from one seeded generator (`DEMO_SEED` in
`lib/random.ts`), so the same reset produces the same screen twice — which is
what `FR-DEM-06` asks for and what the tests assert on. Changing that seed
changes the whole demo.

### Modules that cannot run yet say so

`seed_05_beds` needs migration 0008 and `seed_06_ancillary` needs 0011. The
runner checks each module's tables before calling it and skips with the
migration name and the requirement left uncovered, rather than producing an
empty ward board silently. `FR-DEM-04` and `FR-DEM-05` are therefore **not
covered in this version**; `seed_04_history` runs but defers prescriptions and
reports to migration 0007.

### Why `db:reset` truncates rather than dropping the schema

`DROP SCHEMA public CASCADE` on a Supabase project takes Supabase's own objects
with it. DATABASE.md §7 says "truncate + reseed in one command", and that is
what `reset.ts` does.

`queue_events` refuses TRUNCATE by trigger (`DB-P1`), so the reset disables
that one statement-level guard inside the same transaction as the truncate and
re-arms it before committing — then asserts, in a separate statement, that it
is armed. The row-level `trg_queue_events_no_mutate` is never touched, so no
recorded fact can be altered even during a reset.

Note that the comment in migration `0006_queue_events.sql` still says a reset
"drops the schema". It predates Supabase and cannot be corrected in place: a
shipped migration is never edited, and editing it would change its checksum and
stop the next `db:migrate`.

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
