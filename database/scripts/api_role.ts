/**
 * `pnpm db:role` — creates, or brings back into line, the role the API
 * connects as (`lib/role.ts`).
 *
 * Run as the owner (`DATABASE_URL`), after `pnpm db:migrate`. The role's name
 * and password come from `API_DB_USER` and `API_DB_PASSWORD`; the API is then
 * given a connection string that names them instead of the owner
 * (`deploy/docker-compose.yml`).
 *
 * Safe to run on every start: it changes nothing that is already as it should
 * be, and it narrows anything that is not.
 */

import { Client } from 'pg';

import {
  PG_CONNECTION_OPTIONS,
  assertSafeTarget,
  describe,
  loadEnvFile,
  requireDatabaseUrl,
} from './lib/env.js';
import { ensureApiRole } from './lib/role.js';

/** Long enough that it was generated rather than chosen. */
const MIN_PASSWORD_LENGTH = 16;

async function main(): Promise<void> {
  const connectionString = requireDatabaseUrl('DATABASE_URL');
  // Adds a role and grants; removes no data. A remote host still needs opting into.
  assertSafeTarget(connectionString);

  loadEnvFile();
  const name = process.env['API_DB_USER'] ?? '';
  const password = process.env['API_DB_PASSWORD'] ?? '';

  if (name === '' || password === '') {
    throw new Error(
      [
        'API_DB_USER and API_DB_PASSWORD are not both set.',
        '',
        'They name the role the API connects as, which is not the role that',
        'owns the database (DEPLOY.md §S2).',
      ].join('\n'),
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `API_DB_PASSWORD is shorter than ${String(MIN_PASSWORD_LENGTH)} characters. Generate one (DEPLOY.md §S2).`,
    );
  }

  const { host, database } = describe(connectionString);
  const client = new Client({ connectionString, options: PG_CONNECTION_OPTIONS });
  await client.connect();

  try {
    await ensureApiRole(client, { name, password });
    console.log(`role ${name} is ready on ${database} at ${host}: rows only, no schema changes`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
