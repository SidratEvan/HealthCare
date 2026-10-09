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

import type { SymptomSignal } from '@platform/domain';

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
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  /** The serial the patient held, so a record can be matched to a day. */
  readonly serial: number;
  readonly visitedAt: string;
  /** What a printed prescription is signed under (`FR-DOC-07`, plan R2). */
  readonly doctorBmdc: string;
  /** The medicines, in the doctor's order; empty when none were written (`FR-DOC-04`). */
  readonly medicines: readonly PrescribedMedicine[];
}

/** One medicine row on a visit (`prescription_items`, plan R2). */
export interface PrescribedMedicine {
  readonly medicineId: string | null;
  readonly name: string;
  readonly strength: string | null;
  readonly schedule: string | null;
  readonly durationDays: number | null;
  readonly instructionBn: string | null;
}

/** A formulary entry, for `FR-DOC-05`'s suggestions. */
export interface FormularyEntry {
  readonly id: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strengths: readonly string[];
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
 *
 * `hospitalId` narrows the read to the visits made at one hospital, and is
 * how a hospital's own doctor is kept to that hospital's records when the
 * patient has not consented to more (`FR-NET-02`, `FR-DOC-10`). The filter is
 * in the statement, not applied to its result: what is not read cannot leak.
 * Null reads every hospital's, for the patient themself or under consent.
 */
export async function findVisits(
  patientId: string,
  hospitalId: string | null,
  limit = 20,
): Promise<VisitRecord[]> {
  const result = await sql<{
    id: string;
    booking_id: string;
    diagnosis_text: string | null;
    advice_text_bn: string | null;
    follow_up_date: Date | string | null;
    signed_at: Date | null;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
    department_name_en: string;
    hospital_name_bn: string;
    hospital_name_en: string;
    serial_number: number;
    visited_at: Date;
    doctor_bmdc: string;
  }>`
    SELECT v.id, v.booking_id, v.diagnosis_text, v.advice_text_bn,
           v.follow_up_date, v.signed_at,
           d.full_name_bn  AS doctor_name_bn,
           d.full_name_en  AS doctor_name_en,
           d.bmdc_number   AS doctor_bmdc,
           dep.name_bn     AS department_name_bn,
           dep.name_en     AS department_name_en,
           h.name_bn       AS hospital_name_bn,
           h.name_en       AS hospital_name_en,
           b.serial_number,
           coalesce(v.signed_at, v.created_at) AS visited_at
      FROM visits v
      JOIN bookings b       ON b.id = v.booking_id
      JOIN sessions sess    ON sess.id = b.session_id
      JOIN departments dep  ON dep.id = sess.department_id
      JOIN doctors d        ON d.id = v.doctor_id
      JOIN hospitals h      ON h.id = v.hospital_id
     WHERE v.patient_id = ${patientId}::uuid
       AND (${hospitalId}::uuid IS NULL OR v.hospital_id = ${hospitalId}::uuid)
       AND v.deleted_at IS NULL
       AND v.signed_at IS NOT NULL
     ORDER BY v.signed_at DESC
     LIMIT ${limit}
  `.execute(db);

  const medicines = await medicinesFor(result.rows.map((row) => row.id));
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
    doctorNameEn: row.doctor_name_en,
    departmentNameBn: row.department_name_bn,
    departmentNameEn: row.department_name_en,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    serial: row.serial_number,
    visitedAt: row.visited_at.toISOString(),
    doctorBmdc: row.doctor_bmdc,
    medicines: medicines.get(row.id) ?? [],
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
  /** `CHIP-B05-SIGNAL` (`FR-GOV-03`). Counted by district only (0026). */
  readonly symptomSignal: SymptomSignal | null;
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
 * **A signed visit is never changed** (`FR-DOC-08`). The update applies only
 * while `signed_at` is null; against a signed row it does nothing, and the
 * answer says so (`alreadySigned`) for the service to decide between a replayed
 * sign and a refused edit. Before this, a draft save after signing rewrote the
 * diagnosis and kept the original signing time — a record that read as signed
 * by the doctor and said something else.
 */
export async function upsertVisit(
  trx: Tx,
  write: VisitWrite,
): Promise<{ id: string; alreadySigned: boolean }> {
  const result = await sql<{ id: string }>`
    INSERT INTO visits
      (booking_id, patient_id, hospital_id, doctor_id,
       diagnosis_text, advice_text_bn, follow_up_date, symptom_signal,
       signed_at, created_by)
    VALUES (
      ${write.bookingId}::uuid, ${write.patientId}::uuid,
      ${write.hospitalId}::uuid, ${write.doctorId}::uuid,
      ${write.diagnosisText}, ${write.adviceTextBn},
      ${write.followUpDate}::date,
      ${write.symptomSignal}::symptom_signal,
      ${write.sign ? sql`now()` : sql`NULL`},
      ${write.staffUserId}::uuid
    )
    ON CONFLICT (booking_id) DO UPDATE
       SET diagnosis_text = EXCLUDED.diagnosis_text,
           advice_text_bn = EXCLUDED.advice_text_bn,
           follow_up_date = EXCLUDED.follow_up_date,
           symptom_signal = EXCLUDED.symptom_signal,
           signed_at      = EXCLUDED.signed_at
     WHERE visits.signed_at IS NULL
    RETURNING id
  `.execute(trx);

  const row = result.rows[0];
  if (row !== undefined) return { id: row.id, alreadySigned: false };

  // No row back: the conflict found a signed visit and the WHERE left it alone.
  const signed = await sql<{ id: string }>`
    SELECT id FROM visits WHERE booking_id = ${write.bookingId}::uuid AND signed_at IS NOT NULL
  `.execute(trx);
  const existing = signed.rows[0];
  if (existing === undefined) throw new Error('visit upsert returned no row.');

  return { id: existing.id, alreadySigned: true };
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
  /**
   * Null when what was read identifies somebody who has no patient record —
   * the number an anonymous emergency caller left (`DB-P7`). The read is
   * still logged; there is simply no record to hang it on.
   */
  readonly patientId: string | null;
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
// Consent (`FR-PAT-63`, `FR-PAT-64`)
// ---------------------------------------------------------------------------

/** A grant as the patient sees it on `BTN-A12-ACCESS`. */
export interface ConsentRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly scope: string;
  readonly grantedAt: string;
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
  readonly grantedVia: string;
}

/**
 * Writes a grant, or extends the one already there.
 *
 * A patient handing the same hospital a second code has not granted twice —
 * they have said yes again, which should move the expiry rather than leave two
 * rows for one relationship. The partial unique index this leans on cannot be
 * expressed with `ON CONFLICT`, so the update is explicit and scoped to a live
 * grant of the same scope.
 */
export async function grantConsent(
  trx: Tx,
  input: {
    readonly patientId: string;
    readonly hospitalId: string;
    readonly doctorId: string | null;
    readonly scope: string;
    readonly expiresAt: string | null;
    readonly grantedVia: string;
    readonly staffUserId: string | null;
  },
): Promise<{ id: string; reused: boolean }> {
  const existing = await sql<{ id: string }>`
    SELECT id FROM consents
     WHERE patient_id = ${input.patientId}::uuid
       AND hospital_id = ${input.hospitalId}::uuid
       AND scope = ${input.scope}::consent_scope
       AND revoked_at IS NULL
       AND deleted_at IS NULL
       AND (expires_at IS NULL OR expires_at > now())
     LIMIT 1
  `.execute(trx);

  const found = existing.rows[0];
  if (found !== undefined) {
    await sql`
      UPDATE consents
         SET expires_at = ${input.expiresAt}::timestamptz
       WHERE id = ${found.id}::uuid
    `.execute(trx);

    return { id: found.id, reused: true };
  }

  const inserted = await sql<{ id: string }>`
    INSERT INTO consents
      (patient_id, hospital_id, doctor_id, scope, expires_at, granted_via, created_by)
    VALUES (
      ${input.patientId}::uuid, ${input.hospitalId}::uuid, ${input.doctorId}::uuid,
      ${input.scope}::consent_scope, ${input.expiresAt}::timestamptz,
      ${input.grantedVia}, ${input.staffUserId}::uuid
    )
    RETURNING id
  `.execute(trx);

  const row = inserted.rows[0];
  if (row === undefined) throw new Error('consent insert returned no row.');

  return { id: row.id, reused: false };
}

/**
 * Revokes a grant (`FR-PAT-64`: "explicit and revocable per hospital").
 *
 * A timestamp, never a delete (`DB-P2`). An audit asked six months from now
 * has to be able to answer what was permitted *at the time of a read*, and a
 * deleted row cannot answer that.
 *
 * Returns false when the grant is not this patient's, which the service turns
 * into a 404 rather than a 403 — telling a caller that a consent id exists but
 * belongs to somebody else is itself a disclosure.
 */
export async function revokeConsent(consentId: string, patientId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    UPDATE consents
       SET revoked_at = now()
     WHERE id = ${consentId}::uuid
       AND patient_id = ${patientId}::uuid
       AND revoked_at IS NULL
       AND deleted_at IS NULL
    RETURNING id
  `.execute(db);

  return result.rows.length > 0;
}

/** The profile an account holds as its own (`patients.is_primary`). */
export async function findPrimaryPatient(userId: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM patients
     WHERE owner_user_id = ${userId}::uuid AND deleted_at IS NULL
     ORDER BY is_primary DESC, created_at
     LIMIT 1
  `.execute(db);

  return result.rows[0]?.id ?? null;
}

/** Which patient a grant belongs to, so ownership can be checked before it is touched. */
export async function findConsentPatient(consentId: string): Promise<string | null> {
  const result = await sql<{ patient_id: string }>`
    SELECT patient_id FROM consents
     WHERE id = ${consentId}::uuid AND deleted_at IS NULL
  `.execute(db);

  return result.rows[0]?.patient_id ?? null;
}

/** Every grant this patient has made, live or not, newest first. */
export async function listConsents(patientId: string): Promise<ConsentRow[]> {
  const result = await sql<{
    id: string;
    hospital_id: string;
    hospital_name_bn: string;
    hospital_name_en: string;
    scope: string;
    granted_at: Date;
    expires_at: Date | null;
    revoked_at: Date | null;
    granted_via: string;
  }>`
    SELECT c.id, c.hospital_id,
           h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
           c.scope::text AS scope, c.granted_at, c.expires_at, c.revoked_at, c.granted_via
      FROM consents c
      JOIN hospitals h ON h.id = c.hospital_id
     WHERE c.patient_id = ${patientId}::uuid AND c.deleted_at IS NULL
     ORDER BY c.granted_at DESC
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    hospitalId: row.hospital_id,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    scope: row.scope,
    grantedAt: row.granted_at.toISOString(),
    expiresAt: row.expires_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    grantedVia: row.granted_via,
  }));
}

/** One line of `BTN-A12-ACCESS`: who opened this record, and when. */
export interface AccessEntry {
  readonly at: string;
  readonly hospitalNameBn: string | null;
  readonly hospitalNameEn: string | null;
  readonly staffName: string | null;
  readonly action: string;
}

/**
 * Who has read this patient's records (`FR-PAT-64`, `FR-SEC-03`).
 *
 * "The patient can see who viewed their records and when." This is the read
 * that makes that sentence true, and it is why `DB-P7` writes a row on every
 * patient-identifying access rather than on some of them: a log with gaps
 * would answer the question wrongly while looking complete.
 */
export async function listAccessLog(patientId: string, limit = 50): Promise<AccessEntry[]> {
  const result = await sql<{
    created_at: Date;
    hospital_name_bn: string | null;
    hospital_name_en: string | null;
    staff_name: string | null;
    action: string;
  }>`
    SELECT a.created_at,
           h.name_bn AS hospital_name_bn, h.name_en AS hospital_name_en,
           su.full_name AS staff_name, a.action
      FROM audit_log a
      LEFT JOIN hospitals h    ON h.id = a.hospital_id
      LEFT JOIN staff_users su ON su.id = a.actor_staff_id
     WHERE a.patient_id = ${patientId}::uuid
       AND a.action = 'RECORD_VIEW'
       -- The patient's own reads are not "who viewed my records"; showing them
       -- their own visits back would bury the answer they came for.
       AND a.actor_staff_id IS NOT NULL
     ORDER BY a.created_at DESC
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row) => ({
    at: row.created_at.toISOString(),
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    staffName: row.staff_name,
    action: row.action,
  }));
}

