/**
 * Builds the test database once per `pnpm test` run.
 *
 * The public schema is dropped and every migration is applied from scratch,
 * which is the claim step 1 has to prove: the schema applies clean on a fresh
 * database, not merely on the one that happens to be on this machine.
 *
 * Individual tests then isolate themselves in a transaction they roll back
 * (see `withTransaction`), which is the only workable cleanup for an
 * append-only table: rows in `queue_events` cannot be deleted by design.
 */

import { Client } from 'pg';

import { resolveTestDatabaseUrl, describe as describeUrl } from '../../scripts/lib/env.js';
import { rebuildFromScratch } from '../../scripts/lib/migrations.js';

export default async function setup(): Promise<void> {
  const connectionString = resolveTestDatabaseUrl();
  const { host, database } = describeUrl(connectionString);

  const client = new Client({ connectionString, connectionTimeoutMillis: 5_000 });

  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      [
        `Cannot reach the test database "${database}" on "${host}".`,
        '',
        'The schema suite needs PostgreSQL:',
        '  docker compose up -d',
        '',
        `Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      ].join('\n'),
      { cause: error },
    );
  }

  try {
    await rebuildFromScratch(client);
  } finally {
    await client.end();
  }
}
