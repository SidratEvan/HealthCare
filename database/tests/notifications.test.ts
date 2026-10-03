/**
 * What the outbox may hold (0035; `docs/PLATFORM_PLAN.md` 1.9; DATABASE.md
 * §2.7, §8).
 *
 * A tracking link is a credential (`FR-GST-05`), and the database is meant to
 * hold only its hash (`guest_links.token_hash`). Until 0035 the link itself
 * sat in every confirmation's `notifications.params`, twice — as a parameter
 * and inside the rendered text — so the hash protected nothing from anybody
 * who could read that table or a backup of it.
 *
 * The API no longer writes one. These tests are about the part the API cannot
 * promise by itself: that a database which already held links has none after
 * the migration, and that a later mistake is refused by PostgreSQL instead of
 * being stored.
 */

import { describe, expect, it } from 'vitest';

import { readMigrations } from '../scripts/lib/migrations.js';

import { expectRejection, withRollback } from './support/database.js';

import type { Client } from 'pg';

const LINK = 'https://app.example.test/s?b=0199&t=a-working-token';

/** A message as rows were written before 0035: the link kept twice. */
async function insertAsItUsedToBe(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO notifications (phone, channel, template_key, params)
     VALUES ('+8801712345678', 'sms', 'booking.confirmed', $1::jsonb)
     RETURNING id`,
    [
      JSON.stringify({
        bookingId: '01990000-0000-7000-8000-000000000001',
        serial: '৪',
        link: LINK,
        body: `আপনার সিরিয়াল ৪। লাইভ দেখুন: ${LINK}`,
      }),
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('the insert returned no row');
  return id;
}

describe('a stored link is refused (notifications_no_stored_link)', () => {
  it('rejects a row whose parameters carry a link', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () => insertAsItUsedToBe(client));

      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('notifications_no_stored_link');
    });
  });

  it('rejects one even when the link is empty, so the key cannot come back quietly', async () => {
    await withRollback(async (client) => {
      const error = await expectRejection(client, () =>
        client.query(
          `INSERT INTO notifications (phone, channel, template_key, params)
           VALUES ('+8801712345678', 'sms', 'queue.called', '{"link": ""}'::jsonb)`,
        ),
      );

      expect(error.constraint).toBe('notifications_no_stored_link');
    });
  });

  it('accepts the row the API writes: the words, with the link’s place marked', async () => {
    await withRollback(async (client) => {
      await client.query(
        `INSERT INTO notifications (phone, channel, template_key, params)
         VALUES ('+8801712345678', 'sms', 'booking.confirmed', $1::jsonb)`,
        [JSON.stringify({ serial: '৪', body: 'আপনার সিরিয়াল ৪। লাইভ দেখুন: {link}' })],
      );
    });
  });
});

describe('0035 on a database that already held links', () => {
  it('takes the link out of the parameters and out of the text, and keeps the rest', async () => {
    const migration = readMigrations().find((candidate) => candidate.version === '0035');
    if (migration === undefined) throw new Error('0035 is missing');

    await withRollback(async (client) => {
      // The database as it stood the day before: no constraint, no index, and
      // a confirmation holding its link.
      await client.query('ALTER TABLE notifications DROP CONSTRAINT notifications_no_stored_link');
      await client.query('DROP INDEX notifications_body_kept_idx');
      const id = await insertAsItUsedToBe(client);

      // The shipped file, whole, as the runner would apply it.
      await client.query(migration.sql);

      const { rows } = await client.query<{ params: Record<string, unknown> }>(
        'SELECT params FROM notifications WHERE id = $1',
        [id],
      );
      const params = rows[0]?.params ?? {};

      expect(JSON.stringify(params)).not.toContain('a-working-token');
      expect(params).not.toHaveProperty('link');
      expect(params['body']).toBe('আপনার সিরিয়াল ৪। লাইভ দেখুন: {link}');
      expect(params['serial']).toBe('৪');
      expect(params['bookingId']).toBe('01990000-0000-7000-8000-000000000001');
    });
  });
});

describe('the ninety-day purge can find its rows (DATABASE.md §8)', () => {
  it('has an index over only the rows that still hold a body', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ indexdef: string }>(
        `SELECT indexdef FROM pg_indexes
          WHERE schemaname = 'public' AND indexname = 'notifications_body_kept_idx'`,
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.indexdef).toMatch(/\(queued_at\)/);
      expect(rows[0]?.indexdef).toMatch(/WHERE \(params \? 'body'::text\)/);
    });
  });
});
