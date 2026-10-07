/**
 * A hospital's own application for a workspace (`FR-ONB-09`; plan D1;
 * migration 0049).
 *
 * The rows are the ones a platform administrator's `POST /platform/hospitals`
 * writes (`staffAuth.repo`): a hospital that is not live with its settings at
 * the defaults, and one staff account holding `hospital_admin`. What differs
 * is that the hospital is marked as having applied, carries the key it was
 * sent with, and that the account's password is the applicant's own.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** The workspace an application made, as its answer names it. */
export interface Application {
  readonly hospitalId: string;
  readonly code: string;
  readonly adminEmail: string;
}

/** The workspace made by the application sent with this key, if one was. */
export async function findByKey(key: string): Promise<Application | null> {
  const result = await sql<{ id: string; code: string; email: string }>`
    SELECT h.id, h.code, u.email
      FROM hospitals h
      JOIN staff_users u ON u.hospital_id = h.id
      JOIN staff_roles r ON r.staff_user_id = u.id AND r.hospital_id = h.id
     WHERE h.application_key = ${key} AND h.deleted_at IS NULL
       AND r.role = 'hospital_admin' AND r.deleted_at IS NULL
     ORDER BY u.created_at
     LIMIT 1
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : { hospitalId: row.id, code: row.code, adminEmail: row.email };
}

/** The codes already taken that begin with this word: it, and it with a number. */
export async function codesFrom(stem: string): Promise<Set<string>> {
  const result = await sql<{ code: string }>`
    SELECT code FROM hospitals
     WHERE deleted_at IS NULL AND code IS NOT NULL
       AND (code = ${stem} OR code LIKE ${`${stem}-%`})
  `.execute(db);
  return new Set(result.rows.map((row) => row.code));
}

/** Applications nobody has acted on yet: self-registered and still setting up. */
export async function openApplications(): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM hospitals
     WHERE self_registered AND lifecycle = 'setup' AND deleted_at IS NULL
  `.execute(db);
  return Number(result.rows[0]?.n ?? '0');
}

/**
 * The workspace: not live, setting up, marked as applied for, with its
 * settings row at the defaults (0004), as `staffAuth.repo.createHospital`
 * leaves one.
 */
export async function createWorkspace(
  trx: Tx,
  input: {
    readonly code: string;
    readonly key: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly kind: string;
    readonly division: string;
    readonly district: string;
    readonly phone: string;
    readonly registrationNo: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO hospitals (code, name_bn, name_en, kind, division, district, phone,
                           registration_no, is_live, self_registered, application_key)
    VALUES (${input.code}, ${input.nameBn}, ${input.nameEn}, ${input.kind}::facility_kind,
            ${input.division}, ${input.district}, ${input.phone},
            ${input.registrationNo}, false, true, ${input.key})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('hospitals returned no id');
  await sql`INSERT INTO hospital_settings (hospital_id) VALUES (${id})`.execute(trx);
  return id;
}

/**
 * The applicant's own account. The password is the one they chose, so there
 * is none to change at first sign-in; two-step verification is still set up
 * before any console opens, as for every administrator (`FR-SEC-10`).
 */
export async function createApplicant(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly email: string;
    readonly fullName: string;
    readonly phone: string;
    readonly passwordHash: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO staff_users (hospital_id, email, full_name, phone, password_hash,
                             must_change_password, password_changed_at)
    VALUES (${input.hospitalId}, ${input.email}, ${input.fullName}, ${input.phone},
            ${input.passwordHash}, false, now())
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('staff_users returned no id');
  return id;
}
