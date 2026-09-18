/**
 * Test database helpers.
 *
 * Every test runs inside a transaction that is rolled back afterwards. That is
 * not merely tidy: `queue_events` is append-only by trigger (DB-P1), so rows
 * written by a test cannot be deleted at all. A rolled-back transaction is the
 * only cleanup the design permits, and it also lets the whole suite share one
 * database without ordering games.
 */

import { Client } from 'pg';

import { PG_CONNECTION_OPTIONS, resolveTestDatabaseUrl } from '../../scripts/lib/env.js';

/** Opens a client against the test database built by the global setup. */
export async function connect(): Promise<Client> {
  const client = new Client({
    connectionString: resolveTestDatabaseUrl(),
    options: PG_CONNECTION_OPTIONS,
  });
  await client.connect();
  return client;
}

/**
 * Runs `body` inside a transaction and always rolls back.
 *
 * @returns whatever `body` returns, so a test can assert on values read inside
 *   the transaction.
 */
export async function withRollback<T>(body: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    await client.query('BEGIN');
    return await body(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

let savepointCounter = 0;

/**
 * Asserts that `body` fails, and returns the error so the caller can check
 * which rule rejected it.
 *
 * A test that merely expects "some error" passes when the wrong constraint
 * fires, which is how a schema quietly stops enforcing what it claims to.
 *
 * The statement runs inside a savepoint that is rolled back on failure. Without
 * it, PostgreSQL aborts the enclosing transaction and every later statement
 * fails with "current transaction is aborted" — so a test asserting two
 * rejections in a row would see the second one pass for the wrong reason, and
 * would keep passing after the constraint it is guarding had been dropped.
 */
export async function expectRejection(
  client: Client,
  body: () => Promise<unknown>,
): Promise<DatabaseError> {
  const savepoint = `expect_rejection_${String(++savepointCounter)}`;
  await client.query(`SAVEPOINT ${savepoint}`);

  try {
    await body();
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    return asDatabaseError(error);
  }

  await client.query(`RELEASE SAVEPOINT ${savepoint}`);
  throw new Error('Expected the statement to be rejected, but it succeeded.');
}

export interface DatabaseError {
  readonly message: string;
  /** PostgreSQL SQLSTATE, e.g. `23514` for a check violation. */
  readonly code: string | undefined;
  /** Name of the constraint that rejected the statement, when there was one. */
  readonly constraint: string | undefined;
}

function asDatabaseError(error: unknown): DatabaseError {
  if (error instanceof Error) {
    const { code, constraint } = error as { code?: unknown; constraint?: unknown };
    return {
      message: error.message,
      code: typeof code === 'string' ? code : undefined,
      constraint: typeof constraint === 'string' ? constraint : undefined,
    };
  }
  return { message: String(error), code: undefined, constraint: undefined };
}
