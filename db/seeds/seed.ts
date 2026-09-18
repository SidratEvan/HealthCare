/**
 * `pnpm db:seed` — write the demo data into an empty database.
 *
 * Refuses a database that already holds demo rows. The seeds are not
 * idempotent and were not written to be: a second run would issue a second
 * `DEMO-00001` and fail on `doctors_bmdc_number_key`, or worse, half-succeed.
 * `pnpm db:reset` is the command that rebuilds, and this one points at it
 * rather than guessing what the operator meant.
 */

import { Client } from 'pg';

import {
  PG_CONNECTION_OPTIONS,
  assertSafeTarget,
  describe,
  requireDatabaseUrl,
} from '../scripts/lib/env.js';

import { assertDemoMode } from './lib/demo-mode.js';
import { count } from './lib/insert.js';
import { seedDemoData } from './run.js';

async function main(): Promise<void> {
  const variable = process.argv.includes('--test') ? 'DATABASE_URL_TEST' : 'DATABASE_URL';
  const connectionString = requireDatabaseUrl(variable);

  // Seeding adds rows; it destroys none. A remote host still has to be opted
  // into with `ALLOW_REMOTE_DB=1`, because adding rows to a pilot hospital's
  // database is not a small thing either.
  assertSafeTarget(connectionString);
  assertDemoMode('pnpm db:seed');

  const { host, database } = describe(connectionString);
  console.log(`seeding ${database} on ${host}`);

  const client = new Client({ connectionString, options: PG_CONNECTION_OPTIONS });
  await client.connect();

  try {
    const existing = await count(client, 'hospitals');
    if (existing > 0) {
      throw new Error(
        [
          `"${database}" already holds ${String(existing)} facilities.`,
          '',
          'The seeds are not idempotent: a second run would reissue the same',
          'BMDC numbers and staff emails and fail on a unique index halfway',
          'through. To rebuild the demo from scratch:',
          '',
          '  pnpm db:reset',
        ].join('\n'),
      );
    }

    const { totals, now } = await seedDemoData(client, {
      log: (message) => {
        console.log(message);
      },
    });

    console.log(`\nseeded, anchored at ${now}:`);
    for (const [table, rows] of Object.entries(totals)) {
      console.log(`  ${table.padEnd(20)} ${String(rows)}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
