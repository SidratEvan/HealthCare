/**
 * A patient's tracking link, written the way the API writes one
 * (`booking.service.issueTrackingLink`, `FR-GST-05`).
 *
 * The other specs get a link by booking through the patient app. Under the
 * production configuration that cannot be done: a guest's phone is proved with
 * a code first (`FR-GST-03`), the code travels by SMS, and no SMS provider
 * exists yet (`docs/STATUS.md`, the first blocker). So there the link is made
 * here — the row an SMS would have pointed at — and everything after it is the
 * product: `GET /guest/link/:token` exchanges it, the socket joins the
 * session, the page shows the queue.
 *
 * Only the SHA-256 of the token is stored, as in the API; the token itself
 * exists in the returned address and nowhere else.
 */

import { createHash, randomBytes } from 'node:crypto';

import { Client } from 'pg';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

const PATIENT = 'http://localhost:3000';

export async function issueTrackingLink(bookingId: string): Promise<string> {
  assertLocalDatabase();

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  // `DB-P6`: normalised, and in a range no seeded person holds.
  const phone = `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;

  const client = new Client({
    connectionString: E2E_DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();

  try {
    const guest = await client.query<{ id: string }>(
      `INSERT INTO guest_identities (phone, display_name, phone_verified_at)
       VALUES ($1, 'রহিমা খাতুন (ডেমো)', now())
       RETURNING id`,
      [phone],
    );
    const guestId = guest.rows[0]?.id;
    if (guestId === undefined) throw new Error('guest identity insert returned no id.');

    // A day, as the API gives a link past the chamber's end.
    await client.query(
      `INSERT INTO guest_links (booking_id, guest_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [bookingId, guestId, tokenHash],
    );
  } finally {
    await client.end();
  }

  const url = new URL('/s', PATIENT);
  url.searchParams.set('b', bookingId);
  url.searchParams.set('t', token);
  return url.toString();
}
