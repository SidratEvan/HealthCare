/**
 * A facility's own setup (`S-B-11`, pilot step 22, `FR-SUP-01`, `FR-ADM-11`).
 *
 * Rows only: what a hospital administrator may change about their own
 * facility — its profile and queue rules, departments, the doctors who sit
 * there and their weekly schedules, wards and beds, and staff accounts. Every
 * write takes the facility's id and refuses a row that belongs to another
 * (`FR-ROLE-01`); the service decides what is allowed and writes the audit
 * row in the same transaction.
 */

import { sql } from 'kysely';

import {
  BED_UNCONFIRMED_REASON,
  readBrandTheme,
  type BrandTheme,
  type OrgLifecycle,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

// --- the snapshot S-B-11 draws -----------------------------------------------

export interface SetupSnapshot {
  readonly hospital: {
    readonly id: string;
    readonly code: string | null;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly kind: string;
    readonly division: string;
    readonly district: string;
    /** The licence or registration number, as the hospital gave it; null for none. */
    readonly registrationNo: string | null;
    readonly thana: string | null;
    readonly addressBn: string | null;
    readonly addressEn: string | null;
    readonly phone: string | null;
    readonly emergencyPhone: string | null;
    /** What the hospital says of itself to patients (`FR-BRD-06`). */
    readonly descriptionBn: string | null;
    readonly descriptionEn: string | null;
    /** A domain of its own, recorded by the platform (`FR-BRD-07`); null for none. */
    readonly portalDomain: string | null;
    /** The modules it does not run (`FR-BRD-11`); empty when everything is on. */
    readonly modulesOff: readonly string[];
    /** The live figures it does not share (`FR-NET-04`); empty when it shares them all. */
    readonly unpublished: readonly string[];
    readonly lat: number | null;
    readonly lng: number | null;
    readonly isLive: boolean;
    readonly onboardedAt: string | null;
    /** The workspace's state (0037, `FR-ONB-02`). */
    readonly lifecycle: OrgLifecycle;
    readonly reviewRequestedAt: string | null;
    /** Why the platform sent it back or suspended it, for the administrator to read. */
    readonly reviewNote: string | null;
  };
  readonly rules: {
    readonly noShowGracePatients: number;
    readonly noShowGraceMinutes: number;
    readonly lateReinsertAfter: number;
    readonly staleThresholdMinutes: number;
    readonly smsBudgetMonthly: number | null;
    /** How long a serial waits for its online payment (0057, `FR-PAY-08`). */
    readonly paymentHoldMinutes: number;
    /** No serial is paid at the counter (`FR-PAY-02`). */
    readonly prepayRequired: boolean;
    /** Three no-shows here in the window ask for payment first (0058, `FR-GST-14`). */
    readonly noShowPrepay: boolean;
    readonly noShowWindowDays: number;
    /** A preferred arrival hour offered at booking (0060, `FR-PAT-28`). */
    readonly arrivalWindows: boolean;
  };
  /** Its public face beyond words (`FR-BRD-06`): colours and a logo. */
  readonly face: {
    /** Null: the platform's own colours. */
    readonly theme: BrandTheme | null;
    readonly logo: {
      readonly version: string;
      readonly contentType: string;
      readonly bytes: number;
    } | null;
  };
  readonly departments: readonly {
    readonly id: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly code: string;
    readonly sortOrder: number;
  }[];
  readonly doctors: readonly {
    readonly doctorHospitalId: string;
    readonly doctorId: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly bmdcNumber: string;
    readonly verified: boolean;
    readonly degrees: string | null;
    readonly specialties: readonly string[];
    readonly defaultConsultMinutes: number;
    readonly departmentId: string;
    readonly room: string | null;
    readonly feePoisha: number;
    readonly isActive: boolean;
  }[];
  readonly templates: readonly {
    readonly id: string;
    readonly doctorHospitalId: string;
    readonly weekday: number;
    readonly startTime: string;
    readonly endTime: string;
    readonly capacity: number | null;
  }[];
  readonly wards: readonly {
    readonly id: string;
    readonly nameBn: string;
    readonly nameEn: string;
    readonly floor: number;
    readonly kind: string;
    readonly beds: readonly {
      readonly id: string;
      readonly label: string;
      readonly kind: string;
      readonly state: string;
      readonly nightlyPoisha: number;
      /**
       * Added in settings and never brought into service by the ward. Only
       * such a bed can be removed here (plan D2): nobody has lain in it.
       */
      readonly unconfirmed: boolean;
    }[];
  }[];
  readonly staff: readonly {
    readonly id: string;
    readonly fullName: string;
    readonly email: string;
    readonly staffCode: string | null;
    readonly isActive: boolean;
    readonly mustChangePassword: boolean;
    /** The second factor is on (pilot step 28, 0033). */
    readonly twoFactorEnabled: boolean;
    readonly lastLoginAt: string | null;
    readonly roles: readonly string[];
  }[];
  /** What the facility offers in an emergency, and when each was last confirmed. */
  readonly capabilities: readonly {
    readonly kind: string;
    readonly isAvailable: boolean;
    readonly updatedAt: string;
  }[];
  /** When this answer was read, for the screen's freshness line. */
  readonly serverTs: string;
}

export async function snapshot(hospitalId: string): Promise<SetupSnapshot | null> {
  const hospital = await sql<{
    id: string;
    code: string | null;
    name_bn: string;
    name_en: string;
    kind: string;
    division: string;
    district: string;
    registration_no: string | null;
    thana: string | null;
    address_bn: string | null;
    address_en: string | null;
    phone: string | null;
    emergency_phone: string | null;
    description_bn: string | null;
    description_en: string | null;
    portal_domain: string | null;
    modules_off: string[] | null;
    unpublished: string[] | null;
    brand: unknown;
    logo_sha256: string | null;
    logo_type: string | null;
    logo_bytes: number | null;
    lat: number | null;
    lng: number | null;
    is_live: boolean;
    onboarded_at: Date | null;
    lifecycle: OrgLifecycle;
    review_requested_at: Date | null;
    review_note: string | null;
    no_show_grace_patients: number | null;
    no_show_grace_minutes: number | null;
    late_reinsert_after: number | null;
    stale_threshold_minutes: number | null;
    payment_hold_minutes: number | null;
    prepay_required: boolean | null;
    noshow_prepay: boolean | null;
    noshow_window_days: number | null;
    arrival_windows: boolean | null;
    sms_budget_monthly: number | null;
  }>`
    SELECT h.id, h.code, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
           h.registration_no,
           h.thana, h.address_bn, h.address_en, h.phone, h.emergency_phone,
           h.description_bn, h.description_en, h.portal_domain, s.modules_off, s.unpublished,
           s.brand,
           l.sha256 AS logo_sha256, l.content_type AS logo_type,
           octet_length(l.bytes) AS logo_bytes,
           h.lat::float8 AS lat, h.lng::float8 AS lng, h.is_live, h.onboarded_at,
           h.lifecycle::text AS lifecycle, h.review_requested_at, h.review_note,
           s.no_show_grace_patients, s.no_show_grace_minutes, s.late_reinsert_after,
           s.stale_threshold_minutes, s.sms_budget_monthly, s.payment_hold_minutes,
           s.prepay_required, s.noshow_prepay, s.noshow_window_days, s.arrival_windows
      FROM hospitals h
      LEFT JOIN hospital_settings s ON s.hospital_id = h.id
      LEFT JOIN hospital_logos l ON l.hospital_id = h.id
     WHERE h.id = ${hospitalId} AND h.deleted_at IS NULL
  `.execute(db);
  const row = hospital.rows[0];
  if (row === undefined) return null;

  const departments = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    code: string;
    sort_order: number;
  }>`
    SELECT id, name_bn, name_en, code, sort_order
      FROM departments
     WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL
     ORDER BY sort_order, name_en
  `.execute(db);

  const doctors = await sql<{
    doctor_hospital_id: string;
    doctor_id: string;
    full_name_bn: string;
    full_name_en: string;
    bmdc_number: string;
    bmdc_verified_at: Date | null;
    degrees: string | null;
    specialties: string[];
    default_consult_minutes: number;
    department_id: string;
    room: string | null;
    fee_poisha: number;
    is_active: boolean;
  }>`
    SELECT dh.id AS doctor_hospital_id, d.id AS doctor_id, d.full_name_bn, d.full_name_en,
           d.bmdc_number, d.bmdc_verified_at, d.degrees, d.specialties, d.default_consult_minutes,
           dh.department_id, dh.room, dh.fee_poisha, dh.is_active
      FROM doctor_hospitals dh
      JOIN doctors d ON d.id = dh.doctor_id
     WHERE dh.hospital_id = ${hospitalId} AND dh.deleted_at IS NULL AND d.deleted_at IS NULL
     ORDER BY d.full_name_en
  `.execute(db);

  const templates = await sql<{
    id: string;
    doctor_hospital_id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    capacity: number | null;
  }>`
    SELECT t.id, t.doctor_hospital_id, t.weekday, to_char(t.start_time, 'HH24:MI') AS start_time,
           to_char(t.end_time, 'HH24:MI') AS end_time, t.capacity
      FROM session_templates t
      JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
     WHERE dh.hospital_id = ${hospitalId} AND t.deleted_at IS NULL
       AND (t.active_to IS NULL OR t.active_to >= (now() AT TIME ZONE 'Asia/Dhaka')::date)
     ORDER BY t.weekday, t.start_time
  `.execute(db);

  const wards = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    floor: number;
    kind: string;
  }>`
    SELECT id, name_bn, name_en, floor, kind::text AS kind
      FROM wards
     WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL
     ORDER BY floor, name_en
  `.execute(db);
  const beds = await sql<{
    id: string;
    ward_id: string;
    label: string;
    kind: string;
    state: string;
    nightly_poisha: number;
    unconfirmed: boolean;
  }>`
    SELECT id, ward_id, label, kind::text AS kind, state::text AS state, nightly_poisha,
           (state = 'out_of_service' AND oos_reason = ${BED_UNCONFIRMED_REASON}) AS unconfirmed
      FROM beds
     WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL
     ORDER BY label
  `.execute(db);

  const staff = await sql<{
    id: string;
    full_name: string;
    email: string;
    staff_code: string | null;
    is_active: boolean;
    must_change_password: boolean;
    two_factor_enabled: boolean;
    last_login_at: Date | null;
    roles: string[] | null;
  }>`
    SELECT su.id, su.full_name, su.email, su.staff_code, su.is_active, su.must_change_password,
           su.totp_enabled_at IS NOT NULL AS two_factor_enabled, su.last_login_at,
           array_agg(sr.role::text ORDER BY sr.role) FILTER (WHERE sr.id IS NOT NULL) AS roles
      FROM staff_users su
      LEFT JOIN staff_roles sr
        ON sr.staff_user_id = su.id AND sr.hospital_id = su.hospital_id AND sr.deleted_at IS NULL
     WHERE su.hospital_id = ${hospitalId} AND su.deleted_at IS NULL
     GROUP BY su.id
     ORDER BY su.full_name
  `.execute(db);

  return {
    hospital: {
      id: row.id,
      code: row.code,
      nameBn: row.name_bn,
      nameEn: row.name_en,
      kind: row.kind,
      division: row.division,
      district: row.district,
      registrationNo: row.registration_no,
      thana: row.thana,
      addressBn: row.address_bn,
      addressEn: row.address_en,
      phone: row.phone,
      emergencyPhone: row.emergency_phone,
      descriptionBn: row.description_bn,
      descriptionEn: row.description_en,
      portalDomain: row.portal_domain,
      modulesOff: row.modules_off ?? [],
      unpublished: row.unpublished ?? [],
      lat: row.lat,
      lng: row.lng,
      isLive: row.is_live,
      onboardedAt: row.onboarded_at?.toISOString() ?? null,
      lifecycle: row.lifecycle,
      reviewRequestedAt: row.review_requested_at?.toISOString() ?? null,
      reviewNote: row.review_note,
    },
    rules: {
      noShowGracePatients: row.no_show_grace_patients ?? 2,
      noShowGraceMinutes: row.no_show_grace_minutes ?? 15,
      lateReinsertAfter: row.late_reinsert_after ?? 3,
      staleThresholdMinutes: row.stale_threshold_minutes ?? 10,
      smsBudgetMonthly: row.sms_budget_monthly,
      paymentHoldMinutes: row.payment_hold_minutes ?? 15,
      prepayRequired: row.prepay_required ?? false,
      noShowPrepay: row.noshow_prepay ?? false,
      noShowWindowDays: row.noshow_window_days ?? 90,
      arrivalWindows: row.arrival_windows ?? false,
    },
    face: {
      theme: readBrandTheme(row.brand),
      logo:
        row.logo_sha256 === null || row.logo_type === null || row.logo_bytes === null
          ? null
          : {
              version: row.logo_sha256.slice(0, 16),
              contentType: row.logo_type,
              bytes: row.logo_bytes,
            },
    },
    departments: departments.rows.map((d) => ({
      id: d.id,
      nameBn: d.name_bn,
      nameEn: d.name_en,
      code: d.code,
      sortOrder: d.sort_order,
    })),
    doctors: doctors.rows.map((d) => ({
      doctorHospitalId: d.doctor_hospital_id,
      doctorId: d.doctor_id,
      nameBn: d.full_name_bn,
      nameEn: d.full_name_en,
      bmdcNumber: d.bmdc_number,
      verified: d.bmdc_verified_at !== null,
      degrees: d.degrees,
      specialties: d.specialties,
      defaultConsultMinutes: d.default_consult_minutes,
      departmentId: d.department_id,
      room: d.room,
      feePoisha: d.fee_poisha,
      isActive: d.is_active,
    })),
    templates: templates.rows.map((t) => ({
      id: t.id,
      doctorHospitalId: t.doctor_hospital_id,
      weekday: t.weekday,
      startTime: t.start_time,
      endTime: t.end_time,
      capacity: t.capacity,
    })),
    wards: wards.rows.map((w) => ({
      id: w.id,
      nameBn: w.name_bn,
      nameEn: w.name_en,
      floor: w.floor,
      kind: w.kind,
      beds: beds.rows
        .filter((b) => b.ward_id === w.id)
        .map((b) => ({
          id: b.id,
          label: b.label,
          kind: b.kind,
          state: b.state,
          nightlyPoisha: b.nightly_poisha,
          unconfirmed: b.unconfirmed,
        })),
    })),
    staff: staff.rows.map((s) => ({
      id: s.id,
      fullName: s.full_name,
      email: s.email,
      staffCode: s.staff_code,
      isActive: s.is_active,
      mustChangePassword: s.must_change_password,
      twoFactorEnabled: s.two_factor_enabled,
      lastLoginAt: s.last_login_at?.toISOString() ?? null,
      roles: s.roles ?? [],
    })),
    capabilities: await capabilitiesOf(hospitalId),
    serverTs: new Date().toISOString(),
  };
}

