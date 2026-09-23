/**
 * The standby list and the offers made from it (`FR-PAT-25`, `FR-QUE-30`).
 *
 * Both tables have existed since migration 0006 and nothing has written to
 * them until now. The comment on `slot_offers.recovered_value_poisha` says
 * what they are for: "the taka figure a hospital director is shown on the
 * admin dashboard" — which is why they are built with step 19 rather than
 * with the queue service that raises their events.
 *
 * SQL only, no decisions (BACKEND.md §3). Which patient is next, what the
 * window is and whether a chair may be given away are `queue.service`'s and
 * `shared/domain`'s.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

export interface StandbyRow {
  readonly id: string;
  readonly sessionId: string;
  readonly patientId: string;
  readonly contactPhone: string;
  readonly position: number;
}

export interface OfferRow {
  readonly id: string;
  readonly sessionId: string;
  readonly freedBookingId: string | null;
  readonly offeredToPatientId: string;
  readonly offeredAt: Date;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly declinedAt: Date | null;
  readonly recoveredValuePoisha: number | null;
}

/**
 * Who is next on the list, skipping anybody already holding an open offer.
 *
 * `FOR UPDATE SKIP LOCKED` on the standby row, so two receptionists freeing
 * two chairs in the same instant take two different people off the list
 * instead of both taking the person at position 1 — which would offer one
 * patient two chairs and leave the next person waiting.
 *
 * The `NOT EXISTS` is the second half of the same problem: a patient with an
 * outstanding offer is not available for another one. Without it, somebody at
 * position 1 who has not yet answered would be offered every chair that frees
 * in the next ten minutes.
 *
 * The `ORDER BY` is the third: somebody who let an offer lapse, or turned one
 * down, goes behind everybody who has not yet been asked. `FR-QUE-30` says an
 * unaccepted offer "passes to the next patient", and ordering on position
 * alone handed the re-offered chair straight back to the person who had just
 * not answered. They are not dropped — once everybody has been asked, the list
 * comes round to them again.
 */
export async function claimNextStandby(
  trx: Tx,
  sessionId: string,
  now: Date,
): Promise<StandbyRow | null> {
  const result = await sql<{
    id: string;
    session_id: string;
    patient_id: string;
    contact_phone: string;
    position: number;
  }>`
    SELECT sl.id, sl.session_id, sl.patient_id, sl.contact_phone, sl.position
      FROM standby_list sl
     WHERE sl.session_id = ${sessionId}
       AND sl.removed_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM slot_offers o
          WHERE o.offered_to_patient_id = sl.patient_id
            AND o.session_id = sl.session_id
            AND o.accepted_at IS NULL
            AND o.declined_at IS NULL
            AND o.expires_at > ${now}
       )
     ORDER BY (
               SELECT count(*) FROM slot_offers o
                WHERE o.offered_to_patient_id = sl.patient_id
                  AND o.session_id = sl.session_id
                  AND o.accepted_at IS NULL
              ),
              sl.position
     FOR UPDATE SKIP LOCKED
     LIMIT 1
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    contactPhone: row.contact_phone,
    position: row.position,
  };
}

/** Everybody still waiting on the list, in the order they will be offered. */
export async function listStandby(sessionId: string): Promise<StandbyRow[]> {
  const rows = await db
    .selectFrom('standby_list')
    .select(['id', 'session_id', 'patient_id', 'contact_phone', 'position'])
    .where('session_id', '=', sessionId)
    .where('removed_at', 'is', null)
    .orderBy('position')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    contactPhone: row.contact_phone,
    position: row.position,
  }));
}

/** Creates the offer row the `SLOT_OFFERED` event will name. */
export async function insertOffer(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly freedBookingId: string;
    readonly offeredToPatientId: string;
    readonly expiresAt: Date;
  },
): Promise<string> {
  const row = await trx
    .insertInto('slot_offers')
    .values({
      session_id: input.sessionId,
      freed_booking_id: input.freedBookingId,
      offered_to_patient_id: input.offeredToPatientId,
      expires_at: input.expiresAt,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

/**
 * Marks an offer taken and records what it recovered.
 *
 * The `accepted_at IS NULL AND declined_at IS NULL` predicate is the race
 * guard: two accepts of one offer arriving together both pass the domain check
 * against a state read a moment earlier, and this is where the second one
 * finds nothing to update. The caller reads the row count and refuses.
 */
export async function markAccepted(
  trx: Tx,
  offerId: string,
  recoveredValuePoisha: number,
  at: Date,
): Promise<boolean> {
  const result = await trx
    .updateTable('slot_offers')
    .set({ accepted_at: at, recovered_value_poisha: recoveredValuePoisha })
    .where('id', '=', offerId)
    .where('accepted_at', 'is', null)
    .where('declined_at', 'is', null)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) === 1;
}

/** Takes somebody off the list once they have taken a chair. */
export async function removeFromStandby(
  trx: Tx,
  sessionId: string,
  patientId: string,
  at: Date,
): Promise<void> {
  await trx
    .updateTable('standby_list')
    .set({ removed_at: at })
    .where('session_id', '=', sessionId)
    .where('patient_id', '=', patientId)
    .where('removed_at', 'is', null)
    .execute();
}

/** One offer, for the guards and for the accept path. */
export async function findOffer(offerId: string, trx?: Tx): Promise<OfferRow | null> {
  const result = await sql<OfferQueryRow>`
    SELECT id, session_id, freed_booking_id, offered_to_patient_id,
           offered_at, expires_at, accepted_at, declined_at, recovered_value_poisha
      FROM slot_offers
     WHERE id = ${offerId}
  `.execute(trx ?? db);

  const row = result.rows[0];
  return row === undefined ? null : toOfferRow(row);
}

/** Offers against this session, newest first, for the console's panel. */
export async function listOffers(sessionId: string): Promise<OfferRow[]> {
  const result = await sql<OfferQueryRow>`
    SELECT id, session_id, freed_booking_id, offered_to_patient_id,
           offered_at, expires_at, accepted_at, declined_at, recovered_value_poisha
      FROM slot_offers
     WHERE session_id = ${sessionId}
     ORDER BY offered_at DESC
  `.execute(db);

  return result.rows.map(toOfferRow);
}

interface OfferQueryRow {
  id: string;
  session_id: string;
  freed_booking_id: string | null;
  offered_to_patient_id: string;
  offered_at: Date;
  expires_at: Date;
  accepted_at: Date | null;
  declined_at: Date | null;
  recovered_value_poisha: number | null;
}

function toOfferRow(row: OfferQueryRow): OfferRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    freedBookingId: row.freed_booking_id,
    offeredToPatientId: row.offered_to_patient_id,
    offeredAt: row.offered_at,
    expiresAt: row.expires_at,
    acceptedAt: row.accepted_at,
    declinedAt: row.declined_at,
    recoveredValuePoisha: row.recovered_value_poisha,
  };
}
