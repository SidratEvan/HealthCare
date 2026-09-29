/**
 * Finding a patient by phone at the counter (`S-B-03`, pilot step 23,
 * `FR-REC-20`).
 *
 * One phone often stands for a household: a mother books for herself, her
 * child and her father from the same number. So a lookup returns every
 * patient that number reaches — through the guest identity it owns, the
 * account it owns, or as the patient's own contact number — and the
 * receptionist picks the person standing there.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

export interface CounterPatient {
  readonly patientId: string;
  readonly fullName: string;
  /** Stored age, or the age the date of birth gives today. */
  readonly ageYears: number | null;
  readonly sex: string;
  readonly relationship: string;
  readonly isPrimary: boolean;
  /**
   * Whose record it is: an account holder's, a guest's (`FR-GST-01`), or this
   * hospital's own, imported from its register (`FR-IMP-10`).
   */
  readonly owner: 'account' | 'guest' | 'hospital';
}

/**
 * A patient another hospital imported is that hospital's alone (`FR-IMP-10`),
 * so only this facility's own imported patients are ever shown here.
 */
export async function patientsForPhone(phone: string, hospitalId: string): Promise<CounterPatient[]> {
  const result = await sql<{
    id: string;
    full_name: string;
    age_years: number | null;
    sex: string;
    relationship: string;
    is_primary: boolean;
    owner: 'account' | 'guest' | 'hospital';
  }>`
    SELECT p.id, p.full_name,
           coalesce(p.age_years, date_part('year', age(p.date_of_birth))::int) AS age_years,
           p.sex::text AS sex, p.relationship, p.is_primary,
           CASE WHEN p.owner_user_id IS NOT NULL THEN 'account'
                WHEN p.owner_hospital_id IS NOT NULL THEN 'hospital' ELSE 'guest' END AS owner
      FROM patients p
      LEFT JOIN guest_identities g ON g.id = p.owner_guest_id AND g.deleted_at IS NULL
      LEFT JOIN users u ON u.id = p.owner_user_id AND u.deleted_at IS NULL
     WHERE p.deleted_at IS NULL
       AND (g.phone = ${phone} OR u.phone = ${phone} OR p.phone = ${phone})
       AND (p.owner_hospital_id IS NULL OR p.owner_hospital_id = ${hospitalId})
     ORDER BY p.is_primary DESC, p.full_name
     LIMIT 20
  `.execute(db);
  return result.rows.map((row) => ({
    patientId: row.id,
    fullName: row.full_name,
    ageYears: row.age_years,
    sex: row.sex,
    relationship: row.relationship,
    isPrimary: row.is_primary,
    owner: row.owner,
  }));
}

/**
 * One `RECORD_VIEW` row per patient a lookup showed (`DB-P7`). A lookup shows
 * only a name, an age and a sex, but it is still a staff member learning who a
 * number belongs to, and "who looked me up" is the question the audit log is
 * for.
 */
export async function recordLookup(
  trx: Tx,
  input: {
    readonly actorStaffId: string;
    readonly hospitalId: string;
    readonly patientIds: readonly string[];
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  for (const patientId of input.patientIds) {
    await sql`
      INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id,
                             patient_id, ip, user_agent, meta)
      VALUES (${input.actorStaffId}, ${input.hospitalId}, 'RECORD_VIEW', 'patients', ${patientId},
              ${patientId}, ${input.ip}::inet, ${input.userAgent},
              ${JSON.stringify({ purpose: 'registration_lookup' })}::jsonb)
    `.execute(trx);
  }
}
