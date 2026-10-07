/**
 * Reads and writes for the platform's side of onboarding (`PRD.md` §14c,
 * `FR-ONB-*`, `S-B-12`).
 *
 * ## What is not in this file
 *
 * A patient. `FR-ONB-08`: the platform administrator's screen "shows
 * organisations and counts. It never shows a patient, a booking or a record."
 * So nothing here selects from `patients`, `bookings`, `visits` or anything
 * beneath them, and the counts are of what a hospital has set up — its
 * departments, doctors, schedules, beds and staff — never of whom it has
 * seen. A doctor's name and BMDC number are here because verifying them is
 * the platform's job (`FR-ONB-05`) and both are on the public register.
 */

import { sql } from 'kysely';

import type { OrgLifecycle, SetupCounts } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** The counts the checklist is made of, for one hospital, as one statement. */
const COUNTS = sql`
  (SELECT count(*) FROM departments dep
    WHERE dep.hospital_id = h.id AND dep.deleted_at IS NULL)::int AS departments,
  (SELECT count(*) FROM doctor_hospitals dh
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND dh.is_active)::int AS doctors,
  (SELECT count(*) FROM doctor_hospitals dh
     JOIN doctors d ON d.id = dh.doctor_id
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND dh.is_active
      AND d.deleted_at IS NULL AND d.bmdc_verified_at IS NOT NULL)::int AS verified_doctors,
  (SELECT count(*) FROM session_templates st
     JOIN doctor_hospitals dh ON dh.id = st.doctor_hospital_id
    WHERE dh.hospital_id = h.id AND dh.deleted_at IS NULL AND st.deleted_at IS NULL)::int AS schedules,
  (SELECT count(*) FROM beds b
    WHERE b.hospital_id = h.id AND b.deleted_at IS NULL)::int AS beds,
  (SELECT count(*) FROM staff_users su
    WHERE su.hospital_id = h.id AND su.deleted_at IS NULL AND su.is_active)::int AS staff
`;

interface CountColumns {
  departments: number;
  doctors: number;
  verified_doctors: number;
  schedules: number;
  beds: number;
  staff: number;
}

function countsOf(row: CountColumns): SetupCounts {
  return {
    departments: row.departments,
    doctors: row.doctors,
    verifiedDoctors: row.verified_doctors,
    schedules: row.schedules,
    beds: row.beds,
    staff: row.staff,
  };
}