// --- profile and rules -------------------------------------------------------

export interface ProfileFields {
  readonly nameBn?: string | undefined;
  readonly nameEn?: string | undefined;
  /** What it was registered as; the service allows these only while setting up. */
  readonly division?: string | undefined;
  readonly district?: string | undefined;
  readonly registrationNo?: string | null | undefined;
  readonly thana?: string | null | undefined;
  readonly addressBn?: string | null | undefined;
  readonly addressEn?: string | null | undefined;
  readonly phone?: string | null | undefined;
  readonly emergencyPhone?: string | null | undefined;
  readonly descriptionBn?: string | null | undefined;
  readonly descriptionEn?: string | null | undefined;
  readonly lat?: number | null | undefined;
  readonly lng?: number | null | undefined;
}

/** Only the fields given change; an absent field keeps its value. */
export async function updateProfile(
  trx: Tx,
  hospitalId: string,
  fields: ProfileFields,
): Promise<void> {
  const has = (key: keyof ProfileFields): boolean => fields[key] !== undefined;
  await sql`
    UPDATE hospitals SET
      name_bn = CASE WHEN ${has('nameBn')} THEN ${fields.nameBn ?? null} ELSE name_bn END,
      name_en = CASE WHEN ${has('nameEn')} THEN ${fields.nameEn ?? null} ELSE name_en END,
      division = CASE WHEN ${has('division')} THEN ${fields.division ?? null} ELSE division END,
      district = CASE WHEN ${has('district')} THEN ${fields.district ?? null} ELSE district END,
      registration_no = CASE WHEN ${has('registrationNo')} THEN ${fields.registrationNo ?? null} ELSE registration_no END,
      thana = CASE WHEN ${has('thana')} THEN ${fields.thana ?? null} ELSE thana END,
      address_bn = CASE WHEN ${has('addressBn')} THEN ${fields.addressBn ?? null} ELSE address_bn END,
      address_en = CASE WHEN ${has('addressEn')} THEN ${fields.addressEn ?? null} ELSE address_en END,
      phone = CASE WHEN ${has('phone')} THEN ${fields.phone ?? null} ELSE phone END,
      emergency_phone = CASE WHEN ${has('emergencyPhone')} THEN ${fields.emergencyPhone ?? null} ELSE emergency_phone END,
      description_bn = CASE WHEN ${has('descriptionBn')} THEN ${fields.descriptionBn ?? null} ELSE description_bn END,
      description_en = CASE WHEN ${has('descriptionEn')} THEN ${fields.descriptionEn ?? null} ELSE description_en END,
      lat = CASE WHEN ${has('lat')} THEN ${fields.lat ?? null}::float8 ELSE lat END,
      lng = CASE WHEN ${has('lng')} THEN ${fields.lng ?? null}::float8 ELSE lng END,
      updated_at = now()
    WHERE id = ${hospitalId}
  `.execute(trx);
}

