/**
 * "Now", by the database's clock.
 *
 * A test that asks for the rows written *since* a moment has to take that
 * moment from the clock that stamps the rows. `created_at` is PostgreSQL's
 * `now()`; `new Date()` is this machine's. They are two clocks — the database
 * runs in a container, in a virtual machine — and they lean either way by a
 * few milliseconds: measured on one afternoon, the database's ran between
 * 4.1 ms ahead and 1.4 ms behind, and changed sign with nothing more than the
 * machine getting busy.
 *
 * A few milliseconds is also how long a request takes to reach its first
 * statement. So `created_at >= new Date()` held when the database's clock
 * leant ahead and missed its own row when it leant behind — a row that was
 * there, in a test that then reported "nothing was written". It failed the
 * gate once and passed on every run before it.
 *
 * The value comes back at the driver's millisecond precision, which rounds it
 * *down*: anything stamped afterwards compares as later.
 */

import { sql } from 'kysely';

import { db } from '../../config/db.js';

export async function databaseNow(): Promise<Date> {
  const result = await sql<{ at: Date }>`SELECT clock_timestamp() AS at`.execute(db);

  const at = result.rows[0]?.at;
  if (at === undefined) throw new Error('the database did not say what time it is');
  return at;
}
