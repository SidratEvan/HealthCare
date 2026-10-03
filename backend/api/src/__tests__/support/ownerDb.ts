/**
 * A connection as the role that owns the test database, for clearing up.
 *
 * The API under test connects as the role it has on a hospital's server
 * (`env.setup.ts`): rows only, and not even that on the tables whose history
 * is the point of them — it cannot delete an audit row. That is what is being
 * tested, so it is not loosened for the tests' convenience (`CLAUDE.md` §8).
 *
 * A test that made a whole facility still has to remove it afterwards, audit
 * rows included, or the next file counts them. That removal is the test's own
 * housekeeping, not something the API does, so it runs as the owner — the role
 * that built this database a moment ago — and through nothing but this helper.
 */

import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';

import type { Database } from '../../config/schema.js';

export async function asOwner<T>(work: (owner: Kysely<Database>) => Promise<T>): Promise<T> {
  const connectionString = process.env['DATABASE_URL_OWNER_TEST'];
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL_OWNER_TEST is not set; env.setup.ts sets it.');
  }

  const owner = new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: 1,
        options: '-c search_path=public,extensions',
      }),
    }),
  });

  try {
    return await work(owner);
  } finally {
    await owner.destroy();
  }
}
