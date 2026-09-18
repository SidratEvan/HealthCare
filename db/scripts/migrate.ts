/**
 * `pnpm db:migrate` — applies every pending migration, in order.
 *
 * Forward-only. There is no rollback: a mistake is corrected by the next
 * numbered migration, never by editing or reversing a shipped one
 * (DATABASE.md §7).
 */

import { Client } from 'pg';

import { assertNotProduction, describe, requireDatabaseUrl } from './lib/env.js';
import { applyMigrations } from './lib/migrations.js';

async function main(): Promise<void> {
  const variable = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  const connectionString = requireDatabaseUrl(variable);
  assertNotProduction(connectionString);

  const { host, database } = describe(connectionString);
  console.log(`migrating ${database} on ${host}`);

  const client = new Client({ connectionString });
  await client.connect();

  try {
    const { applied, alreadyApplied } = await applyMigrations(client, {
      log: (message) => {
        console.log(message);
      },
      verbose: process.argv.includes('--verbose'),
    });

    if (applied.length === 0) {
      console.log(`up to date — ${String(alreadyApplied)} migration(s) already applied`);
    } else {
      console.log(
        `applied ${String(applied.length)} migration(s); ${String(alreadyApplied + applied.length)} total`,
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
