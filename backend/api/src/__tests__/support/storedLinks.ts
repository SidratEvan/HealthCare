/**
 * Whether the outbox holds a link anywhere (`docs/PLATFORM_PLAN.md` 1.9).
 *
 * A tracking or status link is a credential (`FR-GST-05`): it goes into the
 * message that is sent and into nothing that is kept. This counts the rows
 * that break that, by either route — a `link` parameter, or an address inside
 * the stored text — across the whole table, because the rule has no
 * exceptions to scope it by.
 */

import { sql } from 'kysely';

import { db } from '../../config/db.js';

export async function rowsHoldingALink(): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n
      FROM notifications
     WHERE params ? 'link' OR params ->> 'body' ~ 'https?://'
  `.execute(db);
  return Number(result.rows[0]?.n ?? '0');
}
