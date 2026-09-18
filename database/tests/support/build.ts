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
