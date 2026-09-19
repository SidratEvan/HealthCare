/**
 * Bookings, as far as the queue needs them.
 *
 * The queue's view of a booking is deliberately narrow: the immutable facts
 * that seed a replay — id, serial, patient, source, creation time — and
 * nothing the event log decides. `bookings.status` is derived (DATABASE.md
 * §2.3), so it is written here only as a projection of what the reducer
 * produced, never as a decision this file makes.
 *
 * Creating a booking from a patient's side (payment, duplicate rules, standby)
 * belongs to `booking.service` in step 9. What lives here is the walk-in a
 * receptionist types in at the counter, because that is a queue event
 * (`WALKIN_ADDED`) before it is anything else.
 *
 * Reads use `sql<T>` templates rather than the query builder, matching
 * `health.repo.ts` and BACKEND.md §0 ("raw SQL for hot paths"): the roster is
 * read on every single queue mutation, inside the lock every counter is
 * waiting on, and an explicit row type is clearer about what comes back than a
 * builder generic that has to be unwrapped.
 */

import { sql } from 'kysely';

import { id as brandId, serial as brandSerial } from '@platform/domain';
import type {
  BookingId,
  BookingSource,
  BookingStatus,
  PatientId,
  RosterBooking,
  Timestamp,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** A booking row with the display fields a console needs beside the queue. */
export interface BookingRow {
  readonly id: string;
  readonly sessionId: string;
  readonly patientId: string;
  readonly patientName: string;
  readonly serial: number;
  readonly status: BookingStatus;
  readonly source: BookingSource;
  readonly feePoisha: number;
  readonly createdAt: string;
}

interface RosterQueryRow {
  id: string;
  serial_number: number;
  patient_id: string;
  source: BookingSource;
  created_at: Date;
}

/**
 * The roster a replay starts from (`QueueSeed.roster`).
 *
 * Cancelled bookings are included. A cancelled row keeps its place in history
 * (`DB-P2`) and the reducer needs to see it to fold the `BOOKING_CANCELLED`
 * event that cancelled it; excluding it here would make every replay record an
 * `UNKNOWN_BOOKING` anomaly for a booking that is simply gone.
 */
export async function rosterFor(sessionId: string, trx?: Tx): Promise<RosterBooking[]> {
  const result = await sql<RosterQueryRow>`
    SELECT id, serial_number, patient_id, source, created_at
      FROM bookings
     WHERE session_id = ${sessionId} AND deleted_at IS NULL
     ORDER BY serial_number, created_at
  `.execute(trx ?? db);

  return result.rows.map((row) => ({
    bookingId: brandId<BookingId>(row.id),
    serial: brandSerial(row.serial_number),
    patientId: brandId<PatientId>(row.patient_id),
    source: row.source,
    createdAt: row.created_at.toISOString() as Timestamp,
  }));
}

interface DisplayQueryRow extends RosterQueryRow {
  session_id: string;
  status: BookingStatus;
  fee_poisha: number;
  full_name: string;
}

const DISPLAY_SELECT = sql`
  SELECT b.id, b.session_id, b.patient_id, b.serial_number, b.status,
         b.source, b.fee_poisha, b.created_at, p.full_name
    FROM bookings b
    JOIN patients p ON p.id = b.patient_id
`;

/** The roster with the patient names a console displays beside each serial. */
export async function listForSession(sessionId: string): Promise<BookingRow[]> {
  const result = await sql<DisplayQueryRow>`
    ${DISPLAY_SELECT}
    WHERE b.session_id = ${sessionId} AND b.deleted_at IS NULL
    ORDER BY b.serial_number
  `.execute(db);

  return result.rows.map(toBookingRow);
}

export async function findById(bookingId: string): Promise<BookingRow | null> {
  const result = await sql<DisplayQueryRow>`
    ${DISPLAY_SELECT}
    WHERE b.id = ${bookingId} AND b.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  return row === undefined ? null : toBookingRow(row);
}

/** One booking's settled state, exactly as the reducer computed it. */
export interface BookingProjection {
  readonly bookingId: string;
  readonly status: BookingStatus;
  readonly calledAt: string | null;
  readonly doneAt: string | null;
  readonly arrivedAt: string | null;
  readonly consultSeconds: number | null;
}

/**
 * Writes every booking's derived state for one session, in one statement.
 *
 * DATABASE.md §2.3 says this is maintained by `trg_booking_status_from_events`
 * — migration 0013, which does not exist yet. Until it does, the service
 * writes what the reducer derived: the same values, from the same function, so
 * the trigger arriving later changes who writes them and not what they are.
 *
 * One statement rather than one per booking: a chamber of 150 patients would
 * otherwise take 150 round trips inside the lock every other counter is
 * waiting on. The `IS DISTINCT FROM` guard skips rows that already say this,
 * which keeps `bookings.updated_at` still on rows nothing happened to — and
 * `updated_at` is what a console's freshness line reads.
 */
export async function saveProjections(
  trx: Tx,
  projections: readonly BookingProjection[],
): Promise<void> {
  if (projections.length === 0) return;

  const values = projections.map(
    (p) => sql`(
      ${p.bookingId}::uuid,
      ${p.status}::booking_status,
      ${p.calledAt}::timestamptz,
      ${p.doneAt}::timestamptz,
      ${p.arrivedAt}::timestamptz,
      ${p.consultSeconds}::integer
    )`,
  );

  await sql`
    UPDATE bookings AS b
       SET status          = v.status,
           called_at       = v.called_at,
           done_at         = v.done_at,
           arrived_at      = v.arrived_at,
           consult_seconds = v.consult_seconds
      FROM (VALUES ${sql.join(values, sql`, `)})
           AS v (id, status, called_at, done_at, arrived_at, consult_seconds)
     WHERE b.id = v.id
       AND (b.status          IS DISTINCT FROM v.status
         OR b.called_at       IS DISTINCT FROM v.called_at
         OR b.done_at         IS DISTINCT FROM v.done_at
         OR b.arrived_at      IS DISTINCT FROM v.arrived_at
         OR b.consult_seconds IS DISTINCT FROM v.consult_seconds)
  `.execute(trx);
}

/**
 * Inserts the booking behind a walk-in (`FR-REC-13`).
 *
 * The serial is allocated by the caller from the current state, inside the
 * session lock, which is what keeps two counters from issuing the same number
 * — `bookings_session_serial_key` would reject the second, but a rejected
 * insert at a counter is a receptionist apologising to a patient.
 */
export async function insertWalkin(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly patientId: string;
    readonly serial: number;
    readonly feePoisha: number;
    readonly createdByStaffId: string;
  },
): Promise<string> {
  const row = await trx
    .insertInto('bookings')
    .values({
      session_id: input.sessionId,
      patient_id: input.patientId,
      serial_number: input.serial,
      source: 'walkin',
      fee_poisha: input.feePoisha,
      created_by: input.createdByStaffId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return row.id;
}

/**
 * Whether a patient or guest holds a booking in this session.
 *
 * Used by the socket handshake to decide who may listen to a queue. A booking
 * id is checked first and on its own: a tracking link names exactly one
 * booking (`FR-GST-05`), and a guest who later books elsewhere must not find
 * that their old link now opens a different chamber.
 */
export async function existsForPrincipal(
  sessionId: string,
  who: {
    readonly userId: string | null;
    readonly guestId: string | null;
    readonly bookingId: string | null;
  },
): Promise<boolean> {
  const result = await sql<{ present: number }>`
    SELECT 1 AS present
      FROM bookings
     WHERE session_id = ${sessionId}
       AND deleted_at IS NULL
       AND (
         (${who.bookingId}::uuid IS NOT NULL AND id = ${who.bookingId}::uuid)
         OR (${who.userId}::uuid IS NOT NULL AND booked_by_user_id = ${who.userId}::uuid)
         OR (${who.guestId}::uuid IS NOT NULL AND booked_by_guest_id = ${who.guestId}::uuid)
       )
     LIMIT 1
  `.execute(db);

  return result.rows.length > 0;
}

/** The account or guest a booking belongs to, for the ownership check. */
export async function ownerOf(
  bookingId: string,
): Promise<{ userId: string | null; guestId: string | null; patientId: string } | null> {
  const result = await sql<{
    booked_by_user_id: string | null;
    booked_by_guest_id: string | null;
    patient_id: string;
  }>`
    SELECT booked_by_user_id, booked_by_guest_id, patient_id
      FROM bookings
     WHERE id = ${bookingId} AND deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    userId: row.booked_by_user_id,
    guestId: row.booked_by_guest_id,
    patientId: row.patient_id,
  };
}

function toBookingRow(row: DisplayQueryRow): BookingRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    patientName: row.full_name,
    serial: row.serial_number,
    status: row.status,
    source: row.source,
    feePoisha: row.fee_poisha,
    createdAt: row.created_at.toISOString(),
  };
}
