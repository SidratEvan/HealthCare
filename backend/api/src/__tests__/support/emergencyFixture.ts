/**
 * Tokens and lookups for the emergency route tests.
 *
 * Built from the seeded demo set (CLAUDE.md §6): a real ER, its real
 * coordinator account, its real ward. Nothing here inserts facilities or
 * staff; the cases each test creates are its own, and every assertion about a
 * count is made relative to what was there before, because the API suite
 * shares its database across files.
 */

import { sql } from 'kysely';

import { db } from '../../config/db.js';
import { signToken } from '../../config/jwt.js';

import { staffIdFor } from './queueFixture.js';

/** Farmgate, Dhaka — nearer Jamuna than Padma, and near Shapla (`PRD.md` §24 step 7). */
export const FARMGATE = { lat: 23.758, lng: 90.39 } as const;

export interface ErFixture {
  readonly hospitalId: string;
  readonly erStaffId: string;
  readonly erToken: string;
  readonly wardToken: string;
  readonly receptionistToken: string;
  readonly adminToken: string;
}

export async function seededHospitalId(nameEnPrefix: string): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE name_en LIKE ${`${nameEnPrefix}%`} AND deleted_at IS NULL LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error(`The seed should hold ${nameEnPrefix} (FR-DEM-01).`);
  return id;
}

export async function erFixture(nameEnPrefix: string): Promise<ErFixture> {
  const hospitalId = await seededHospitalId(nameEnPrefix);
  const erStaffId = await staffIdFor(hospitalId, 'emergency');
  return {
    hospitalId,
    erStaffId,
    erToken: await staffTokenFor(erStaffId, hospitalId, 'emergency'),
    wardToken: await staffTokenFor(await staffIdFor(hospitalId, 'ward'), hospitalId, 'ward'),
    receptionistToken: await staffTokenFor(
      await staffIdFor(hospitalId, 'receptionist'),
      hospitalId,
      'receptionist',
    ),
    adminToken: await staffTokenFor(
      await staffIdFor(hospitalId, 'hospital_admin'),
      hospitalId,
      'hospital_admin',
    ),
  };
}

export async function staffTokenFor(
  staffId: string,
  hospitalId: string,
  role: string,
): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: staffId, kind: 'staff', hospitalId, roles: [role] },
  });
}

/** The row as the database has it, for assertions the API does not return. */
export async function caseRow(caseId: string): Promise<{
  state: string;
  triage: string | null;
  token_label: string | null;
  contact_phone: string | null;
  inbound_eta_minutes: number | null;
  decline_reason: string | null;
  patient_id: string | null;
  closed_at: Date | null;
}> {
  const result = await sql<{
    state: string;
    triage: string | null;
    token_label: string | null;
    contact_phone: string | null;
    inbound_eta_minutes: number | null;
    decline_reason: string | null;
    patient_id: string | null;
    closed_at: Date | null;
  }>`
    SELECT state::text AS state, triage::text AS triage, token_label, contact_phone,
           inbound_eta_minutes, decline_reason, patient_id, closed_at
      FROM emergency_cases WHERE id = ${caseId}::uuid
  `.execute(db);
  const row = result.rows[0];
  if (row === undefined) throw new Error('no such case');
  return row;
}

/** Messages written for one case, by template. */
export async function messagesFor(
  caseId: string,
): Promise<{ template_key: string; channel: string; state: string; phone: string | null }[]> {
  const result = await sql<{
    template_key: string;
    channel: string;
    state: string;
    phone: string | null;
  }>`
    SELECT template_key, channel::text AS channel, state::text AS state, phone
      FROM notifications WHERE params ->> 'emergencyCaseId' = ${caseId}
     ORDER BY queued_at, id
  `.execute(db);
  return result.rows;
}

/** Audited reads of one case (`DB-P7`). */
export async function auditedReadsOf(caseId: string): Promise<number> {
  const result = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM audit_log
     WHERE subject_table = 'emergency_cases' AND subject_id = ${caseId}::uuid
       AND action = 'RECORD_VIEW'
  `.execute(db);
  return Number(result.rows[0]?.n ?? '0');
}

/**
 * The oldest stamp among the figures a burn result is ranked on: capability
 * and burn beds (`stampsFor` in `shared/domain`).
 */
export async function oldestBurnCardStamp(hospitalId: string): Promise<number> {
  const result = await sql<{ oldest: Date | null }>`
    SELECT LEAST(
             v.capability_as_of,
             (SELECT (k ->> 'asOf')::timestamptz FROM jsonb_array_elements(v.by_kind) k
               WHERE k ->> 'kind' = 'burn')
           ) AS oldest
      FROM v_public_hospital_capacity v
     WHERE v.hospital_id = ${hospitalId}::uuid
  `.execute(db);
  const oldest = result.rows[0]?.oldest;
  if (oldest === undefined || oldest === null) throw new Error('No burn card stamps.');
  return oldest.getTime();
}
