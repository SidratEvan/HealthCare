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

/**
 * Everything `S-A-08` puts on screen beside the queue itself (`FR-PAT-30`).
 *
 * One read rather than four, because this is the first thing a patient's phone
 * asks for after tapping a link in an SMS, often on a 3G connection in a
 * corridor: four round trips is four chances to show a spinner.
 *
 * Names are Bangla-first. The English ones travel too, so the `en` locale is a
 * setting rather than a second query (`I18N-01`).
 */
export interface BookingDetail {
  readonly id: string;
  readonly sessionId: string;
  readonly serial: number;
  readonly status: BookingStatus;
  /**
   * Whom the booking is for. The wallet needs it to name the patient a consent
   * offer or an access-log read is about (`FR-PAT-63`, `FR-PAT-64`); the holder
   * of the booking's link already sees the name, and this is only its key.
   */
  readonly patientId: string;
  readonly patientName: string;
  readonly feePoisha: number;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentCode: string;
  readonly room: string | null;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  /** `hospital_settings.stale_threshold_minutes` (`FR-OFF-04`). */
  readonly staleThresholdMinutes: number;
  /** The hospital's own rule, as recorded. Empty means none is on file. */
  readonly refundPolicy: Record<string, unknown>;
}

interface DetailQueryRow {
  id: string;
  session_id: string;
  serial_number: number;
  status: BookingStatus;
  patient_id: string;
  full_name: string;
  fee_poisha: number;
  hospital_id: string;
  hospital_name_bn: string;
  hospital_name_en: string;
  doctor_name_bn: string;
  doctor_name_en: string;
  department_code: string;
  room: string | null;
  session_date: Date | string;
  planned_start: Date;
  planned_end: Date;
  stale_threshold_minutes: number | null;
  refund_policy: Record<string, unknown> | null;
}