// --- the modules it runs (FR-BRD-11, migration 0047) ----------------------------

/** The modules a hospital has switched off; empty when it has no settings row. */
export async function modulesOff(hospitalId: string): Promise<string[]> {
  const result = await sql<{ modules_off: string[] }>`
    SELECT modules_off FROM hospital_settings WHERE hospital_id = ${hospitalId}
  `.execute(db);
  return result.rows[0]?.modules_off ?? [];
}

export async function setModulesOff(
  trx: Tx,
  hospitalId: string,
  off: readonly string[],
): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${hospitalId})
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(trx);
  await sql`
    UPDATE hospital_settings SET modules_off = ${[...off]}::text[], updated_at = now()
     WHERE hospital_id = ${hospitalId}
  `.execute(trx);
}

// --- the figures it shares (FR-NET-04, migration 0048) ---------------------------

export async function setUnpublished(
  trx: Tx,
  hospitalId: string,
  unpublished: readonly string[],
): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${hospitalId})
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(trx);
  await sql`
    UPDATE hospital_settings SET unpublished = ${[...unpublished]}::text[], updated_at = now()
     WHERE hospital_id = ${hospitalId}
  `.execute(trx);
}

// --- its public face: colours and a logo (FR-BRD-06) ---------------------------

/** The hospital's colours, or null for the platform's own. */
export async function setBrand(
  trx: Tx,
  hospitalId: string,
  theme: BrandTheme | null,
): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${hospitalId})
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(trx);
  await sql`
    UPDATE hospital_settings
       SET brand = ${theme === null ? null : JSON.stringify(theme)}::jsonb, updated_at = now()
     WHERE hospital_id = ${hospitalId}
  `.execute(trx);
}