/** What exists at a hospital (`FR-ONB-03`): counted now, never stored. */
export async function setupCounts(hospitalId: string): Promise<SetupCounts | null> {
  const result = await sql<CountColumns>`
    SELECT ${COUNTS} FROM hospitals h WHERE h.id = ${hospitalId} AND h.deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : countsOf(row);
}

/** A workspace as the platform's list shows it. */
export interface WorkspaceRow {
  readonly id: string;
  readonly code: string | null;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: string;
  readonly division: string;
  readonly district: string;
  readonly registrationNo: string | null;
  /** True when the hospital applied for this workspace itself (`FR-ONB-10`). */
  readonly selfRegistered: boolean;
  /** A domain the hospital owns, recorded for its portal (`FR-BRD-07`); null for none. */
  readonly portalDomain: string | null;
  /** The modules it does not run (`FR-BRD-11`); empty when everything is on. */
  readonly modulesOff: readonly string[];
  readonly lifecycle: OrgLifecycle;
  readonly isLive: boolean;
  readonly reviewRequestedAt: string | null;
  readonly reviewedAt: string | null;
  readonly reviewNote: string | null;
  readonly createdAt: string;
  readonly counts: SetupCounts;
}

interface WorkspaceColumns extends CountColumns {
  id: string;
  code: string | null;
  name_bn: string;
  name_en: string;
  kind: string;
  division: string;
  district: string;
  registration_no: string | null;
  self_registered: boolean;
  portal_domain: string | null;
  modules_off: string[];
  lifecycle: OrgLifecycle;
  is_live: boolean;
  review_requested_at: Date | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
}

function workspaceOf(row: WorkspaceColumns): WorkspaceRow {
  return {
    id: row.id,
    code: row.code,
    nameBn: row.name_bn,
    nameEn: row.name_en,
    kind: row.kind,
    division: row.division,
    district: row.district,
    registrationNo: row.registration_no,
    selfRegistered: row.self_registered,
    portalDomain: row.portal_domain,
    modulesOff: row.modules_off,
    lifecycle: row.lifecycle,
    isLive: row.is_live,
    reviewRequestedAt: row.review_requested_at?.toISOString() ?? null,
    reviewedAt: row.reviewed_at?.toISOString() ?? null,
    reviewNote: row.review_note,
    createdAt: row.created_at.toISOString(),
    counts: countsOf(row),
  };
}

const WORKSPACE_COLUMNS = sql`
  h.id, h.code, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
  h.registration_no, h.self_registered, h.portal_domain,
  coalesce((SELECT s.modules_off FROM hospital_settings s WHERE s.hospital_id = h.id),
           '{}'::text[]) AS modules_off,
  h.lifecycle::text AS lifecycle, h.is_live,
  h.review_requested_at, h.reviewed_at, h.review_note, h.created_at
`;

/**
 * Every workspace, the ones waiting for review first and oldest first among
 * them: that is the order they are owed an answer in.
 */
export async function listWorkspaces(): Promise<WorkspaceRow[]> {
  const result = await sql<WorkspaceColumns>`
    SELECT ${WORKSPACE_COLUMNS}, ${COUNTS}
      FROM hospitals h
     WHERE h.deleted_at IS NULL
     ORDER BY (h.lifecycle = 'ready_for_review') DESC,
              h.review_requested_at NULLS LAST,
              h.created_at DESC
  `.execute(db);
  return result.rows.map(workspaceOf);
}

export async function findWorkspace(hospitalId: string): Promise<WorkspaceRow | null> {
  const result = await sql<WorkspaceColumns>`
    SELECT ${WORKSPACE_COLUMNS}, ${COUNTS}
      FROM hospitals h
     WHERE h.id = ${hospitalId} AND h.deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : workspaceOf(row);
}

