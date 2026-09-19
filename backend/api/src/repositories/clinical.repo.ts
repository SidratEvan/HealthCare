/**
 * Reads and writes for the clinical record (BACKEND.md §7.6, DATABASE.md §2.4).
 *
 * The queue tables answer "where is this person in the line". These answer
 * "what did a doctor conclude about them", which is a different kind of secret.
 * Two consequences run through every function here:
 *
 *   - **nothing is read without the caller having been checked first.**
 *     `FR-DOC-10` limits a doctor to patients in their own sessions or an
 *     explicit consent, and that decision is the service's. This file supplies
 *     the facts the decision needs (`treatedAtHospital`, `hasLiveConsent`) and
 *     refuses to guess.
 *   - **a read is itself an event.** `DB-P7` and `FR-SEC-03` require an
 *     `audit_log` row for every patient-identifying read by staff, so
 *     `recordRecordView` exists beside the reads rather than somewhere a caller
 *     might forget.
 *
 * SQL only lives here (CLAUDE.md §7). Events and notifications only in services.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/** Who the doctor is looking at (`FR-DOC-03`'s header). */
export interface PatientIdentity {
  readonly id: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: string;
  readonly bloodGroup: string | null;
}

/** One past consultation, as the wallet and the patient panel list it. */
export interface VisitRecord {
  readonly id: string;
  readonly bookingId: string;
  readonly diagnosisText: string | null;
  readonly adviceTextBn: string | null;
  readonly followUpDate: string | null;
  readonly signedAt: string | null;
  readonly doctorNameBn: string;
  readonly departmentNameBn: string;
  readonly hospitalNameBn: string;
  /** The serial the patient held, so a record can be matched to a day. */
  readonly serial: number;
  readonly visitedAt: string;
}

/**
 * The pre-visit answers on one booking (`FR-DOC-03`, `MOD-A07-INTAKE`).
 *
 * Every list may be empty, and an empty list is an answer: "no allergy
 * declared" is what a doctor needs to read, and it is not the same as the
 * question never having been asked. `asked` distinguishes the two.
 */
export interface Intake {
  readonly complaintBn: string | null;
  readonly durationBn: string | null;
  readonly conditionsBn: readonly string[];
  readonly medicinesBn: readonly string[];
  readonly allergiesBn: readonly string[];
  /** False when the booking carries no intake beyond the demo marker. */
  readonly asked: boolean;
}

/** What `S-B-05` needs about the booking in the chamber. */
export interface ChamberBooking {
  readonly bookingId: string;
  readonly patientId: string;
  readonly sessionId: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly serial: number;
  readonly status: string;
  readonly feePoisha: number;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function findPatient(patientId: string): Promise<PatientIdentity | null> {
  const result = await sql<{
    id: string;
    full_name: string;
    age_years: number | null;
    sex: string;
    blood_group: string | null;
  }>`
    SELECT id, full_name, age_years, sex::text AS sex, blood_group
      FROM patients
     WHERE id = ${patientId}::uuid AND deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    fullName: row.full_name,
    ageYears: row.age_years,
    sex: row.sex,
    bloodGroup: row.blood_group,
  };
}

/**
 * The booking a doctor is consulting on.
 *
 * Carries the session's hospital and doctor rather than the booking's own,
 * because a booking has neither — it belongs to a session, and the session is
 * what knows whose chamber this is.
 */
export async function findChamberBooking(bookingId: string): Promise<ChamberBooking | null> {
  const result = await sql<{
    booking_id: string;
    patient_id: string;
    session_id: string;
    hospital_id: string;
    doctor_id: string;
    serial_number: number;
    status: string;
    fee_poisha: number;
  }>`
    SELECT b.id AS booking_id, b.patient_id, b.session_id,
           s.hospital_id, s.doctor_id,
           b.serial_number, b.status::text AS status, b.fee_poisha
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
     WHERE b.id = ${bookingId}::uuid AND b.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    bookingId: row.booking_id,
    patientId: row.patient_id,
    sessionId: row.session_id,
    hospitalId: row.hospital_id,
    doctorId: row.doctor_id,
    serial: row.serial_number,
    status: row.status,
    feePoisha: row.fee_poisha,
  };
}