/** The signed record for one booking, for the tracking link (`FR-GST-08`). */
export async function findVisitForBooking(bookingId: string): Promise<VisitRecord | null> {
  const result = await sql<{
    id: string;
    booking_id: string;
    diagnosis_text: string | null;
    advice_text_bn: string | null;
    follow_up_date: Date | string | null;
    signed_at: Date | null;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
    department_name_en: string;
    hospital_name_bn: string;
    hospital_name_en: string;
    serial_number: number;
    visited_at: Date;
    doctor_bmdc: string;
  }>`
    SELECT v.id, v.booking_id, v.diagnosis_text, v.advice_text_bn,
           v.follow_up_date, v.signed_at,
           d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en,
           d.bmdc_number  AS doctor_bmdc,
           dep.name_bn    AS department_name_bn,
           dep.name_en    AS department_name_en,
           h.name_bn      AS hospital_name_bn,
           h.name_en      AS hospital_name_en,
           b.serial_number,
           coalesce(v.signed_at, v.created_at) AS visited_at
      FROM visits v
      JOIN bookings b      ON b.id = v.booking_id
      JOIN sessions sess   ON sess.id = b.session_id
      JOIN departments dep ON dep.id = sess.department_id
      JOIN doctors d       ON d.id = v.doctor_id
      JOIN hospitals h     ON h.id = v.hospital_id
     WHERE v.booking_id = ${bookingId}::uuid
       AND v.deleted_at IS NULL
       AND v.signed_at IS NOT NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;

  return {
    id: row.id,
    bookingId: row.booking_id,
    diagnosisText: row.diagnosis_text,
    adviceTextBn: row.advice_text_bn,
    followUpDate: row.follow_up_date === null ? null : toDateOnly(row.follow_up_date),
    signedAt: row.signed_at?.toISOString() ?? null,
    doctorNameBn: row.doctor_name_bn,
    doctorNameEn: row.doctor_name_en,
    departmentNameBn: row.department_name_bn,
    departmentNameEn: row.department_name_en,
    hospitalNameBn: row.hospital_name_bn,
    hospitalNameEn: row.hospital_name_en,
    serial: row.serial_number,
    visitedAt: row.visited_at.toISOString(),
    doctorBmdc: row.doctor_bmdc,
    medicines: (await medicinesFor([row.id])).get(row.id) ?? [],
  };
}

// ---------------------------------------------------------------------------
// Prescriptions (`FR-DOC-04`, `FR-DOC-05`; plan R2)
// ---------------------------------------------------------------------------

/**
 * The medicines on each of some visits, in the doctor's order.
 *
 * One statement for the whole list, so a wallet of twenty visits is two reads
 * and not twenty-one.
 */
export async function medicinesFor(
  visitIds: readonly string[],
): Promise<Map<string, PrescribedMedicine[]>> {
  const found = new Map<string, PrescribedMedicine[]>();
  if (visitIds.length === 0) return found;

  const result = await sql<{
    visit_id: string;
    medicine_id: string | null;
    name_text: string;
    strength: string | null;
    schedule: string | null;
    duration_days: number | null;
    instruction_bn: string | null;
  }>`
    SELECT p.visit_id, i.medicine_id, i.name_text, i.strength, i.schedule,
           i.duration_days, i.instruction_bn
      FROM prescriptions p
      JOIN prescription_items i ON i.prescription_id = p.id
     WHERE p.visit_id = ANY(${visitIds}::uuid[])
       AND p.deleted_at IS NULL
       AND i.deleted_at IS NULL
     ORDER BY i.created_at, i.id
  `.execute(db);

  for (const row of result.rows) {
    const list = found.get(row.visit_id) ?? [];
    list.push({
      medicineId: row.medicine_id,
      name: row.name_text,
      strength: row.strength,
      schedule: row.schedule,
      durationDays: row.duration_days,
      instructionBn: row.instruction_bn,
    });
    found.set(row.visit_id, list);
  }
  return found;
}

/**
 * Replaces a draft visit's medicines (`FR-DOC-04`).
 *
 * Called only for a visit that is not signed, in the transaction that wrote
 * it: once signed, the service never reaches here, so a signed prescription is
 * as final as its visit. A list with nothing in it leaves no prescription.
 * Each row is stamped a microsecond after the last, so the order the doctor
 * wrote them in is the order every reader gets, whatever the ids sort as.
 */
export async function replaceMedicines(
  trx: Tx,
  input: {
    readonly visitId: string;
    readonly staffUserId: string | null;
    readonly medicines: readonly PrescribedMedicine[];
  },
): Promise<void> {
  await sql`
    DELETE FROM prescription_items
     WHERE prescription_id IN (SELECT id FROM prescriptions WHERE visit_id = ${input.visitId}::uuid)
  `.execute(trx);

  if (input.medicines.length === 0) {
    await sql`DELETE FROM prescriptions WHERE visit_id = ${input.visitId}::uuid`.execute(trx);
    return;
  }

  const written = await sql<{ id: string }>`
    INSERT INTO prescriptions (visit_id, created_by)
    VALUES (${input.visitId}::uuid, ${input.staffUserId}::uuid)
    ON CONFLICT (visit_id) DO UPDATE SET updated_at = now()
    RETURNING id
  `.execute(trx);
  const prescriptionId = written.rows[0]?.id;
  if (prescriptionId === undefined) throw new Error('prescription upsert returned no row.');

  for (const [index, medicine] of input.medicines.entries()) {
    await sql`
      INSERT INTO prescription_items
        (prescription_id, medicine_id, name_text, strength, schedule, duration_days,
         instruction_bn, created_at)
      VALUES (${prescriptionId}::uuid, ${medicine.medicineId}::uuid, ${medicine.name},
              ${medicine.strength}, ${medicine.schedule}, ${medicine.durationDays},
              ${medicine.instructionBn}, now() + ${index}::int * interval '1 microsecond')
    `.execute(trx);
  }
}

/**
 * The formulary, by the start of a generic or brand name (`FR-DOC-05`).
 *
 * A prefix match, which is what the two indexes in 0007 are for. The pattern's
 * own wildcards are escaped, so a doctor typing `%` searches for a percent
 * sign and not for everything.
 */
export async function searchFormulary(query: string, limit = 10): Promise<FormularyEntry[]> {
  const prefix = `${query.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const result = await sql<{
    id: string;
    generic_name: string;
    brand_name: string | null;
    form: string | null;
    strengths: string[];
  }>`
    SELECT id, generic_name, brand_name, form, strengths
      FROM medicines
     WHERE deleted_at IS NULL
       AND (lower(generic_name) LIKE ${prefix} OR lower(brand_name) LIKE ${prefix})
     ORDER BY generic_name, brand_name NULLS LAST
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    genericName: row.generic_name,
    brandName: row.brand_name,
    form: row.form,
    strengths: row.strengths,
  }));
}

// ---------------------------------------------------------------------------
// A patient's own old papers (`FR-PAT-62`; plan R3)
// ---------------------------------------------------------------------------

/** One paper a patient added, as their screens and a consenting doctor list it. */
export interface PatientDocument {
  readonly id: string;
  readonly docType: string | null;
  readonly docDate: string | null;
  readonly doctorName: string | null;
  readonly contentType: string | null;
  readonly byteSize: number | null;
  readonly uploadedAt: string;
  /** Always: a paper the patient gave is never read as a hospital's record. */
  readonly source: 'patient_provided';
}

export async function insertDocument(input: {
  readonly id: string;
  readonly patientId: string;
  readonly key: string;
  readonly docType: string;
  readonly docDate: string | null;
  readonly doctorName: string | null;
  readonly contentType: string;
  readonly byteSize: number;
  readonly userId: string;
}): Promise<PatientDocument> {
  const result = await sql<{ uploaded_at: Date }>`
    INSERT INTO patient_documents
      (id, patient_id, file_url, doc_type, doc_date, doctor_name_text, content_type,
       byte_size, uploaded_by_user)
    VALUES (${input.id}::uuid, ${input.patientId}::uuid, ${input.key}, ${input.docType},
            ${input.docDate}::date, ${input.doctorName}, ${input.contentType},
            ${input.byteSize}, ${input.userId}::uuid)
    RETURNING uploaded_at
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) throw new Error('document insert returned no row.');
  return {
    id: input.id,
    docType: input.docType,
    docDate: input.docDate,
    doctorName: input.doctorName,
    contentType: input.contentType,
    byteSize: input.byteSize,
    uploadedAt: row.uploaded_at.toISOString(),
    source: 'patient_provided',
  };
}

