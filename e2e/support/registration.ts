/** Synthetic Registration evidence using the existing local fixtures
 * (FR-REC-20, FR-REC-14). Every database helper closes its own connection.
 */
import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';
export async function registrationDatabase<T>(work: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}
export async function registrationCounts(
  phone: string,
  sessionId: string,
): Promise<{ patients: number; bookings: number; walkins: number }> {
  return await registrationDatabase(async (client) => {
    const answer = await client.query<{ patients: number; bookings: number; walkins: number }>(
      `SELECT
      (SELECT count(*)::int FROM patients p JOIN guest_identities g ON p.owner_guest_id=g.id
        WHERE g.phone=$1 AND p.deleted_at IS NULL) AS patients,
      (SELECT count(*)::int FROM bookings WHERE session_id=$2 AND deleted_at IS NULL) AS bookings,
      (SELECT count(*)::int FROM queue_events WHERE session_id=$2 AND type='WALKIN_ADDED') AS walkins`,
      [phone, sessionId],
    );
    const row = answer.rows[0];
    if (row === undefined) throw new Error('Missing synthetic counters');
    return row;
  });
}
