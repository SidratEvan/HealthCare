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

import type {
  AgreementState,
  FigureStamp,
  MessageCounts,
  OrgLifecycle,
  SetupCounts,
  SyncCounts,
  Timestamp,
} from '@platform/domain';

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
    WHERE su.hospital_id = h.id AND su.deleted_at IS NULL AND su.is_active)::int AS staff,
  -- Plan D2: what a patient needs to reach the place, as a yes or a no.
  (CASE WHEN h.phone IS NOT NULL AND coalesce(h.address_bn, h.address_en) IS NOT NULL
        THEN 1 ELSE 0 END)::int AS contact,
  (CASE WHEN h.lat IS NOT NULL AND h.lng IS NOT NULL THEN 1 ELSE 0 END)::int AS location,
  -- Null where there is no emergency desk to declare anything of (FR-BRD-11).
  (CASE WHEN fn_module_on(h.id, 'emergency')
        THEN (SELECT count(*) FROM capabilities c WHERE c.hospital_id = h.id)::int
        ELSE NULL END) AS capabilities
`;

interface CountColumns {
  departments: number;
  doctors: number;
  verified_doctors: number;
  schedules: number;
  beds: number;
  staff: number;
  contact: number;
  location: number;
  capabilities: number | null;
}

function countsOf(row: CountColumns): SetupCounts {
  return {
    departments: row.departments,
    doctors: row.doctors,
    verifiedDoctors: row.verified_doctors,
    schedules: row.schedules,
    beds: row.beds,
    staff: row.staff,
    contact: row.contact,
    location: row.location,
    capabilities: row.capabilities,
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
  /**
   * Where its agreement stands, as the platform last recorded it
   * (`FR-SUP-04`, 0051). No plan and no amount: those are not in the product.
   */
  readonly agreement: {
    readonly state: AgreementState;
    readonly note: string | null;
    readonly changedAt: string | null;
  };
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
  agreement_state: AgreementState;
  agreement_note: string | null;
  agreement_changed_at: Date | null;
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
    agreement: {
      state: row.agreement_state,
      note: row.agreement_note,
      changedAt: row.agreement_changed_at?.toISOString() ?? null,
    },
  };
}

const WORKSPACE_COLUMNS = sql`
  h.id, h.code, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
  h.registration_no, h.self_registered, h.portal_domain,
  coalesce((SELECT s.modules_off FROM hospital_settings s WHERE s.hospital_id = h.id),
           '{}'::text[]) AS modules_off,
  h.lifecycle::text AS lifecycle, h.is_live,
  h.review_requested_at, h.reviewed_at, h.review_note, h.created_at,
  h.agreement_state::text AS agreement_state, h.agreement_note, h.agreement_changed_at