/** The pre-visit answers a patient gave for one booking. */
export async function findIntake(bookingId: string): Promise<Intake | null> {
  const result = await sql<{ intake: Record<string, unknown> | null; reason_text: string | null }>`
    SELECT intake, reason_text
      FROM bookings
     WHERE id = ${bookingId}::uuid AND deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  const intake = row.intake ?? {};

  // `demo: true` is on every seeded jsonb column (`FR-DEM-07`) and is not an
  // answer, so it does not count towards having been asked.
  const answered = Object.keys(intake).filter((key) => key !== 'demo');

  return {
    complaintBn: asText(intake['complaintBn']) ?? row.reason_text,
    durationBn: asText(intake['durationBn']),
    conditionsBn: asList(intake['conditionsBn']),
    medicinesBn: asList(intake['medicinesBn']),
    allergiesBn: asList(intake['allergiesBn']),
    asked: answered.length > 0,
  };
}

/**
 * A patient's signed records, newest first.
 *
 * Drafts are excluded. An unsigned visit is a doctor's unfinished note, and
 * showing one in a wallet — or to the next doctor — would present a working
 * thought as a conclusion.
 */
export async function findVisits(patientId: string, limit = 20): Promise<VisitRecord[]> {
  const result = await sql<{
    id: string;
    booking_id: string;
    diagnosis_text: string | null;
    advice_text_bn: string | null;
    follow_up_date: Date | null;
    signed_at: Date | null;
    doctor_name_bn: string;
    department_name_bn: string;
    hospital_name_bn: string;
    serial_number: number;
    visited_at: Date;
  }>`
    SELECT v.id, v.booking_id, v.diagnosis_text, v.advice_text_bn,
           v.follow_up_date, v.signed_at,
           d.full_name_bn  AS doctor_name_bn,
           dep.name_bn     AS department_name_bn,
           h.name_bn       AS hospital_name_bn,
           b.serial_number,
           coalesce(v.signed_at, v.created_at) AS visited_at
      FROM visits v
      JOIN bookings b       ON b.id = v.booking_id
      JOIN sessions sess    ON sess.id = b.session_id
      JOIN departments dep  ON dep.id = sess.department_id
      JOIN doctors d        ON d.id = v.doctor_id
      JOIN hospitals h      ON h.id = v.hospital_id
     WHERE v.patient_id = ${patientId}::uuid
       AND v.deleted_at IS NULL
       AND v.signed_at IS NOT NULL
     ORDER BY v.signed_at DESC
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    bookingId: row.booking_id,
    diagnosisText: row.diagnosis_text,
    adviceTextBn: row.advice_text_bn,
    // A date column, not an instant: `YYYY-MM-DD` is what it means and what a
    // client renders. Slicing the ISO string keeps it a calendar date rather
    // than turning it into midnight UTC.
    followUpDate: row.follow_up_date === null ? null : toDateOnly(row.follow_up_date),
    signedAt: row.signed_at?.toISOString() ?? null,
    doctorNameBn: row.doctor_name_bn,
    departmentNameBn: row.department_name_bn,
    hospitalNameBn: row.hospital_name_bn,
    serial: row.serial_number,
    visitedAt: row.visited_at.toISOString(),
  }));
}

