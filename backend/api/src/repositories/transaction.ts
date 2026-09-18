/**
 * The unit of work a service composes repository calls inside.
 *
 * ## Why this exists
 *
 * `appendEvent` has to take the session lock, read the log, append, and write
 * three sets of derived rows as one atomic act (BACKEND.md §4.1). That needs a
 * transaction handle threaded through several repositories — and the obvious
 * way to do it, importing `Transaction` from `kysely` into the service, is
 * exactly what the layering rule forbids and lint caught.
 *
 * The rule is right. "SQL lives in repositories only" (CLAUDE.md §7) is not
 * about the `sql` tag specifically; it is about which layer knows there is a
 * query builder at all. A service that imports Kysely's types is a service one
 * convenient line away from building a query.
 *
 * So the handle is opaque from above. A service names `Tx`, passes it to
 * repositories, and cannot do anything with it — the type is re-exported here
 * precisely so that the only module able to *use* one is a repository.
 */

import { db } from '../config/db.js';

import type { Database } from '../config/schema.js';
import type { Transaction } from 'kysely';

/**
 * A transaction in progress.
 *
 * Opaque by intent: a service holds one and hands it to repositories. Treat it
 * as a token, not as a database connection.
 */
export type Tx = Transaction<Database>;

/**
 * Runs `body` inside one transaction, committing on return and rolling back on
 * a throw.
 *
 * Every queue mutation goes through here, which is what makes the append and
 * the derived rows that follow it a single fact rather than four writes that
 * might half-land.
 */
export async function withTransaction<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction().execute(body);
}
