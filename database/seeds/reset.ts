/**
 * `pnpm db:reset` — truncate every application table and reseed, in one
 * command (`FR-DEM-06`).
 *
 * ## Why it truncates rather than dropping the schema
 *
 * Migration `0006_queue_events.sql` says, in a comment, that `db:reset`
 * "rebuilds the demo database by dropping the schema, not by truncating the
 * log". That was written before this database lived on Supabase, and it is no
 * longer the right instruction: `DROP SCHEMA public CASCADE` on a Supabase
 * project takes Supabase's own objects with it — the auth schema's grants, the
 * PostgREST-facing views, the roles' default privileges — and leaves a project
 * that needs repairing rather than reseeding. DATABASE.md §7, which is the
 * authority, says "truncate + reseed in one command". That is what this does.
 *
 * The migration's comment cannot be corrected in place: a shipped migration is
 * never edited (DATABASE.md §7), and editing it would change its checksum and
 * stop the next `db:migrate`. The discrepancy is recorded in `docs/STATUS.md`.
 *
 * ## The append-only log refuses TRUNCATE, deliberately
 *
 * `trg_queue_events_no_truncate` is a statement-level `BEFORE TRUNCATE` guard
 * (DB-P1). It exists because TRUNCATE bypasses row triggers entirely, so
 * without it the one table that settles disputes could be emptied by accident.
 *
 * `trg_bed_events_no_truncate` (migration 0008) guards the bed history the same
 * way, because DATABASE.md §2.5 makes it "append-only like the queue".
 *
 * This command therefore does something it has to do **visibly**: it disables
 * those triggers, inside the same transaction as the truncate, and re-enables
 * them before committing. Three things make that narrow rather than a loophole:
 *
 *   1. `ALTER TABLE … DISABLE TRIGGER` is transactional, so any failure rolls
 *      the guard back into place along with everything else.
 *   2. Only the TRUNCATE guard is touched. `trg_queue_events_no_mutate` — the
 *      row-level trigger that refuses UPDATE and DELETE — stays armed
 *      throughout, so no individual recorded fact can be altered even here.
 *   3. The state of the trigger is asserted afterwards, in a fresh statement.
 *      A reset that left the log unguarded would be worse than one that failed.
 */

import { Client } from 'pg';

import {
  PG_CONNECTION_OPTIONS,
  assertSafeTarget,
  describe,
  requireDatabaseUrl,
} from '../scripts/lib/env.js';

import { assertDemoMode } from './lib/demo-mode.js';
import { one } from './lib/insert.js';
import { seedDemoData } from './run.js';

/**
 * The append-only logs' TRUNCATE guards: the queue's (migration 0006) and the
 * bed history's (0008, "append-only like the queue" — DATABASE.md §2.5).
 */
interface TruncateGuard {
  readonly table: string;
  readonly trigger: string;
}

const TRUNCATE_GUARDS: readonly TruncateGuard[] = [
  { table: 'queue_events', trigger: 'trg_queue_events_no_truncate' },
  { table: 'bed_events', trigger: 'trg_bed_events_no_truncate' },
];

/**
 * Tables a reset must never touch.
 *
 * `schema_migrations` is the ledger: emptying it would make the next
 * `db:migrate` try to reapply every migration onto a schema that already has
 * them. Extension-owned tables — PostGIS's `spatial_ref_sys` above all — are
 * not ours to shape, and are excluded by ownership rather than by name so a
 * future extension is covered without an edit here.
 */
const NEVER_TRUNCATE = new Set(['schema_migrations']);

/** A catalog identifier we are willing to interpolate into DDL. */
const SAFE_IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