export async function setLogo(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly contentType: string;
    readonly bytes: Buffer;
    readonly sha256: string;
    readonly staffId: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO hospital_logos (hospital_id, content_type, bytes, sha256, created_by)
    VALUES (${input.hospitalId}, ${input.contentType}, ${input.bytes}, ${input.sha256},
            ${input.staffId})
    ON CONFLICT (hospital_id) DO UPDATE
       SET content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes,
           sha256 = EXCLUDED.sha256, created_by = EXCLUDED.created_by
  `.execute(trx);
}

/** True when there was one to remove. */
export async function removeLogo(trx: Tx, hospitalId: string): Promise<boolean> {
  const result = await sql`
    DELETE FROM hospital_logos WHERE hospital_id = ${hospitalId}
  `.execute(trx);
  return Number(result.numAffectedRows ?? 0) > 0;
}

/**
 * The hospital's own logo, live or not: the settings screen shows it before
 * the hospital is in the network, when the public address does not answer.
 */
export async function ownLogo(
  hospitalId: string,
): Promise<{ contentType: string; bytes: Buffer } | null> {
  const result = await sql<{ content_type: string; bytes: Buffer }>`
    SELECT content_type, bytes FROM hospital_logos WHERE hospital_id = ${hospitalId}
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : { contentType: row.content_type, bytes: row.bytes };
}

export interface RuleFields {
  readonly noShowGracePatients?: number | undefined;
  readonly noShowGraceMinutes?: number | undefined;
  readonly lateReinsertAfter?: number | undefined;
  readonly staleThresholdMinutes?: number | undefined;
  readonly smsBudgetMonthly?: number | null | undefined;
  readonly paymentHoldMinutes?: number | undefined;
  readonly prepayRequired?: boolean | undefined;
  readonly noShowPrepay?: boolean | undefined;
  readonly noShowWindowDays?: number | undefined;
  readonly arrivalWindows?: boolean | undefined;
}

export async function updateRules(trx: Tx, hospitalId: string, fields: RuleFields): Promise<void> {
  await sql`
    INSERT INTO hospital_settings (hospital_id) VALUES (${hospitalId})
    ON CONFLICT (hospital_id) DO NOTHING
  `.execute(trx);
  await sql`
    UPDATE hospital_settings SET
      no_show_grace_patients = coalesce(${fields.noShowGracePatients ?? null}::int, no_show_grace_patients),
      no_show_grace_minutes = coalesce(${fields.noShowGraceMinutes ?? null}::int, no_show_grace_minutes),
      late_reinsert_after = coalesce(${fields.lateReinsertAfter ?? null}::int, late_reinsert_after),
      stale_threshold_minutes = coalesce(${fields.staleThresholdMinutes ?? null}::int, stale_threshold_minutes),
      payment_hold_minutes = coalesce(${fields.paymentHoldMinutes ?? null}::int, payment_hold_minutes),
      prepay_required = coalesce(${fields.prepayRequired ?? null}::boolean, prepay_required),
      noshow_prepay = coalesce(${fields.noShowPrepay ?? null}::boolean, noshow_prepay),
      noshow_window_days = coalesce(${fields.noShowWindowDays ?? null}::int, noshow_window_days),
      arrival_windows = coalesce(${fields.arrivalWindows ?? null}::boolean, arrival_windows),
      sms_budget_monthly = CASE WHEN ${fields.smsBudgetMonthly !== undefined}
                                THEN ${fields.smsBudgetMonthly ?? null}::int ELSE sms_budget_monthly END,
      updated_at = now()
    WHERE hospital_id = ${hospitalId}
  `.execute(trx);
}

