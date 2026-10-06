/**
 * The Kysely instance and the connection pool (BACKEND.md §3).
 *
 * The bottom of the layering chain: `routes → controllers → services →
 * repositories → db`. Nothing above `repositories` may import this file, and
 * lint enforces that — `import-x/no-restricted-paths` blocks the path and
 * `no-restricted-imports` blocks `kysely` itself outside a repository. Both
 * exist because SQL scattered through services is how an event log stops being
 * the only truth about a queue.
 */

import { Kysely, PostgresDialect, type LogEvent } from 'kysely';
import { Pool, types, type PoolClient } from 'pg';

import { env, isProduction } from '../env.js';

import { currentDbScope, statementOf } from './dbScope.js';
import { logger } from './logger.js';

import type { Database } from './schema.js';

/**
 * `bigint` and `numeric` arrive as strings, which is pg's default and the
 * right one: `queue_events.seq` is a bigserial, and silently narrowing it to a
 * double would start losing precision. The schema types say `string` to match.
 *
 * `int8` is OID 20. Set explicitly rather than relied on, because a future
 * `pg-types` default change would corrupt sequence numbers quietly.
 */
types.setTypeParser(20, (value) => value);

/**
 * `date` (OID 1082) arrives as a string rather than a Date.
 *
 * `session_date` is a calendar date in Asia/Dhaka (DB-P4). Parsing it into a
 * Date applies the server's local zone and can shift it by a day, which would
 * put a chamber on the wrong date for everyone reading it.
 */
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  // A connection that cannot be had in five seconds is a readiness problem,
  // not something to queue a receptionist's tap behind.
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  // Every statement is bounded. A runaway query holding a row lock on
  // `sessions` would stall every counter driving that session (FR-QUE-53).
  statement_timeout: 15_000,
  query_timeout: 15_000,
  application_name: 'healthcare-api',
  // PostGIS, pgcrypto and earthdistance live in the `extensions` schema
  // (migration 0001), which is not on the default search_path. Without this,
  // `ST_MakePoint` and `geography` are unresolvable and the emergency geo
  // search fails at runtime rather than at migration time (FR-PAT-43).
  options: '-c search_path=public,extensions',
});

pool.on('error', (error) => {
  // An idle client erroring is usually the database restarting. Log it and let
  // the pool replace the connection; do not take the process down.
  logger.error({ err: error }, 'idle database client error');
});

/** What each connection was last told it is working for. */
const stated = new WeakMap<PoolClient, string>();

/**
 * Takes a connection and states on it who it is working for
 * (`config/dbScope.ts`, migration 0043, `FR-SEC-11`).
 *
 * Before anything else runs on it, every time it leaves the pool: a
 * connection last used for one hospital must never serve another under the
 * first one's name. The statement is for the session, not the transaction, so
 * that it holds for a single query and for a transaction alike; it is skipped
 * only when the connection already says exactly this, which on a server with
 * one hospital is nearly always.
 *
 * A connection the scope could not be stated on is destroyed, not returned:
 * it must not be used saying something else.
 */
async function connectScoped(): Promise<PoolClient> {
  const client = await pool.connect();
  const saying = statementOf(currentDbScope());
  const key = `${saying.scope}|${saying.hospitalId}`;
  if (stated.get(client) === key) return client;

  try {
    await client.query(
      "SELECT set_config('app.scope', $1, false), set_config('app.hospital_id', $2, false)",
      [saying.scope, saying.hospitalId],
    );
    stated.set(client, key);
    return client;
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }
}

export const db = new Kysely<Database>({
  dialect: new PostgresDialect({
    // Kysely asks for a connection through this, and only this.
    // `options` is the pool's own: Kysely reads it to open the side
    // connection a cancelled query is cancelled on.
    pool: { connect: connectScoped, end: async () => await pool.end(), options: pool.options },
  }),
  log: (event: LogEvent) => {
    if (event.level === 'error') {
      // The SQL is logged, the parameters are not: they carry phone numbers,
      // names and clinical content (CLAUDE.md §7).
      logger.error(
        { sql: event.query.sql, durationMs: Math.round(event.queryDurationMillis) },
        'query failed',
      );
      return;
    }

    // Slow queries only. Logging every statement on a console that taps `next`
    // 150 times a day buries the ones that matter.
    if (!isProduction() && event.queryDurationMillis > 200) {
      logger.warn(
        { sql: event.query.sql, durationMs: Math.round(event.queryDurationMillis) },
        'slow query',
      );
    }
  },
});

/** Closes the pool. Called by the graceful shutdown in `server.ts`. */
export async function closeDatabase(): Promise<void> {
  await db.destroy();
}