/** The draft or record already written for a booking, if there is one. */
export async function findVisitByBooking(
  bookingId: string,
  trx?: Tx,
): Promise<{ id: string; signedAt: string | null } | null> {
  const result = await sql<{ id: string; signed_at: Date | null }>`
    SELECT id, signed_at
      FROM visits
     WHERE booking_id = ${bookingId}::uuid AND deleted_at IS NULL
  `.execute(trx ?? db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return { id: row.id, signedAt: row.signed_at?.toISOString() ?? null };
}

// ---------------------------------------------------------------------------
// The two facts `FR-DOC-10` turns on
// ---------------------------------------------------------------------------

/**
 * Whether this profile belongs to this account.
 *
 * A patient reads their own records, and "their own" includes the profiles they
 * hold for other people — `patients.owner_user_id` is the account, and a mother
 * booking for her child is the case `relationship` exists for (`FR-PAT-05`).
 */
export async function patientBelongsToUser(patientId: string, userId: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM patients
       WHERE id = ${patientId}::uuid
         AND owner_user_id = ${userId}::uuid
         AND deleted_at IS NULL
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

/**
 * Whether this patient has ever been booked into a chamber at this hospital.
 *
 * The first half of `FR-DOC-10`: "a doctor may only view records of patients in
 * their own sessions". This is that rule scoped to the **hospital** rather than
 * to the individual clinician, and the reason is a gap in the schema rather than
 * a choice:
 *
 * A doctor signs into the console as a `staff_users` row carrying the `doctor`
 * role. "Their own sessions" is `sessions.doctor_id`, which references
 * `doctors`. Nothing joins the two — `DATABASE.md` §2.2 gives `doctors.user_id`
 * as "the doctor's own login", a reference to `users`, and the seeds leave it
 * null because authentication is deferred (`CLAUDE.md` §4.1). So the individual
 * identity the requirement names is not available to check against.
 *
 * Narrowing to the hospital is the tightest rule the schema can express today:
 * a consultant at Shapla cannot open the record of somebody who has only ever
 * attended Padma. It is weaker than the requirement in one specific way — a
 * cardiologist at Shapla can read the record of a patient who saw the
 * orthopaedist there — and closing that needs a `staff_users ↔ doctors` link,
 * which is a schema decision for the owner. `docs/STATUS.md` records it.
 *
 * Booked is enough rather than seen: a doctor preparing for a chamber needs the
 * history before the patient walks in, not after.
 */
export async function treatedAtHospital(hospitalId: string, patientId: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
        FROM bookings b
        JOIN sessions s ON s.id = b.session_id
       WHERE b.patient_id = ${patientId}::uuid
         AND s.hospital_id = ${hospitalId}::uuid
         AND b.deleted_at IS NULL
         AND s.deleted_at IS NULL
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

/**
 * Whether a live consent covers this hospital reading this patient.
 *
 * The second half of `FR-DOC-10`. Revocation is a timestamp rather than a
 * delete (`DB-P2`), so this asks whether the grant is live *now* — which is
 * also what makes an audit answerable later.
 */
export async function hasLiveConsent(patientId: string, hospitalId: string): Promise<boolean> {
  const result = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
        FROM consents c
       WHERE c.patient_id = ${patientId}::uuid
         AND c.hospital_id = ${hospitalId}::uuid
         AND c.revoked_at IS NULL
         AND c.deleted_at IS NULL
         AND (c.expires_at IS NULL OR c.expires_at > now())
    ) AS ok
  `.execute(db);

  return result.rows[0]?.ok ?? false;
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface VisitWrite {
  readonly bookingId: string;
  readonly patientId: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly diagnosisText: string | null;
  readonly adviceTextBn: string | null;
  readonly followUpDate: string | null;
  readonly sign: boolean;
  readonly staffUserId: string | null;
}

/**
 * Writes the visit for a booking, or updates the draft already there.
 *
 * `visits.booking_id` is unique, so a second consultation on one serial is
 * refused by the database rather than by a check that could be raced. The
 * conflict target turns that refusal into the update it almost always means: a
 * doctor who saved a draft and then signed.
 *
 * `signed_at` only ever moves from null to a time. Re-signing an already signed
 * visit keeps the original timestamp, because when the record was made is a
 * fact about the consultation and not about the last tap.
 */
export async function upsertVisit(trx: Tx, write: VisitWrite): Promise<{ id: string }> {
  const result = await sql<{ id: string }>`
    INSERT INTO visits
      (booking_id, patient_id, hospital_id, doctor_id,
       diagnosis_text, advice_text_bn, follow_up_date, signed_at, created_by)
    VALUES (
      ${write.bookingId}::uuid, ${write.patientId}::uuid,
      ${write.hospitalId}::uuid, ${write.doctorId}::uuid,
      ${write.diagnosisText}, ${write.adviceTextBn},
      ${write.followUpDate}::date,
      ${write.sign ? sql`now()` : sql`NULL`},
      ${write.staffUserId}::uuid
    )
    ON CONFLICT (booking_id) DO UPDATE
       SET diagnosis_text = EXCLUDED.diagnosis_text,
           advice_text_bn = EXCLUDED.advice_text_bn,
           follow_up_date = EXCLUDED.follow_up_date,
           signed_at      = coalesce(visits.signed_at, EXCLUDED.signed_at)
    RETURNING id
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('visit upsert returned no row.');

  return { id: row.id };
}

/**
 * Records that a member of staff read a patient's record (`DB-P7`, `FR-SEC-03`).
 *
 * Written after the read rather than before, so a refused read leaves no row
 * claiming it happened — and written in the same request either way, because an
 * audit trail assembled later is one that can be forgotten.
 */
export async function recordRecordView(entry: {
  readonly staffUserId: string | null;
  readonly userId: string | null;
  readonly hospitalId: string | null;
  readonly patientId: string;
  readonly subjectTable: string;
  readonly subjectId: string | null;
  readonly meta: Record<string, unknown>;
}): Promise<void> {
  await sql`
    INSERT INTO audit_log
      (actor_staff_id, actor_user_id, hospital_id, action,
       subject_table, subject_id, patient_id, meta)
    VALUES (
      ${entry.staffUserId}::uuid, ${entry.userId}::uuid, ${entry.hospitalId}::uuid,
      'RECORD_VIEW', ${entry.subjectTable}, ${entry.subjectId}::uuid,
      ${entry.patientId}::uuid, ${JSON.stringify(entry.meta)}::jsonb
    )
  `.execute(db);
}

// ---------------------------------------------------------------------------

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * A `date` column as `YYYY-MM-DD`.
 *
 * `pg` hands back a `Date` at local midnight for a date column, so
 * `toISOString()` can land on the previous day west of UTC. The date parts are
 * read directly instead — the value has no timezone to convert.
 */
function toDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}
