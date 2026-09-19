/**
 * Building a session's roster: who is booked on which serial, and how.
 *
 * Shared by `seed_04_history` and `seed_07_demo_live`, because a past visit and
 * a live booking are the same row — `bookings` records a claim on a serial, and
 * the only difference between the two is which events have landed on it
 * (DATABASE.md §2.3). Writing that twice would be two descriptions of one
 * thing, and they would drift.
 */

import { DEMO_INTAKE } from '../data/reference.js';

import { DEMO_MARKER } from './demo.js';
import { insertRows } from './insert.js';

import type { Rng } from './random.js';
import type { Client } from 'pg';

/** A profile and its owner, which decides who can have booked for it. */
export interface PatientRow {
  readonly id: string;
  readonly ownerUserId: string | null;
  readonly ownerGuestId: string | null;
  readonly isPrimary: boolean;
}

/** Every seeded profile, in a stable order. */
export async function loadPatients(client: Client): Promise<PatientRow[]> {
  const { rows } = await client.query<{
    id: string;
    owner_user_id: string | null;
    owner_guest_id: string | null;
    is_primary: boolean;
  }>(
    `SELECT id, owner_user_id, owner_guest_id, is_primary
       FROM patients
      WHERE deleted_at IS NULL
      ORDER BY created_at, id`,
  );

  return rows.map((row) => ({
    id: row.id,
    ownerUserId: row.owner_user_id,
    ownerGuestId: row.owner_guest_id,
    isPrimary: row.is_primary,
  }));
}

/** How a booking was made, and who is recorded as having made it. */
export type BookingSource = 'app' | 'guest_link' | 'counter' | 'phone' | 'walkin';

/**
 * What the patient answered before the visit (`bookings.intake`).
 *
 * `APP_FLOW.md` A4 lists the questions `MOD-A07-INTAKE` asks: duration, main
 * symptom, chronic conditions, current medicines, allergies. The main symptom
 * is `complaintBn`; these are the rest.
 *
 * Every field is a real answer or an empty list. An empty list means "the
 * patient said none", which is a different and more useful thing for a doctor
 * to read than a missing key — and `FR-DOC-03` puts allergies on the screen
 * precisely so that *none declared* is stated rather than assumed.
 */
export interface IntakeAnswers {
  readonly durationBn: string;
  readonly conditionsBn: readonly string[];
  readonly medicinesBn: readonly string[];
  readonly allergiesBn: readonly string[];
}

/**
 * Draws a plausible set of pre-visit answers.
 *
 * Most people have nothing chronic and no allergy, so the shape of the demo
 * follows that: about a third carry a condition, a quarter an allergy. A demo
 * where every patient is diabetic and allergic to penicillin would make the
 * doctor's panel look impressive and teach a hospital director something false
 * about their own caseload.
 */
export function buildIntake(rng: Rng): IntakeAnswers {
  const conditions = rng.chance(0.35) ? [rng.pick(DEMO_INTAKE.conditions)] : [];

  return {
    durationBn: rng.pick(DEMO_INTAKE.durations),
    conditionsBn: conditions,
    // Somebody on treatment for a long-term condition is usually taking
    // something for it, so this follows the conditions rather than being drawn
    // independently.
    medicinesBn: conditions.length > 0 && rng.chance(0.8) ? [rng.pick(DEMO_INTAKE.medicines)] : [],
    allergiesBn: rng.chance(0.25) ? [rng.pick(DEMO_INTAKE.allergies)] : [],
  };
}

export interface BookingDraft {
  readonly patient: PatientRow;
  readonly serial: number;
  readonly source: BookingSource;
  /** Null for a counter booking reception typed in (`bookings_one_booker`). */
  readonly bookedByUserId: string | null;
  readonly bookedByGuestId: string | null;
  readonly complaintBn: string;
  readonly complaintEn: string;
  /**
   * The rest of the pre-visit answers (`FR-DOC-03`).
   *
   * The complaint is the main symptom; this is duration, chronic conditions,
   * current medicines and allergies — the other four questions
   * `MOD-A07-INTAKE` asks. The doctor's patient panel reads every one of them,
   * so a booking without them gives that screen nothing to show.
   */
  readonly intake: IntakeAnswers;
  /** Set at insert, because `bookings_cancelled_has_reason` is a check. */
  readonly cancelledReason: string | null;
}