/** The booking behind a live serial screen, with its chamber. */
export async function findDetail(bookingId: string): Promise<BookingDetail | null> {
  const result = await sql<DetailQueryRow>`
    SELECT b.id, b.session_id, b.serial_number, b.status, b.fee_poisha,
           b.patient_id, p.full_name,
           h.id   AS hospital_id,
           h.name_bn AS hospital_name_bn,
           h.name_en AS hospital_name_en,
           d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en,
           dep.code  AS department_code,
           s.room, s.session_date, s.planned_start, s.planned_end,
           hs.stale_threshold_minutes,
           hs.refund_policy
      FROM bookings b
      JOIN patients p    ON p.id = b.patient_id
      JOIN sessions s    ON s.id = b.session_id
      JOIN hospitals h   ON h.id = s.hospital_id
      JOIN doctors d     ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
      LEFT JOIN hospital_settings hs ON hs.hospital_id = h.id
     WHERE b.id = ${bookingId} AND b.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    sessionId: row.session_id,
    serial: row.serial_number,
    status: row.status,
    patientId: row.patient_id,
    patientName: row.full_name,
    feePoisha: row.fee_poisha,
    hospitalId: row.hospital_id,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    doctorNameBn: row.doctor_name_bn,
    doctorNameEn: row.doctor_name_en,
    departmentCode: row.department_code,
    room: row.room,
    sessionDate:
      row.session_date instanceof Date
        ? (row.session_date.toISOString().slice(0, 10) ?? '')
        : row.session_date,
    plannedStart: row.planned_start.toISOString(),
    plannedEnd: row.planned_end.toISOString(),
    // The documented default, for a hospital whose settings row has not been
    // written yet (`FR-OFF-04`).
    staleThresholdMinutes: row.stale_threshold_minutes ?? 10,
    refundPolicy: row.refund_policy ?? {},
  };
}

/** One booking's settled state, exactly as the reducer computed it. */
export interface BookingProjection {
  readonly bookingId: string;
  readonly status: BookingStatus;
  readonly calledAt: string | null;
  readonly doneAt: string | null;
  readonly arrivedAt: string | null;
  readonly consultSeconds: number | null;
  /**
   * Why the booking was cancelled, when it was (`FR-PAT-23`).
   *
   * `bookings_cancelled_has_reason` makes this NOT NULL for a cancelled row,
   * so a projection that omitted it would fail the transaction the moment a
   * `BOOKING_CANCELLED` event was folded.
   */
  readonly cancelledReason: string | null;
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
      ${p.consultSeconds}::integer,
      ${p.cancelledReason}::text
    )`,
  );

  // `COALESCE(v.cancelled_reason, b.cancelled_reason)` never clears a reason
  // already on the row. The seeded history writes its own Bangla reasons while
  // the events behind them carry none (`seed_04_history`), so an overwrite
  // would blank them and then fail the constraint on the next replay.
  await sql`
    UPDATE bookings AS b
       SET status           = v.status,
           called_at        = v.called_at,
           done_at          = v.done_at,
           arrived_at       = v.arrived_at,
           consult_seconds  = v.consult_seconds,
           cancelled_reason = COALESCE(v.cancelled_reason, b.cancelled_reason)
      FROM (VALUES ${sql.join(values, sql`, `)})
           AS v (id, status, called_at, done_at, arrived_at, consult_seconds, cancelled_reason)
     WHERE b.id = v.id
       AND (b.status           IS DISTINCT FROM v.status
         OR b.called_at        IS DISTINCT FROM v.called_at
         OR b.done_at          IS DISTINCT FROM v.done_at
         OR b.arrived_at       IS DISTINCT FROM v.arrived_at
         OR b.consult_seconds  IS DISTINCT FROM v.consult_seconds
         OR b.cancelled_reason IS DISTINCT FROM COALESCE(v.cancelled_reason, b.cancelled_reason))
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
 * Inserts a booking and returns its id.
 *
 * `serial_number` is decided by the caller under the session lock, not here —
 * a repository writes rows and does not make the decision about who is next
 * (BACKEND.md §3). The unique index on `(session_id, serial_number)` is the
 * backstop if that lock is ever released too early.
 */
export async function insertBooking(
  trx: Tx,
  input: {
    readonly sessionId: string;
    readonly patientId: string;
    readonly serial: number;
    readonly source: string;
    readonly feePoisha: number;
    readonly bookedByUserId: string | null;
    readonly bookedByGuestId: string | null;
    readonly reasonText: string | null;
    readonly intake: Record<string, unknown>;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO bookings
      (session_id, patient_id, serial_number, source, fee_poisha,
       booked_by_user_id, booked_by_guest_id, reason_text, intake)
    VALUES (
      ${input.sessionId}, ${input.patientId}, ${input.serial},
      ${input.source}::booking_source, ${input.feePoisha},
      ${input.bookedByUserId}, ${input.bookedByGuestId},
      ${input.reasonText}, ${JSON.stringify(input.intake)}::jsonb
    )
    RETURNING id
  `.execute(trx);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('bookings insert returned no id.');
  return id;
}

/**
 * A live booking for this patient with this doctor on this day (`FR-PAT-24`).
 *
 * The database enforces the same-*session* half as a unique index. This is the
 * other half: a doctor may sit a morning and an evening chamber, and the same
 * person booking both is the mistake the rule exists to prevent. It cannot be
 * an index without denormalising `doctor_id` and `session_date` onto
 * `bookings`, which DATABASE.md §2.3 does not define — so it is checked here,
 * inside the same transaction that allocates the serial.
 */
export async function findSameDoctorSameDay(
  trx: Tx,
  input: {
    readonly patientId: string;
    readonly doctorId: string;
    readonly sessionDate: string;
  },
): Promise<{ readonly id: string; readonly serial: number } | null> {
  const result = await sql<{ id: string; serial_number: number }>`
    SELECT b.id, b.serial_number
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
     WHERE b.patient_id = ${input.patientId}
       AND s.doctor_id = ${input.doctorId}
       AND s.session_date = ${input.sessionDate}::date
       AND b.status NOT IN ('cancelled', 'rescheduled')
       AND b.deleted_at IS NULL
     LIMIT 1
  `.execute(trx);

  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, serial: row.serial_number };
}

/** Whether this profile belongs to this account (`patients_one_owner`). */
export async function patientBelongsTo(
  trx: Tx,
  patientId: string,
  userId: string,
): Promise<boolean> {
  const result = await sql<{ present: number }>`
    SELECT 1 AS present FROM patients
     WHERE id = ${patientId} AND owner_user_id = ${userId} AND deleted_at IS NULL
  `.execute(trx);
  return result.rows.length > 0;
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