/** The hospital that already has this domain, if any does. */
export async function hospitalWithDomain(domain: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE portal_domain = ${domain} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

/** Records a hospital's own domain, or removes it (`FR-BRD-07`, migration 0046). */
export async function setPortalDomain(
  trx: Tx,
  hospitalId: string,
  domain: string | null,
): Promise<void> {
  await sql`
    UPDATE hospitals SET portal_domain = ${domain}, updated_at = now()
     WHERE id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
}

/** A doctor as the platform verifies them: what is on the public register. */
export interface WorkspaceDoctor {
  readonly doctorId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly bmdcNumber: string;
  readonly degrees: string | null;
  readonly verifiedAt: string | null;
}

export async function doctorsOf(hospitalId: string): Promise<WorkspaceDoctor[]> {
  const result = await sql<{
    id: string;
    full_name_bn: string;
    full_name_en: string;
    bmdc_number: string;
    degrees: string | null;
    bmdc_verified_at: Date | null;
  }>`
    SELECT DISTINCT d.id, d.full_name_bn, d.full_name_en, d.bmdc_number, d.degrees,
           d.bmdc_verified_at
      FROM doctor_hospitals dh
      JOIN doctors d ON d.id = dh.doctor_id
     WHERE dh.hospital_id = ${hospitalId} AND dh.deleted_at IS NULL AND dh.is_active
       AND d.deleted_at IS NULL
     ORDER BY d.full_name_en
  `.execute(db);

  return result.rows.map((row) => ({
    doctorId: row.id,
    nameBn: row.full_name_bn,
    nameEn: row.full_name_en,
    bmdcNumber: row.bmdc_number,
    degrees: row.degrees,
    verifiedAt: row.bmdc_verified_at?.toISOString() ?? null,
  }));
}

/**
 * The facility's own phone, as it gave it; null when it gave none.
 *
 * Read for one workspace when it is opened and not with the list: the list
 * is organisations and counts (`FR-ONB-08`), and somebody rings a hospital
 * only once they are looking at it (`FR-ONB-10`).
 */
export async function facilityPhoneOf(hospitalId: string): Promise<string | null> {
  const result = await sql<{ phone: string | null }>`
    SELECT phone FROM hospitals WHERE id = ${hospitalId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.phone ?? null;
}

/** The administrators a workspace has: who the platform would write to. */
export async function administratorsOf(
  hospitalId: string,
): Promise<{ readonly fullName: string; readonly email: string; readonly phone: string | null }[]> {
  const result = await sql<{ full_name: string; email: string; phone: string | null }>`
    SELECT su.full_name, su.email, su.phone
      FROM staff_users su
      JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.hospital_id = su.hospital_id
     WHERE su.hospital_id = ${hospitalId} AND su.deleted_at IS NULL AND su.is_active
       AND sr.role = 'hospital_admin' AND sr.deleted_at IS NULL
     ORDER BY su.created_at
  `.execute(db);
  return result.rows.map((row) => ({
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
  }));
}

/**
 * Moves a workspace from one state to another, and only from that one.
 *
 * `from` is in the WHERE clause: two administrators acting on the same
 * workspace at once cannot both succeed, and the second is told nothing
 * changed rather than overwriting the first. `is_live` is written in the same
 * statement as the state, so the CHECK that ties them (0037) never sees one
 * without the other.
 */
export async function moveLifecycle(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly from: OrgLifecycle;
    readonly to: OrgLifecycle;
    /** Set for the platform's acts; null for the hospital's own request. */
    readonly reviewedBy: string | null;
    /** Undefined leaves the note as it is; null clears it. */
    readonly note?: string | null;
  },
): Promise<boolean> {
  const live = input.to === 'active';
  const requested = input.to === 'ready_for_review';

  const result = await sql<{ id: string }>`
    UPDATE hospitals
       SET lifecycle = ${input.to}::org_lifecycle,
           is_live = ${live},
           onboarded_at = CASE WHEN ${live} THEN coalesce(onboarded_at, now()) ELSE onboarded_at END,
           review_requested_at = CASE WHEN ${requested} THEN now() ELSE review_requested_at END,
           reviewed_at = CASE WHEN ${input.reviewedBy}::uuid IS NULL THEN reviewed_at ELSE now() END,
           reviewed_by = coalesce(${input.reviewedBy}::uuid, reviewed_by),
           review_note = CASE WHEN ${input.note !== undefined} THEN ${input.note ?? null} ELSE review_note END,
           updated_at = now()
     WHERE id = ${input.hospitalId}
       AND lifecycle = ${input.from}::org_lifecycle
       AND deleted_at IS NULL
    RETURNING id
  `.execute(trx);

  return result.rows.length === 1;
}

export async function setRegistrationNo(
  trx: Tx,
  hospitalId: string,
  registrationNo: string | null,
): Promise<void> {
  await sql`
    UPDATE hospitals SET registration_no = ${registrationNo}, updated_at = now()
     WHERE id = ${hospitalId}
  `.execute(trx);
}

/**
 * Records that a doctor's BMDC number has been checked against the register
 * (`FR-SUP-02`, `FR-ONB-05`).
 *
 * Only a doctor who sits at this hospital: the platform verifies a doctor
 * while reviewing a workspace, and the audit row names that workspace. True
 * when the doctor is verified afterwards, whether or not this call was the
 * one that did it.
 */
export async function verifyDoctorAt(
  trx: Tx,
  input: { readonly hospitalId: string; readonly doctorId: string },
): Promise<boolean> {
  const result = await sql<{ id: string }>`
    UPDATE doctors d
       SET bmdc_verified_at = coalesce(d.bmdc_verified_at, now()), updated_at = now()
     WHERE d.id = ${input.doctorId} AND d.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM doctor_hospitals dh
                    WHERE dh.doctor_id = d.id AND dh.hospital_id = ${input.hospitalId}
                      AND dh.deleted_at IS NULL)
    RETURNING d.id
  `.execute(trx);
  return result.rows.length === 1;
}