`;

/** Records where a hospital's agreement stands (`FR-SUP-04`). False when it is not there. */
export async function setAgreement(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly state: AgreementState;
    readonly note: string | null;
    readonly changedBy: string;
  },
): Promise<boolean> {
  const result = await sql<{ id: string }>`
    UPDATE hospitals
       SET agreement_state = ${input.state}::agreement_state,
           agreement_note = ${input.note},
           agreement_changed_at = now(),
           agreement_changed_by = ${input.changedBy}::uuid,
           updated_at = now()
     WHERE id = ${input.hospitalId} AND deleted_at IS NULL
    RETURNING id
  `.execute(trx);
  return result.rows.length === 1;
}

/** What a hospital has used: three counts, from a function that returns no row of anybody's. */
export interface WorkspaceUsage {
  /** Serials taken at its chambers in the last thirty days. */
  readonly serialsTaken30d: number;
  /** Chambers that actually began in the last thirty days. */
  readonly chambersHeld30d: number;
  /** SMS sent for its chambers this calendar month. */
  readonly messagesSentThisMonth: number;
}

/**
 * `fn_workspace_usage` (0051). A platform administrator's connection cannot
 * read a booking or a message, and must not; the function counts with its
 * owner's rights and answers the platform and the server only.
 */
export async function usageOf(hospitalId: string): Promise<WorkspaceUsage> {
  const result = await sql<{
    serials_30d: number | null;
    chambers_30d: number | null;
    messages_month: number | null;
  }>`
    SELECT serials_30d, chambers_30d, messages_month FROM fn_workspace_usage(${hospitalId}::uuid)
  `.execute(db);
  const row = result.rows[0];
  return {
    serialsTaken30d: row?.serials_30d ?? 0,
    chambersHeld30d: row?.chambers_30d ?? 0,
    messagesSentThisMonth: row?.messages_month ?? 0,
  };
}

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

// --- health and the trail of changes (`FR-SUP-06`, `FR-ONB-07`, plan G2) ------

/** What was counted for one workspace's health. The rule that reads it is the domain's. */
export interface HealthCounts {
  readonly live: boolean;
  /** The hospital's own threshold, the one a patient's screen uses for it. */
  readonly staleAfterMinutes: number;
  /** One per figure the hospital has to report: none for a module it does not run. */
  readonly stamps: readonly FigureStamp[];
  readonly messages: MessageCounts;
  readonly sync: SyncCounts;
}

interface HealthColumns {
  id: string;
  is_live: boolean;
  stale_after: number;
  reports_beds: boolean;
  shares_beds: boolean;
  beds_as_of: Date | null;
  reports_capabilities: boolean;
  capabilities_as_of: Date | null;
  messages_sent: number | null;
  messages_failed: number | null;
  messages_held: number | null;
  messages_waiting: number | null;
  late_actions: number | null;
  slowest_seconds: number | null;
  last_late_at: Date | null;
}

const stamp = (value: Date | null): Timestamp | null =>
  value === null ? null : (value.toISOString() as Timestamp);

function healthOfRow(row: HealthColumns): HealthCounts {
  const stamps: FigureStamp[] = [];
  if (row.reports_beds) {
    stamps.push({ figure: 'beds', shared: row.shares_beds, asOf: stamp(row.beds_as_of) });
  }
  if (row.reports_capabilities) {
    stamps.push({ figure: 'capabilities', shared: true, asOf: stamp(row.capabilities_as_of) });
  }
  return {
    live: row.is_live,
    staleAfterMinutes: row.stale_after,
    stamps,
    messages: {
      sent: row.messages_sent ?? 0,
      failed: row.messages_failed ?? 0,
      held: row.messages_held ?? 0,
      waiting: row.messages_waiting ?? 0,
    },
    sync: {
      lateActions: row.late_actions ?? 0,
      slowestSeconds: row.slowest_seconds ?? 0,
      lastLateAt: stamp(row.last_late_at),
    },
  };
}

/**
 * The health of one workspace, or of every one (`hospitalId` null).
 *
 * The ages are of what the hospital publishes, read where a patient's screen
 * reads them: the bed figure's is the public view's own `beds_as_of`, the
 * oldest kind's; the emergency services' is the oldest declaration's. A
 * figure is reported only where the hospital has it to report: beds where it
 * runs the module and has a bed, emergency services where it runs that
 * module and has declared any.
 *
 * The messages and the late actions come from `fn_workspace_health` (0052),
 * because this connection reads neither table, and must not.
 */
async function healthRows(hospitalId: string | null): Promise<HealthColumns[]> {
  const result = await sql<HealthColumns>`
    SELECT h.id, h.is_live,
           coalesce(s.stale_threshold_minutes, 10) AS stale_after,
           (fn_module_on(h.id, 'beds') AND coalesce(c.bed_total, 0) > 0) AS reports_beds,
           fn_publishes(h.id, 'beds') AS shares_beds,
           c.beds_as_of,
           (fn_module_on(h.id, 'emergency')
             AND EXISTS (SELECT 1 FROM capabilities cp WHERE cp.hospital_id = h.id))
             AS reports_capabilities,
           (SELECT min(cp.updated_at) FROM capabilities cp WHERE cp.hospital_id = h.id)
             AS capabilities_as_of,
           w.messages_sent, w.messages_failed, w.messages_held, w.messages_waiting,
           w.late_actions, w.slowest_seconds, w.last_late_at
      FROM hospitals h
      LEFT JOIN hospital_settings s ON s.hospital_id = h.id
      LEFT JOIN v_public_hospital_capacity c ON c.hospital_id = h.id
      LEFT JOIN LATERAL fn_workspace_health(h.id) w ON true
     WHERE h.deleted_at IS NULL
       AND (${hospitalId}::uuid IS NULL OR h.id = ${hospitalId}::uuid)
  `.execute(db);
  return result.rows;
}

export async function healthOf(hospitalId: string): Promise<HealthCounts | null> {
  const row = (await healthRows(hospitalId))[0];
  return row === undefined ? null : healthOfRow(row);
}

export async function healthOfAll(): Promise<Map<string, HealthCounts>> {
  return new Map((await healthRows(null)).map((row) => [row.id, healthOfRow(row)]));
}

/** One line of an organisation's trail: what was done, by whom, when. */
export interface TrailRow {
  readonly id: string;
  readonly at: string;
  /** A code of `AUDIT_CHANGES`, or one this version does not name. */
  readonly change: string;
  readonly actorName: string | null;
  /** True for a platform administrator; false for the hospital's own staff. */
  readonly byPlatform: boolean;
}

/**
 * What was done to an organisation, newest first (`FR-ONB-07`).
 *
 * Three kinds of row and no other: a settings change, an import's step, an
 * export. **Never a row about a person**: a record opened and a queue action
 * are in the same table with the patient they concern, and are left out
 * twice over, by the action and by `patient_id IS NULL`, so that a new kind
 * of row about a patient cannot arrive here by being given an action this
 * list happens to name (`FR-ONB-08`). No column of a patient is selected.
 */
export async function auditTrailOf(hospitalId: string, limit: number): Promise<TrailRow[]> {
  const result = await sql<{
    id: string;
    created_at: Date;
    change: string | null;
    actor_name: string | null;
    by_platform: boolean;
  }>`
    SELECT a.id, a.created_at,
           CASE a.action
             WHEN 'SETTINGS_CHANGE' THEN a.meta ->> 'change'
             WHEN 'IMPORT' THEN 'import_' || (a.meta ->> 'event')
             ELSE 'export'
           END AS change,
           su.full_name AS actor_name,
           (su.id IS NOT NULL AND su.hospital_id IS NULL) AS by_platform
      FROM audit_log a
      LEFT JOIN staff_users su ON su.id = a.actor_staff_id
     WHERE a.hospital_id = ${hospitalId}::uuid
       AND a.action IN ('SETTINGS_CHANGE', 'IMPORT', 'EXPORT')
       AND a.patient_id IS NULL
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    at: row.created_at.toISOString(),
    change: row.change ?? '',
    actorName: row.actor_name,
    byPlatform: row.by_platform,
  }));
}