/** A profile's papers, newest paper first, removed ones left out. */
export async function listDocuments(patientId: string): Promise<PatientDocument[]> {
  const result = await sql<{
    id: string;
    doc_type: string | null;
    doc_date: Date | string | null;
    doctor_name_text: string | null;
    content_type: string | null;
    byte_size: number | null;
    uploaded_at: Date;
  }>`
    SELECT id, doc_type, doc_date, doctor_name_text, content_type, byte_size, uploaded_at
      FROM patient_documents
     WHERE patient_id = ${patientId}::uuid AND deleted_at IS NULL
     ORDER BY coalesce(doc_date, uploaded_at::date) DESC, uploaded_at DESC
     LIMIT 100
  `.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    docType: row.doc_type,
    docDate: row.doc_date === null ? null : toDateOnly(row.doc_date),
    doctorName: row.doctor_name_text,
    contentType: row.content_type,
    byteSize: row.byte_size,
    uploadedAt: row.uploaded_at.toISOString(),
    source: 'patient_provided',
  }));
}

/** The paper's patient and object key, for a check before it is opened or removed. */
export async function findDocument(
  documentId: string,
): Promise<{ readonly patientId: string; readonly key: string } | null> {
  const result = await sql<{ patient_id: string; file_url: string }>`
    SELECT patient_id, file_url
      FROM patient_documents
     WHERE id = ${documentId}::uuid AND deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : { patientId: row.patient_id, key: row.file_url };
}

/** Marks a paper removed. The row and the file stay, as every clinical row's do. */
export async function removeDocument(documentId: string): Promise<boolean> {
  const result = await sql`
    UPDATE patient_documents SET deleted_at = now()
     WHERE id = ${documentId}::uuid AND deleted_at IS NULL
  `.execute(db);
  return Number(result.numAffectedRows ?? 0) > 0;
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
 * Two shapes arrive here and both have to be handled.
 *
 * `pg` may hand back a `Date` at **local** midnight for a `date` column, so
 * `toISOString()` on it can land on the previous day west of UTC. The parts are
 * read directly instead, because the value has no timezone to convert.
 *
 * It may equally hand back the raw `YYYY-MM-DD` string, depending on which type
 * parsers are installed in the process. Assuming the `Date` was a real bug:
 * `value.getFullYear is not a function` threw a 500 out of the wallet for any
 * patient whose history happened to include a follow-up date, and it only
 * showed up intermittently because it depended on which patient was read.
 */
function toDateOnly(value: Date | string): string {
  if (typeof value === 'string') {
    // Already a calendar date. Slice rather than parse: turning it into a
    // `Date` would reintroduce exactly the timezone shift this avoids.
    return value.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${String(year)}-${month}-${day}`;
}