/**
 * Chooses how a booking was made, consistently with who owns the profile.
 *
 * A guest-owned profile cannot have been booked in the app by an account
 * holder, and a counter booking has no booker at all — reception typed it in,
 * which is the case `bookings_one_booker` is written as "at most one" to allow.
 */
export function bookingSource(
  rng: Rng,
  patient: PatientRow,
): Pick<BookingDraft, 'source' | 'bookedByUserId' | 'bookedByGuestId'> {
  if (patient.ownerGuestId !== null) {
    // A guest either opened their tracking link or stood at the counter.
    return rng.chance(0.6)
      ? { source: 'guest_link', bookedByUserId: null, bookedByGuestId: patient.ownerGuestId }
      : { source: 'counter', bookedByUserId: null, bookedByGuestId: null };
  }

  const roll = rng.next();
  if (roll < 0.62) {
    return { source: 'app', bookedByUserId: patient.ownerUserId, bookedByGuestId: null };
  }
  if (roll < 0.78) {
    return { source: 'phone', bookedByUserId: null, bookedByGuestId: null };
  }
  if (roll < 0.93) {
    return { source: 'counter', bookedByUserId: null, bookedByGuestId: null };
  }
  return { source: 'walkin', bookedByUserId: null, bookedByGuestId: null };
}

/** A booking row's id together with the draft it came from. */
export interface InsertedBooking extends BookingDraft {
  readonly id: string;
}

/**
 * Writes a session's bookings in one statement.
 *
 * Every row goes in as `booked`. Status is derived from the event log
 * (DATABASE.md §2.3), so `writeProjections` sets it afterwards from what the
 * reducer says — never from what this function intended.
 *
 * @param createdByStaffId the receptionist on the counter, recorded on the
 *   bookings she typed in (`DB-P3`). App and guest-link bookings have no staff
 *   author and carry null.
 */
export async function insertBookings(
  client: Client,
  sessionId: string,
  feePoisha: number,
  drafts: readonly BookingDraft[],
  createdByStaffId: string | null,
  createdAt: string,
): Promise<InsertedBooking[]> {
  if (drafts.length === 0) return [];

  const rows = drafts.map((draft) => [
    sessionId,
    draft.patient.id,
    draft.bookedByUserId,
    draft.bookedByGuestId,
    draft.serial,
    draft.source,
    JSON.stringify({
      ...DEMO_MARKER,
      complaintBn: draft.complaintBn,
      complaintEn: draft.complaintEn,
      ...draft.intake,
    }),
    draft.complaintBn,
    feePoisha,
    draft.cancelledReason,
    draft.source === 'app' || draft.source === 'guest_link' ? null : createdByStaffId,
    createdAt,
  ]);

  const inserted = await insertRows<{ id: string }>(
    client,
    'bookings',
    {
      columns: [
        'session_id',
        'patient_id',
        'booked_by_user_id',
        'booked_by_guest_id',
        'serial_number',
        'source',
        'intake',
        'reason_text',
        'fee_poisha',
        'cancelled_reason',
        'created_by',
        'created_at',
      ],
    },
    rows,
  );

  return drafts.map((draft, index) => {
    const row = inserted[index];
    if (row === undefined) throw new Error('bookings returned fewer rows than drafts.');
    return { ...draft, id: row.id };
  });
}

/**
 * Recomputes the guest counters from the bookings that now exist.
 *
 * `guest_identities.booking_count` and `no_show_count` sit behind the
 * prepayment rule for repeated no-shows (`FR-GST-14`). A seeded guess would
 * make that rule fire on evidence the database does not hold, so both are
 * counted from the rows instead.
 */
export async function recountGuestBookings(client: Client): Promise<void> {
  await client.query(
    `UPDATE guest_identities AS g
        SET booking_count = counted.total,
            no_show_count = counted.no_shows
       FROM (
         SELECT booked_by_guest_id AS guest_id,
                count(*)                                        AS total,
                count(*) FILTER (WHERE status = 'no_show')      AS no_shows
           FROM bookings
          WHERE booked_by_guest_id IS NOT NULL
          GROUP BY booked_by_guest_id
       ) AS counted
      WHERE g.id = counted.guest_id`,
  );
}