// --- departments -------------------------------------------------------------

export async function departmentCodeTaken(hospitalId: string, code: string): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM departments
     WHERE hospital_id = ${hospitalId} AND code = ${code} AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}

export async function createDepartment(
  trx: Tx,
  input: {
    hospitalId: string;
    nameBn: string;
    nameEn: string;
    code: string;
    sortOrder: number;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO departments (hospital_id, name_bn, name_en, code, sort_order, created_by)
    VALUES (${input.hospitalId}, ${input.nameBn}, ${input.nameEn}, ${input.code}, ${input.sortOrder}, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('departments returned no id');
  return id;
}

/** Returns false when the department is not this facility's. */
export async function updateDepartment(
  trx: Tx,
  hospitalId: string,
  departmentId: string,
  fields: {
    nameBn?: string | undefined;
    nameEn?: string | undefined;
    sortOrder?: number | undefined;
  },
): Promise<boolean> {
  const result = await sql`
    UPDATE departments SET
      name_bn = coalesce(${fields.nameBn ?? null}, name_bn),
      name_en = coalesce(${fields.nameEn ?? null}, name_en),
      sort_order = coalesce(${fields.sortOrder ?? null}::int, sort_order),
      updated_at = now()
    WHERE id = ${departmentId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return Number(result.numAffectedRows ?? 0) === 1;
}

/**
 * Takes a department away, if nobody sits in it (plan D2).
 *
 * `removed` is false, with `inUse` saying which it was: not this facility's,
 * or one a doctor is still listed under. Checked and done in one statement,
 * so a doctor added between the look and the removal keeps the department.
 * The row stays, marked: its code is free for the department that was meant.
 */
export async function removeDepartment(
  trx: Tx,
  hospitalId: string,
  departmentId: string,
): Promise<{ removed: boolean; inUse: boolean }> {
  const result = await sql<{ id: string }>`
    UPDATE departments dep SET deleted_at = now(), updated_at = now()
     WHERE dep.id = ${departmentId} AND dep.hospital_id = ${hospitalId} AND dep.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM doctor_hospitals dh
                        WHERE dh.department_id = dep.id AND dh.deleted_at IS NULL)
    RETURNING dep.id
  `.execute(trx);
  if (result.rows.length === 1) return { removed: true, inUse: false };
  const there = await sql<{ one: number }>`
    SELECT 1 AS one FROM departments
     WHERE id = ${departmentId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return { removed: false, inUse: there.rows.length > 0 };
}

export async function departmentBelongs(
  hospitalId: string,
  departmentId: string,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM departments WHERE id = ${departmentId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}

// --- doctors -----------------------------------------------------------------

export async function doctorByBmdc(
  bmdcNumber: string,
): Promise<{ id: string; verified: boolean } | null> {
  const result = await sql<{ id: string; bmdc_verified_at: Date | null }>`
    SELECT id, bmdc_verified_at FROM doctors WHERE upper(bmdc_number) = upper(${bmdcNumber}) AND deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, verified: row.bmdc_verified_at !== null };
}

export async function createDoctor(
  trx: Tx,
  input: {
    nameBn: string;
    nameEn: string;
    bmdcNumber: string;
    degrees: string | null;
    specialties: readonly string[];
    defaultConsultMinutes: number;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO doctors (full_name_bn, full_name_en, bmdc_number, degrees, specialties,
                         default_consult_minutes, created_by)
    VALUES (${input.nameBn}, ${input.nameEn}, ${input.bmdcNumber.toUpperCase()}, ${input.degrees},
            ${[...input.specialties]}::text[], ${input.defaultConsultMinutes}, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('doctors returned no id');
  return id;
}

export async function doctorAlreadyHere(
  hospitalId: string,
  doctorId: string,
  departmentId: string,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM doctor_hospitals
     WHERE hospital_id = ${hospitalId} AND doctor_id = ${doctorId}
       AND department_id = ${departmentId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}

export async function linkDoctor(
  trx: Tx,
  input: {
    doctorId: string;
    hospitalId: string;
    departmentId: string;
    feePoisha: number;
    room: string | null;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO doctor_hospitals (doctor_id, hospital_id, department_id, fee_poisha, room, created_by)
    VALUES (${input.doctorId}, ${input.hospitalId}, ${input.departmentId}, ${input.feePoisha},
            ${input.room}, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('doctor_hospitals returned no id');
  return id;
}

export interface ChamberOfDoctor {
  readonly doctorHospitalId: string;
  readonly doctorId: string;
  readonly departmentId: string;
  readonly verified: boolean;
}

export async function chamberOfDoctor(
  hospitalId: string,
  doctorHospitalId: string,
): Promise<ChamberOfDoctor | null> {
  const result = await sql<{
    id: string;
    doctor_id: string;
    department_id: string;
    bmdc_verified_at: Date | null;
  }>`
    SELECT dh.id, dh.doctor_id, dh.department_id, d.bmdc_verified_at
      FROM doctor_hospitals dh
      JOIN doctors d ON d.id = dh.doctor_id
     WHERE dh.id = ${doctorHospitalId} AND dh.hospital_id = ${hospitalId} AND dh.deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        doctorHospitalId: row.id,
        doctorId: row.doctor_id,
        departmentId: row.department_id,
        verified: row.bmdc_verified_at !== null,
      };
}

export async function updateDoctorHospital(
  trx: Tx,
  doctorHospitalId: string,
  fields: {
    feePoisha?: number | undefined;
    room?: string | null | undefined;
    isActive?: boolean | undefined;
  },
): Promise<void> {
  const roomGiven = fields.room !== undefined;
  await sql`
    UPDATE doctor_hospitals SET
      fee_poisha = coalesce(${fields.feePoisha ?? null}::int, fee_poisha),
      room = CASE WHEN ${roomGiven} THEN ${fields.room ?? null} ELSE room END,
      is_active = coalesce(${fields.isActive ?? null}::boolean, is_active),
      updated_at = now()
    WHERE id = ${doctorHospitalId}
  `.execute(trx);
}

/** Identity fields, only while the BMDC number is unverified (the service checks). */
export async function updateDoctorIdentity(
  trx: Tx,
  doctorId: string,
  fields: {
    nameBn?: string | undefined;
    nameEn?: string | undefined;
    degrees?: string | null | undefined;
    defaultConsultMinutes?: number | undefined;
  },
): Promise<void> {
  const degreesGiven = fields.degrees !== undefined;
  await sql`
    UPDATE doctors SET
      full_name_bn = coalesce(${fields.nameBn ?? null}, full_name_bn),
      full_name_en = coalesce(${fields.nameEn ?? null}, full_name_en),
      degrees = CASE WHEN ${degreesGiven} THEN ${fields.degrees ?? null} ELSE degrees END,
      default_consult_minutes = coalesce(${fields.defaultConsultMinutes ?? null}::int, default_consult_minutes),
      updated_at = now()
    WHERE id = ${doctorId}
  `.execute(trx);
}

/**
 * A fee or room change reaches the doctor's chambers from today that are
 * still scheduled. A booking already made keeps the fee it was made at — its
 * own `bookings.fee_poisha` — so nobody's price changes after they booked.
 */
export async function carryToScheduledSessions(
  trx: Tx,
  input: {
    hospitalId: string;
    doctorId: string;
    departmentId: string;
    feePoisha?: number | undefined;
    room?: string | null | undefined;
  },
): Promise<void> {
  const roomGiven = input.room !== undefined;
  await sql`
    UPDATE sessions SET
      fee_poisha = coalesce(${input.feePoisha ?? null}::int, fee_poisha),
      room = CASE WHEN ${roomGiven} THEN ${input.room ?? null} ELSE room END,
      updated_at = now()
    WHERE hospital_id = ${input.hospitalId} AND doctor_id = ${input.doctorId}
      AND department_id = ${input.departmentId} AND status = 'scheduled' AND deleted_at IS NULL
      AND session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
  `.execute(trx);
}

// --- weekly schedules --------------------------------------------------------

export async function createTemplate(
  trx: Tx,
  input: {
    doctorHospitalId: string;
    weekday: number;
    startTime: string;
    endTime: string;
    capacity: number | null;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO session_templates (doctor_hospital_id, weekday, start_time, end_time, capacity,
                                   active_from, created_by)
    VALUES (${input.doctorHospitalId}, ${input.weekday}, ${input.startTime}::time, ${input.endTime}::time,
            ${input.capacity}, (now() AT TIME ZONE 'Asia/Dhaka')::date, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('session_templates returned no id');
  return id;
}

/** True when the schedule overlaps another of the same doctor's on that weekday. */
export async function templateOverlaps(input: {
  doctorId: string;
  weekday: number;
  startTime: string;
  endTime: string;
}): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one
      FROM session_templates t
      JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
     WHERE dh.doctor_id = ${input.doctorId} AND t.weekday = ${input.weekday} AND t.deleted_at IS NULL
       AND (t.active_to IS NULL OR t.active_to >= (now() AT TIME ZONE 'Asia/Dhaka')::date)
       AND t.start_time < ${input.endTime}::time AND t.end_time > ${input.startTime}::time
  `.execute(db);
  return result.rows.length > 0;
}

export async function templateOf(
  hospitalId: string,
  templateId: string,
): Promise<{ id: string } | null> {
  const result = await sql<{ id: string }>`
    SELECT t.id FROM session_templates t
      JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
     WHERE t.id = ${templateId} AND dh.hospital_id = ${hospitalId} AND t.deleted_at IS NULL
  `.execute(db);
  return result.rows[0] ?? null;
}

/**
 * Ends a schedule. Its chambers from today that nobody has booked go with it;
 * one somebody booked stays, for the counter to run or cancel. Returns how
 * many stayed.
 */
export async function endTemplate(trx: Tx, templateId: string): Promise<number> {
  await sql`UPDATE session_templates SET deleted_at = now(), updated_at = now() WHERE id = ${templateId}`.execute(
    trx,
  );
  await sql`
    UPDATE sessions s SET deleted_at = now(), updated_at = now()
     WHERE s.template_id = ${templateId} AND s.status = 'scheduled' AND s.deleted_at IS NULL
       AND s.session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
       AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.deleted_at IS NULL)
  `.execute(trx);
  const kept = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM sessions
     WHERE template_id = ${templateId} AND deleted_at IS NULL AND status = 'scheduled'
       AND session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date
  `.execute(trx);
  return Number(kept.rows[0]?.n ?? '0');
}

// --- wards and beds ----------------------------------------------------------

export async function createWard(
  trx: Tx,
  input: {
    hospitalId: string;
    nameBn: string;
    nameEn: string;
    floor: number;
    kind: string;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind, created_by)
    VALUES (${input.hospitalId}, ${input.nameBn}, ${input.nameEn}, ${input.floor}, ${input.kind}::bed_kind,
            ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('wards returned no id');
  return id;
}

export async function wardOf(hospitalId: string, wardId: string): Promise<{ kind: string } | null> {
  const result = await sql<{ kind: string }>`
    SELECT kind::text AS kind FROM wards WHERE id = ${wardId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0] ?? null;
}

/** Whether another of this facility's wards already has this English name (`wards` is unique on it). */
export async function wardNameTaken(
  hospitalId: string,
  nameEn: string,
  exceptWardId: string,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM wards
     WHERE hospital_id = ${hospitalId} AND name_en = ${nameEn} AND deleted_at IS NULL
       AND id <> ${exceptWardId}
  `.execute(db);
  return result.rows.length > 0;
}

/** A ward's names and floor. Returns false when the ward is not this facility's. */
export async function updateWard(
  trx: Tx,
  hospitalId: string,
  wardId: string,
  fields: { nameBn?: string | undefined; nameEn?: string | undefined; floor?: number | undefined },
): Promise<boolean> {
  const result = await sql`
    UPDATE wards SET
      name_bn = coalesce(${fields.nameBn ?? null}, name_bn),
      name_en = coalesce(${fields.nameEn ?? null}, name_en),
      floor = coalesce(${fields.floor ?? null}::int, floor),
      updated_at = now()
    WHERE id = ${wardId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return Number(result.numAffectedRows ?? 0) === 1;
}

/**
 * Takes a ward away, if it holds no bed (plan D2). As `removeDepartment`:
 * one statement, and `inUse` tells a ward with beds from one that is not here.
 */
export async function removeWard(
  trx: Tx,
  hospitalId: string,
  wardId: string,
): Promise<{ removed: boolean; inUse: boolean }> {
  const result = await sql<{ id: string }>`
    UPDATE wards w SET deleted_at = now(), updated_at = now()
     WHERE w.id = ${wardId} AND w.hospital_id = ${hospitalId} AND w.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM beds b WHERE b.ward_id = w.id AND b.deleted_at IS NULL)
    RETURNING w.id
  `.execute(trx);
  if (result.rows.length === 1) return { removed: true, inUse: false };
  const there = await sql<{ one: number }>`
    SELECT 1 AS one FROM wards
     WHERE id = ${wardId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return { removed: false, inUse: there.rows.length > 0 };
}

/**
 * Takes a bed away, if the ward never brought it into service (plan D2).
 *
 * A bed added in settings starts out of service with the reason that says
 * nobody has confirmed it (`createBed`). While that is still so, nobody has
 * been admitted to it, it has been in no public count, and it has no history
 * on the board: it was a line typed by mistake, and removing it loses
 * nothing. Any other bed has a history, and is taken out of service from the
 * ward board instead, where the reason is recorded.
 */
export async function removeUnconfirmedBed(
  trx: Tx,
  hospitalId: string,
  bedId: string,
): Promise<{ removed: boolean; inUse: boolean }> {
  const result = await sql<{ id: string }>`
    UPDATE beds b SET deleted_at = now(), updated_at = now()
     WHERE b.id = ${bedId} AND b.hospital_id = ${hospitalId} AND b.deleted_at IS NULL
       AND b.state = 'out_of_service' AND b.oos_reason = ${BED_UNCONFIRMED_REASON}
       AND NOT EXISTS (SELECT 1 FROM admissions a WHERE a.bed_id = b.id)
       AND NOT EXISTS (SELECT 1 FROM bed_events e WHERE e.bed_id = b.id)
    RETURNING b.id
  `.execute(trx);
  if (result.rows.length === 1) return { removed: true, inUse: false };
  const there = await sql<{ one: number }>`
    SELECT 1 AS one FROM beds
     WHERE id = ${bedId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return { removed: false, inUse: there.rows.length > 0 };
}

export async function bedLabelTaken(
  hospitalId: string,
  label: string,
  exceptBedId: string | null,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM beds
     WHERE hospital_id = ${hospitalId} AND lower(label) = lower(${label}) AND deleted_at IS NULL
       AND (${exceptBedId}::uuid IS NULL OR id <> ${exceptBedId}::uuid)
  `.execute(db);
  return result.rows.length > 0;
}

/**
 * A bed added here has never been looked at by the ward, so it is not "free":
 * it starts out of service with the reason saying so, and the ward brings it
 * into service from the board (`BTN-B06-OOS`'s restore). A count the public
 * sees must never include a bed nobody has confirmed (§3.2, `FR-OFF-05`).
 */
export async function createBed(
  trx: Tx,
  input: {
    hospitalId: string;
    wardId: string;
    label: string;
    kind: string;
    nightlyPoisha: number;
    unconfirmedReason: string;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO beds (hospital_id, ward_id, label, kind, state, nightly_poisha, oos_reason, created_by)
    VALUES (${input.hospitalId}, ${input.wardId}, ${input.label}, ${input.kind}::bed_kind, 'out_of_service',
            ${input.nightlyPoisha}, ${input.unconfirmedReason}, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('beds returned no id');
  return id;
}

export async function updateBed(
  trx: Tx,
  hospitalId: string,
  bedId: string,
  fields: { label?: string | undefined; nightlyPoisha?: number | undefined },
): Promise<boolean> {
  const result = await sql`
    UPDATE beds SET
      label = coalesce(${fields.label ?? null}, label),
      nightly_poisha = coalesce(${fields.nightlyPoisha ?? null}::int, nightly_poisha),
      updated_at = now()
    WHERE id = ${bedId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(trx);
  return Number(result.numAffectedRows ?? 0) === 1;
}

// --- staff -------------------------------------------------------------------

export async function staffOf(
  hospitalId: string,
  staffId: string,
): Promise<{ id: string; isActive: boolean } | null> {
  const result = await sql<{ id: string; is_active: boolean }>`
    SELECT id, is_active FROM staff_users WHERE id = ${staffId} AND hospital_id = ${hospitalId} AND deleted_at IS NULL
  `.execute(db);
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, isActive: row.is_active };
}

export async function updateStaff(
  trx: Tx,
  staffId: string,
  fields: {
    fullName?: string | undefined;
    isActive?: boolean | undefined;
    staffCode?: string | null | undefined;
  },
): Promise<void> {
  const codeGiven = fields.staffCode !== undefined;
  await sql`
    UPDATE staff_users SET
      full_name = coalesce(${fields.fullName ?? null}, full_name),
      is_active = coalesce(${fields.isActive ?? null}::boolean, is_active),
      staff_code = CASE WHEN ${codeGiven} THEN ${fields.staffCode ?? null} ELSE staff_code END,
      updated_at = now()
    WHERE id = ${staffId}
  `.execute(trx);
}

/** Makes the account hold exactly `roles` at this facility; removed roles are kept, marked deleted. */
export async function setRoles(
  trx: Tx,
  input: { staffId: string; hospitalId: string; roles: readonly string[]; by: string },
): Promise<void> {
  await sql`
    UPDATE staff_roles SET deleted_at = now(), updated_at = now()
     WHERE staff_user_id = ${input.staffId} AND hospital_id = ${input.hospitalId} AND deleted_at IS NULL
       AND NOT (role::text = ANY(${[...input.roles]}::text[]))
  `.execute(trx);
  for (const role of input.roles) {
    await sql`
      INSERT INTO staff_roles (staff_user_id, hospital_id, role, created_by)
      VALUES (${input.staffId}, ${input.hospitalId}, ${role}::staff_role, ${input.by})
      ON CONFLICT DO NOTHING
    `.execute(trx);
  }
}

export async function activeAdministrators(hospitalId: string): Promise<string[]> {
  const result = await sql<{ id: string }>`
    SELECT DISTINCT su.id FROM staff_users su
      JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.deleted_at IS NULL AND sr.role = 'hospital_admin'
     WHERE su.hospital_id = ${hospitalId} AND su.is_active AND su.deleted_at IS NULL
  `.execute(db);
  return result.rows.map((row) => row.id);
}

// --- going live and the record of changes -------------------------------------

/** One `SETTINGS_CHANGE` row per change: who, which facility, what, which row. */
export async function recordChange(
  trx: Tx,
  input: {
    actorStaffId: string;
    hospitalId: string;
    subjectTable: string;
    subjectId: string | null;
    change: string;
    ip: string | null;
    userAgent: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
    VALUES (${input.actorStaffId}, ${input.hospitalId}, 'SETTINGS_CHANGE', ${input.subjectTable},
            ${input.subjectId}, ${input.ip}::inet, ${input.userAgent}, ${JSON.stringify({ change: input.change })}::jsonb)
  `.execute(trx);
}

export async function staffCodeTaken(
  hospitalId: string,
  staffCode: string,
  exceptStaffId: string | null,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM staff_users
     WHERE hospital_id = ${hospitalId} AND staff_code = ${staffCode} AND deleted_at IS NULL
       AND (${exceptStaffId}::uuid IS NULL OR id <> ${exceptStaffId}::uuid)
  `.execute(db);
  return result.rows.length > 0;
}

/** True when the doctor also sits at another facility, whose record a rename would change. */
export async function doctorSitsElsewhere(doctorId: string, hospitalId: string): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM doctor_hospitals
     WHERE doctor_id = ${doctorId} AND hospital_id <> ${hospitalId} AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}

/**
 * `FR-SUP-02`: marks a BMDC registration checked. Platform staff do this
 * after checking the register, never a facility for its own doctor. Returns
 * the doctor's English name, or null when no doctor has that number.
 */
export async function markDoctorVerified(bmdcNumber: string): Promise<string | null> {
  const result = await sql<{ full_name_en: string }>`
    UPDATE doctors SET bmdc_verified_at = coalesce(bmdc_verified_at, now()), updated_at = now()
     WHERE upper(bmdc_number) = upper(${bmdcNumber}) AND deleted_at IS NULL
    RETURNING full_name_en
  `.execute(db);
  return result.rows[0]?.full_name_en ?? null;
}

// --- capabilities the facility offers (FR-EMG-05) ------------------------------

export async function capabilitiesOf(
  hospitalId: string,
): Promise<{ kind: string; isAvailable: boolean; updatedAt: string }[]> {
  const result = await sql<{ kind: string; is_available: boolean; updated_at: Date }>`
    SELECT kind::text AS kind, is_available, updated_at FROM capabilities
     WHERE hospital_id = ${hospitalId} ORDER BY kind
  `.execute(db);
  return result.rows.map((row) => ({
    kind: row.kind,
    isAvailable: row.is_available,
    updatedAt: row.updated_at.toISOString(),
  }));
}

/**
 * Makes the facility offer exactly `kinds`. A kind newly offered starts
 * unavailable: saying "we have a burn unit" is not saying it has a bed free
 * now, and only the ER confirms that (`PUT /hospitals/:id/capabilities`). A
 * kind no longer offered is removed, so emergency search stops considering
 * it. A kind still offered keeps its state and its age.
 */
export async function declareCapabilities(
  trx: Tx,
  input: { hospitalId: string; kinds: readonly string[]; by: string },
): Promise<void> {
  await sql`
    DELETE FROM capabilities
     WHERE hospital_id = ${input.hospitalId} AND NOT (kind::text = ANY(${[...input.kinds]}::text[]))
  `.execute(trx);
  for (const kind of input.kinds) {
    await sql`
      INSERT INTO capabilities (hospital_id, kind, is_available, updated_by)
      VALUES (${input.hospitalId}, ${kind}::capability_kind, false, ${input.by})
      ON CONFLICT (hospital_id, kind) DO NOTHING
    `.execute(trx);
  }
}
