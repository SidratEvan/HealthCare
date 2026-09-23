/**
 * Guest identities, their patient records, and their tracking links
 * (DATABASE.md §2.1, `FR-GST`).
 *
 * "Guest mode is a first-class path, not a degraded one" (`FR-GST-01`). The
 * rows here are the same rows an account holder gets — a `patients` record, a
 * `bookings` row — differing only in which column owns them. Nothing about a
 * guest booking is a lesser record, because the person is receiving the same
 * care.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/**
 * The identity for a phone number, created on first use.
 *
 * Keyed by phone so a second booking from the same number finds the same
 * identity (`FR-GST-12`) — which is what lets the app offer one-tap confirm
 * instead of asking for the same details again, and what makes the records
 * claimable later (`FR-GST-09`).
 *
 * `ON CONFLICT` rather than select-then-insert: two people booking for the
 * same household phone in the same second would otherwise race, and the
 * partial unique index on live rows would refuse the second.
 */
export async function findOrCreateIdentity(
  trx: Tx,
  input: { readonly phone: string; readonly displayName: string },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO guest_identities (phone, display_name)
    VALUES (${input.phone}, ${input.displayName})
    ON CONFLICT (phone) WHERE deleted_at IS NULL
      DO UPDATE SET display_name = COALESCE(guest_identities.display_name, excluded.display_name)
    RETURNING id
  `.execute(trx);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('guest_identities upsert returned no id.');
  return id;
}

/** The identity behind a phone, or null. */
export async function identityIdForPhone(phone: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM guest_identities WHERE phone = ${phone} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

/**
 * The patient record a guest booking is for.
 *
 * Reuses the guest's own profile when the details match, because `FR-GST-12`
 * means a returning guest should not re-enter what they already gave. A
 * different name creates a second profile under the same identity — a parent
 * booking for a child is the common case, and collapsing them would put a
 * child's visit in an adult's record (`FR-PAT-03`).
 */
export async function findOrCreatePatient(
  trx: Tx,
  input: {
    readonly guestId: string;
    readonly fullName: string;
    readonly ageYears: number;
    readonly sex: string;
    readonly phone: string;
  },
): Promise<string> {
  const existing = await sql<{ id: string }>`
    SELECT id FROM patients
     WHERE owner_guest_id = ${input.guestId}
       AND full_name = ${input.fullName}
       AND deleted_at IS NULL
     LIMIT 1
  `.execute(trx);

  const found = existing.rows[0]?.id;
  if (found !== undefined) return found;

  // The first profile under an identity is that person's own; a later one is
  // somebody they are booking for.
  const isFirst = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM patients
     WHERE owner_guest_id = ${input.guestId} AND deleted_at IS NULL
  `.execute(trx);

  const primary = Number(isFirst.rows[0]?.n ?? '1') === 0;

  const created = await sql<{ id: string }>`
    INSERT INTO patients
      (owner_guest_id, full_name, age_years, sex, phone, relationship, is_primary)
    VALUES (
      ${input.guestId}, ${input.fullName}, ${input.ageYears}, ${input.sex}::sex,
      ${input.phone}, ${primary ? 'self' : 'other'}, ${primary}
    )
    RETURNING id
  `.execute(trx);

  const id = created.rows[0]?.id;
  if (id === undefined) throw new Error('patients insert returned no id.');
  return id;
}

/**
 * Stores a tracking link (`FR-GST-05`).
 *
 * Only the hash. The token itself exists in the SMS and nowhere else, so a
 * database read cannot open somebody's live queue — which matters because this
 * link is deliberately a credential that needs no login.
 */
export async function insertTrackingLink(input: {
  readonly bookingId: string;
  readonly guestId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}): Promise<void> {
  await sql`
    INSERT INTO guest_links (booking_id, guest_id, token_hash, expires_at)
    VALUES (${input.bookingId}, ${input.guestId}, ${input.tokenHash}, ${input.expiresAt})
    ON CONFLICT (booking_id) DO UPDATE
      SET token_hash = excluded.token_hash,
          expires_at = excluded.expires_at,
          revoked_at = NULL
  `.execute(db);
}

/**
 * Whether a booking already has a live tracking link.
 *
 * Minting one replaces the last (`ON CONFLICT … DO UPDATE`), which would kill
 * the link already in somebody's SMS. A caller that only wants to issue a link
 * when there is none asks this first.
 */
export async function hasTrackingLink(bookingId: string): Promise<boolean> {
  const result = await sql<{ present: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM guest_links WHERE booking_id = ${bookingId} AND revoked_at IS NULL
    ) AS present
  `.execute(db);
  return result.rows[0]?.present ?? false;
}

/**
 * Resolves a tracking token to the booking it opens.
 *
 * Checks expiry and revocation here rather than leaving it to the caller: a
 * link that has been revoked must stop working everywhere at once, and a rule
 * enforced at each call site is a rule one call site will forget.
 */
export async function resolveTrackingToken(tokenHash: string): Promise<{
  readonly bookingId: string;
  readonly guestId: string;
  readonly sessionId: string;
} | null> {
  const result = await sql<{ booking_id: string; guest_id: string; session_id: string }>`
    SELECT gl.booking_id, gl.guest_id, b.session_id
      FROM guest_links gl
      JOIN bookings b ON b.id = gl.booking_id
     WHERE gl.token_hash = ${tokenHash}
       AND gl.revoked_at IS NULL
       AND gl.expires_at > now()
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  await sql`UPDATE guest_links SET last_used_at = now() WHERE token_hash = ${tokenHash}`.execute(
    db,
  );

  return { bookingId: row.booking_id, guestId: row.guest_id, sessionId: row.session_id };
}
