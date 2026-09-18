/**
 * The migration runner.
 *
 * DATABASE.md §7: sequential, forward-only, one concern per file, and a
 * shipped migration is never edited. This enforces all four:
 *
 *   - files are applied in filename order, lowest first
 *   - each runs inside its own transaction, so a failure leaves no half-schema
 *   - there is no `down`; a mistake is corrected by the next migration
 *   - the checksum of every applied file is recorded, and a changed checksum
 *     stops the run rather than pretending the database matches the repository
 *
 * Exported as functions rather than hidden inside a CLI so the schema tests
 * can build a database from scratch the same way a developer does.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MIGRATIONS_DIR } from './env.js';

import type { Client } from 'pg';

/** A migration file on disk. */
export interface Migration {
  /** Zero-padded numeric prefix, e.g. `0006`. */
  readonly version: string;
  /** Full filename, e.g. `0006_queue_events.sql`. */
  readonly filename: string;
  readonly sql: string;
  /** SHA-256 of the file contents, hex. */
  readonly checksum: string;
}

/** A row of the ledger table. */
interface AppliedRow {
  readonly version: string;
  readonly filename: string;
  readonly checksum: string;
}

export interface ApplyResult {
  readonly applied: readonly Migration[];
  readonly alreadyApplied: number;
}

const MIGRATION_FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

/**
 * The ledger. Created outside the numbered migrations because it has to exist
 * before the first one can be recorded, and excluded from the DB-P3 timestamp
 * invariants by `verify_schema` for the same reason: it is infrastructure, not
 * an application table.
 */
const LEDGER_DDL = [
  `CREATE TABLE IF NOT EXISTS schema_migrations (
     version     text        PRIMARY KEY,
     filename    text        NOT NULL,
     checksum    text        NOT NULL,
     applied_at  timestamptz NOT NULL DEFAULT now(),
     duration_ms integer     NOT NULL
   )`,
  // DB-P8 has no exceptions, including for this table. Nothing but the owner
  // and the service role has any business reading which migrations a database
  // is on, and a rule with one exemption acquires a second.
  'ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY',
];

/** Reads and validates every migration file, in application order. */
export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const filenames = readdirSync(dir)
    .filter((name) => name.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));

  const migrations: Migration[] = [];
  const seenVersions = new Map<string, string>();

  for (const filename of filenames) {
    const match = MIGRATION_FILENAME.exec(filename);
    if (match === null) {
      throw new Error(
        `Migration filename "${filename}" is not of the form NNNN_lower_snake_case.sql (DATABASE.md §7).`,
      );
    }

    const version = match[1];
    if (version === undefined) {
      throw new Error(`Migration filename "${filename}" has no version prefix.`);
    }

    const duplicate = seenVersions.get(version);
    if (duplicate !== undefined) {
      throw new Error(
        `Two migrations share version ${version}: "${duplicate}" and "${filename}". Order would be ambiguous.`,
      );
    }
    seenVersions.set(version, filename);

    const sql = readFileSync(join(dir, filename), 'utf8');
    migrations.push({
      version,
      filename,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  return migrations;
}

/**
 * Applies every migration the database has not seen yet.
 *
 * @param log called once per migration, and once per skipped migration when
 *   `verbose` is set. Injected so tests stay silent and the CLI can print.
 */
export async function applyMigrations(
  client: Client,
  options: { readonly log?: (message: string) => void; readonly verbose?: boolean } = {},
): Promise<ApplyResult> {
  const log = options.log ?? ((): void => undefined);

  for (const statement of LEDGER_DDL) {
    await client.query(statement);
  }

  const { rows: appliedRows } = await client.query<AppliedRow>(
    'SELECT version, filename, checksum FROM schema_migrations',
  );
  const alreadyApplied = new Map(appliedRows.map((row) => [row.version, row]));

  const migrations = readMigrations();
  const applied: Migration[] = [];

  for (const migration of migrations) {
    const previous = alreadyApplied.get(migration.version);

    if (previous !== undefined) {
      if (previous.checksum !== migration.checksum) {
        throw new Error(
          [
            `Migration ${migration.filename} has changed since it was applied.`,
            '',
            `  recorded: ${previous.checksum.slice(0, 16)}…`,
            `  on disk:  ${migration.checksum.slice(0, 16)}…`,
            '',
            'A shipped migration is never edited (DATABASE.md §7). Add the next',
            'numbered migration instead. If this database is disposable, rebuild it:',
            '  docker compose down -v && docker compose up -d && pnpm db:migrate',
          ].join('\n'),
        );
      }
      if (options.verbose === true) log(`  = ${migration.filename} (already applied)`);
      continue;
    }

    const startedAt = process.hrtime.bigint();
    try {
      await client.query('BEGIN');
      await client.query(migration.sql);
      const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);
      await client.query(
        `INSERT INTO schema_migrations (version, filename, checksum, duration_ms)
         VALUES ($1, $2, $3, $4)`,
        [migration.version, migration.filename, migration.checksum, durationMs],
      );
      await client.query('COMMIT');
      log(`  + ${migration.filename} (${String(durationMs)} ms)`);
      applied.push(migration);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${migration.filename} failed and was rolled back:\n${describeError(error)}`,
        { cause: error },
      );
    }
  }

  return { applied, alreadyApplied: alreadyApplied.size };
}

/**
 * Drops and recreates the public schema, then applies every migration.
 *
 * Used by the schema tests, which have to prove the claim that matters for
 * step 1: the schema applies clean on a *fresh* database, not merely on the
 * one that happens to be on this machine.
 */
export async function rebuildFromScratch(
  client: Client,
  options: { readonly log?: (message: string) => void } = {},
): Promise<ApplyResult> {
  // PostGIS installs into public; dropping the schema takes the extension with
  // it, and 0001 puts it back.
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  return await applyMigrations(client, options);
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const detail = (error as { detail?: unknown }).detail;
    const hint = (error as { hint?: unknown }).hint;
    const position = (error as { position?: unknown }).position;
    return [
      error.message,
      typeof detail === 'string' ? `  detail: ${detail}` : undefined,
      typeof hint === 'string' ? `  hint: ${hint}` : undefined,
      typeof position === 'string' ? `  position: ${position}` : undefined,
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n');
  }
  return String(error);
}
