/**
 * Builds a test database from scratch: migrations, then the demo seed.
 *
 * Shared by both suites' global setups, which differ only in which database
 * they point at. The schema suite and the API suite each get their own,
 * because the API suite mutates the demo data — it creates sessions, appends
 * to a log that cannot be cleaned up, drives queues to completion — while the
 * schema suite asserts on exact counts of the seeded set. One database between
 * them would make each suite's result depend on which vitest started first,
 * and a test whose outcome depends on ordering is a flake, which CLAUDE.md §6
 * calls a bug rather than a nuisance.
 *
 * Both are seeded the same way, so both still run against real demo data and
 * neither invents fixtures of its own (CLAUDE.md §6).
 */

import { Client } from 'pg';

import {
  PG_CONNECTION_OPTIONS,
  assertSafeTarget,
  describe as describeUrl,
} from '../../scripts/lib/env.js';
import { rebuildFromScratch } from '../../scripts/lib/migrations.js';
import { seedDemoData } from '../../seeds/run.js';

export async function buildTestDatabase(connectionString: string, label: string): Promise<void> {
  const { host, database } = describeUrl(connectionString);

  // Dropped and rebuilt, so on a remote host this needs saying out loud
  // whatever the database happens to be called.
  assertSafeTarget(connectionString, { destructive: true });

  await ensureDatabaseExists(connectionString, label);

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5_000,
    options: PG_CONNECTION_OPTIONS,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      [
        `Cannot reach the ${label} database "${database}" on "${host}".`,
        '',
        'The suite needs PostgreSQL:',
        '  docker compose up -d',
        '',
        'If the container predates this database, recreate it:',
        '  docker compose down -v && docker compose up -d',
        '',
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'),
      { cause: error },
    );
  }

  try {
    await rebuildFromScratch(client);
    await seedDemoData(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates the database if it is not there yet.
 *
 * `database/docker/init/` creates all three on a container's **first** start
 * and never again, so anyone whose volume predates a new one does not have it
 * — and a CI service container never runs those scripts at all. Both failed
 * the same way, with a `3D000` from deep inside vitest's global setup that
 * says nothing about which database or why.
 *
 * Creating it here rather than in each environment's setup means the suite
 * works on a fresh checkout, on a stale container and in CI without three
 * separate fixes that can drift. The name is already guarded: `assertDisposable`
 * in `env.ts` refuses anything not ending in `_test`, and `assertSafeTarget`
 * has already refused a remote host.
 */
async function ensureDatabaseExists(connectionString: string, label: string): Promise<void> {
  const { database } = describeUrl(connectionString);

  // `postgres` always exists and is what a server is administered through.
  const admin = new URL(connectionString);
  admin.pathname = '/postgres';

  const client = new Client({
    connectionString: admin.toString(),
    connectionTimeoutMillis: 5_000,
    options: PG_CONNECTION_OPTIONS,
  });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      [
        `Cannot reach PostgreSQL to create the ${label} database "${database}".`,
        '',
        'The suite needs PostgreSQL:',
        '  docker compose up -d',
        '',
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'),
      { cause: error },
    );
  }

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rows.length > 0) return;

    // The name cannot be parameterised in DDL. It comes from our own resolver
    // and has already been checked to end in `_test`; this refuses anything
    // that is not a plain identifier rather than interpolating it blindly.
    if (!/^[a-z_][a-z0-9_]*$/.test(database)) {
      throw new Error(`Refusing to create a database named "${database}".`);
    }

    await client.query(`CREATE DATABASE "${database}"`);
  } finally {
    await client.end();
  }
}