async function main(): Promise<void> {
  const variable = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  const connectionString = requireDatabaseUrl(variable);

  // Truncating is destructive, so on a remote host this needs both opt-ins:
  // ALLOW_REMOTE_DB=1 ALLOW_DESTRUCTIVE_DB=1.
  assertSafeTarget(connectionString, { destructive: true });
  assertDemoMode('pnpm db:reset');

  const { host, database } = describe(connectionString);
  console.log(`resetting ${database} on ${host}`);

  const client = new Client({ connectionString, options: PG_CONNECTION_OPTIONS });
  await client.connect();

  try {
    const tables = await truncatableTables(client);
    if (tables.length === 0) {
      throw new Error('No application tables found. Run `pnpm db:migrate` before `pnpm db:reset`.');
    }

    // Only the guards whose table this database has: a reset of a schema that
    // has not reached 0008 must not fail looking for `bed_events`.
    const guards = TRUNCATE_GUARDS.filter((guard) => tables.includes(guard.table));

    await truncate(client, tables, guards);
    console.log(`  - truncated ${String(tables.length)} tables, identities restarted`);

    for (const guard of guards) await assertGuardArmed(client, guard);

    const { totals, now } = await seedDemoData(client, {
      log: (message) => {
        console.log(message);
      },
    });

    console.log(`\nreset complete, anchored at ${now}:`);
    for (const [table, rows] of Object.entries(totals)) {
      console.log(`  ${table.padEnd(20)} ${String(rows)}`);
    }
    console.log('\nEvery row above is demonstration data (FR-DEM-07).');
  } finally {
    await client.end();
  }
}

/**
 * Every table a reset should empty: ordinary tables in `public` that are
 * neither the migration ledger nor owned by an extension.
 *
 * Read from the catalog rather than listed, so a table added by a later
 * migration is included without anyone remembering to come back here.
 */
async function truncatableTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>(
    `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
           WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e'
        )
      ORDER BY c.relname`,
  );

  const names: string[] = [];
  for (const row of rows) {
    if (NEVER_TRUNCATE.has(row.name)) continue;
    if (!SAFE_IDENTIFIER.test(row.name)) {
      throw new Error(
        `Refusing to truncate "${row.name}": the name is not a plain lower-case identifier, and this command builds DDL from it.`,
      );
    }
    names.push(row.name);
  }
  return names;
}

/**
 * One transaction: disarm the logs' TRUNCATE guards, empty everything, rearm.
 *
 * `CASCADE` because the tables reference each other and PostgreSQL requires
 * every table in a foreign-key graph to be truncated together. `RESTART
 * IDENTITY` so `queue_events.seq` begins at 1 again — the demo is supposed to
 * be a *known* state (`FR-DEM-06`), and a sequence that carries over from the
 * last reset makes every event id in a screenshot different from the one
 * before.
 */
async function truncate(
  client: Client,
  tables: readonly string[],
  guards: readonly TruncateGuard[],
): Promise<void> {
  const list = tables.map((name) => `public."${name}"`).join(', ');

  await client.query('BEGIN');
  try {
    // Narrow and temporary: only the statement-level TRUNCATE guards, and only
    // for the duration of this transaction. The row-level UPDATE/DELETE guards
    // — `trg_queue_events_no_mutate`, `trg_bed_events_no_mutate` — are
    // untouched and stay armed.
    for (const guard of guards) {
      await client.query(`ALTER TABLE ${guard.table} DISABLE TRIGGER ${guard.trigger}`);
    }
    await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    for (const guard of guards) {
      await client.query(`ALTER TABLE ${guard.table} ENABLE TRIGGER ${guard.trigger}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    // The ALTER is transactional too, so the guard goes back with everything
    // else. Nothing to repair by hand.
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Proves the guard is armed again, in a statement of its own.
 *
 * `tgenabled` is `'O'` for a trigger that fires on origin — the state
 * `CREATE TRIGGER` leaves it in — and `'D'` for one that is disabled. A reset
 * that finished with the append-only log unprotected would be worse than a
 * reset that failed, so this is checked rather than assumed.
 */
async function assertGuardArmed(client: Client, guard: TruncateGuard): Promise<void> {
  const row = await one<{ tgenabled: string }>(
    client,
    `SELECT t.tgenabled
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
      WHERE c.relname = $1 AND t.tgname = $2`,
    [guard.table, guard.trigger],
  );

  if (row.tgenabled !== 'O') {
    throw new Error(
      [
        `${guard.trigger} is "${row.tgenabled}", not "O": the append-only log`,
        `${guard.table} is not protected against TRUNCATE (DB-P1).`,
        '',
        'Re-arm it before using this database:',
        `  ALTER TABLE ${guard.table} ENABLE TRIGGER ${guard.trigger};`,
      ].join('\n'),
    );
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
