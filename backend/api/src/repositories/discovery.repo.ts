/**
 * Reads for the patient's discovery surfaces (BACKEND.md §7.2).
 *
 * Public, unauthenticated, and therefore the one place in this API where the
 * shape of a row is a privacy decision rather than a convenience. A hospital
 * list carries no staff, no patients and no bookings; a doctor carries no
 * phone number and no login. What a stranger can read is exactly what a
 * stranger is meant to read.
 *
 * `v_public_hospital_capacity` (migration 0012) is what BACKEND.md names for
 * live capacity. It does not exist yet — the schema stops at 0006 — so bed
 * figures are absent rather than invented, and every response says when it was
 * last confirmed so a client can render `<FreshnessLine>` over it
 * (`FR-OFF-03`, `FR-PAT-14`).
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

/** A facility as the public sees it. */
export interface HospitalCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: string;
  readonly division: string;
  readonly district: string;
  readonly thana: string | null;
  readonly addressBn: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  readonly phone: string | null;
  readonly emergencyPhone: string | null;
  /** Distance in kilometres when the caller gave a position, else null. */
  readonly distanceKm: number | null;
  readonly capabilities: readonly string[];
  /** When a capability row was last confirmed — drives the freshness line. */
  readonly capabilityAsOf: string | null;
  /**
   * Doctors sitting here in the specialty that was asked for, and whether any
   * of them is in a chamber right now (`S-A-07`'s card).
   *
   * Null when no specialty was named: a count of "doctors" across every
   * department answers a question nobody asked.
   */
  readonly doctorCount: number | null;
  readonly sittingNow: number;
  /** Serials still unclaimed today across this hospital's chambers. */
  readonly openSerialsToday: number;
}

export interface HospitalQuery {
  readonly district?: string | undefined;
  readonly q?: string | undefined;
  readonly lat?: number | undefined;
  readonly lng?: number | undefined;
  /**
   * A department code. `S-A-07` is "Specialty results — hospitals offering
   * it", so this is what turns the hospital list into an answer to the
   * question a patient actually has: where can I see a cardiologist.
   */
  readonly specialty?: string | undefined;
  readonly limit: number;
}

/**
 * Live facilities, nearest first when a position is given.
 *
 * Ordered by distance through PostGIS rather than by a bounding box, because
 * a patient in an emergency is choosing between hospitals minutes apart and a
 * rectangle gets that ordering wrong near its corners (DATABASE.md §6).
 */
export async function listHospitals(query: HospitalQuery): Promise<HospitalCard[]> {
  const hasPosition = query.lat !== undefined && query.lng !== undefined;

  const result = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    kind: string;
    division: string;
    district: string;
    thana: string | null;
    address_bn: string | null;
    lat: number | null;
    lng: number | null;
    phone: string | null;
    emergency_phone: string | null;
    distance_m: number | null;
    capabilities: string[] | null;
    capability_as_of: Date | null;
    doctor_count: string | null;
    sitting_now: string;
    open_serials_today: string;
  }>`
    SELECT h.id, h.name_bn, h.name_en, h.kind::text AS kind, h.division, h.district,
           h.thana, h.address_bn, h.lat, h.lng, h.phone, h.emergency_phone,
           CASE
             WHEN ${hasPosition}::boolean AND h.geo IS NOT NULL
             THEN ST_Distance(h.geo, ST_SetSRID(ST_MakePoint(${query.lng ?? 0}, ${query.lat ?? 0}), 4326)::geography)
             ELSE NULL
           END AS distance_m,
           (SELECT array_agg(c.kind::text ORDER BY c.kind)
              FROM capabilities c
             WHERE c.hospital_id = h.id AND c.is_available) AS capabilities,
           (SELECT max(c.updated_at) FROM capabilities c WHERE c.hospital_id = h.id)
             AS capability_as_of,

           -- Doctors in the named specialty, and how many are in a chamber
           -- now. Both are what a person choosing a hospital is weighing: is
           -- anybody here for my problem, and are they in today.
           CASE WHEN ${query.specialty ?? null}::text IS NULL THEN NULL ELSE (
             SELECT count(DISTINCT dh.doctor_id)::text
               FROM doctor_hospitals dh
               JOIN departments dep ON dep.id = dh.department_id
              WHERE dh.hospital_id = h.id AND dh.is_active AND dh.deleted_at IS NULL
                AND dep.code = ${query.specialty ?? null}
           ) END AS doctor_count,

           (SELECT count(*)::text FROM sessions s
             WHERE s.hospital_id = h.id AND s.status = 'running'
               AND s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
               AND s.deleted_at IS NULL) AS sitting_now,

           (SELECT coalesce(sum(GREATEST(coalesce(s.capacity, 0) - (
                     SELECT count(*) FROM bookings b
                      WHERE b.session_id = s.id AND b.status <> 'cancelled'
                        AND b.deleted_at IS NULL), 0)), 0)::text
              FROM sessions s
             WHERE s.hospital_id = h.id
               AND s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
               AND s.status IN ('scheduled', 'running')
               AND s.deleted_at IS NULL) AS open_serials_today
      FROM hospitals h
     WHERE h.deleted_at IS NULL
       AND h.is_live
       AND (${query.district ?? null}::text IS NULL OR h.district = ${query.district ?? null})
       -- S-A-07: only hospitals that actually offer the specialty.
       AND (${query.specialty ?? null}::text IS NULL
            OR EXISTS (SELECT 1
                         FROM doctor_hospitals dh
                         JOIN departments dep ON dep.id = dh.department_id
                        WHERE dh.hospital_id = h.id AND dh.is_active
                          AND dh.deleted_at IS NULL
                          AND dep.code = ${query.specialty ?? null}))
       AND (
         ${query.q ?? null}::text IS NULL
         OR h.name_en ILIKE '%' || ${query.q ?? null} || '%'
         OR h.name_bn LIKE '%' || ${query.q ?? null} || '%'
       )
     ORDER BY
       -- Nearest first when a position was given: in an emergency, minutes
       -- decide. Otherwise a chamber that is actually running beats one that
       -- is not, because "can I be seen today" is the next question after
       -- "who is near me" and the only one this list can answer.
       distance_m NULLS LAST,
       sitting_now DESC,
       h.name_en
     LIMIT ${query.limit}
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    nameBn: row.name_bn,
    nameEn: row.name_en,
    kind: row.kind,
    division: row.division,
    district: row.district,
    thana: row.thana,
    addressBn: row.address_bn,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    emergencyPhone: row.emergency_phone,
    // Metres from PostGIS, kilometres to one decimal for a person reading it.
    distanceKm: row.distance_m === null ? null : Math.round(row.distance_m / 100) / 10,
    capabilities: row.capabilities ?? [],
    capabilityAsOf: row.capability_as_of?.toISOString() ?? null,
    doctorCount: row.doctor_count === null ? null : Number(row.doctor_count),
    sittingNow: Number(row.sitting_now),
    openSerialsToday: Number(row.open_serials_today),
  }));
}

/** One doctor on `S-A-05h`'s ডাক্তার tab. */
export interface HospitalDoctorCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly degrees: string | null;
  readonly departmentCode: string;
  readonly departmentNameBn: string;
  readonly feePoisha: number;
  readonly room: string | null;
  readonly bmdcVerifiedAt: string | null;
  /** `FR-PAT-13`: in a chamber now, or the next time they sit. */
  readonly sittingNow: boolean;
  readonly nextSessionAt: string | null;
  readonly openSerials: number | null;
}

/**
 * The doctors sitting at one hospital (`S-A-05h`, the ডাক্তার tab).
 *
 * This is the screen `S-A-07` leads to, and the order of the two matters. A
 * patient picks a place they can reach before they pick a person: building
 * discovery the other way round asks somebody in Dhaka to choose between forty
 * cardiologists without knowing which of them is twenty minutes away.
 *
 * Ordered by who is in a chamber now, then by who sits next. A doctor with no
 * upcoming chamber sorts last rather than being hidden — they exist, and a
 * patient looking for them should find them.
 */
export async function doctorsAtHospital(
  hospitalId: string,
  specialty?: string,
): Promise<HospitalDoctorCard[]> {
  const result = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    degrees: string | null;
    department_code: string;
    department_name_bn: string;
    fee_poisha: number;
    room: string | null;
    bmdc_verified_at: Date | null;
    sitting_now: boolean;
    next_session_at: Date | null;
    open_serials: string | null;
  }>`
    SELECT d.id, d.full_name_bn AS name_bn, d.full_name_en AS name_en, d.degrees,
           dep.code AS department_code, dep.name_bn AS department_name_bn,
           dh.fee_poisha, dh.room, d.bmdc_verified_at,
           EXISTS (SELECT 1 FROM sessions s
                    WHERE s.doctor_id = d.id AND s.hospital_id = ${hospitalId}::uuid
                      AND s.status = 'running' AND s.deleted_at IS NULL) AS sitting_now,
           (SELECT min(s.planned_start) FROM sessions s
             WHERE s.doctor_id = d.id AND s.hospital_id = ${hospitalId}::uuid
               AND s.status IN ('scheduled', 'running')
               AND s.planned_end > now() AND s.deleted_at IS NULL) AS next_session_at,
           (SELECT GREATEST(coalesce(s.capacity, 0) - (
                     SELECT count(*) FROM bookings b
                      WHERE b.session_id = s.id AND b.status <> 'cancelled'
                        AND b.deleted_at IS NULL), 0)::text
              FROM sessions s
             WHERE s.doctor_id = d.id AND s.hospital_id = ${hospitalId}::uuid
               AND s.status IN ('scheduled', 'running')
               AND s.planned_end > now() AND s.deleted_at IS NULL
             ORDER BY s.planned_start LIMIT 1) AS open_serials
      FROM doctor_hospitals dh
      JOIN doctors d       ON d.id = dh.doctor_id
      JOIN departments dep ON dep.id = dh.department_id
     WHERE dh.hospital_id = ${hospitalId}::uuid
       AND dh.is_active AND dh.deleted_at IS NULL
       AND d.deleted_at IS NULL
       AND (${specialty ?? null}::text IS NULL OR dep.code = ${specialty ?? null})
     ORDER BY sitting_now DESC, next_session_at NULLS LAST, d.full_name_en
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    nameBn: row.name_bn,
    nameEn: row.name_en,
    degrees: row.degrees,
    departmentCode: row.department_code,
    departmentNameBn: row.department_name_bn,
    feePoisha: row.fee_poisha,
    room: row.room,
    bmdcVerifiedAt: row.bmdc_verified_at?.toISOString() ?? null,
    sittingNow: row.sitting_now,
    nextSessionAt: row.next_session_at?.toISOString() ?? null,
    openSerials: row.open_serials === null ? null : Number(row.open_serials),
  }));
}

export interface DepartmentRow {
  readonly id: string;
  readonly code: string;
  readonly nameBn: string;
  readonly nameEn: string;
}

/** Departments a facility runs, in its own display order. */
export async function listDepartments(hospitalId: string): Promise<DepartmentRow[]> {
  const result = await sql<{ id: string; code: string; name_bn: string; name_en: string }>`
    SELECT id, code, name_bn, name_en
      FROM departments
     WHERE hospital_id = ${hospitalId} AND deleted_at IS NULL
     ORDER BY sort_order, name_en
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    nameBn: row.name_bn,
    nameEn: row.name_en,
  }));
}

/** A doctor as the public sees them (`FR-PAT-12`). */
export interface DoctorCard {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly degrees: string | null;
  readonly specialties: readonly string[];
  /** Null means unverified, which means not publishable (`FR-SUP-02`). */
  readonly bmdcVerifiedAt: string | null;
  readonly consultMinutes: number;
  readonly chambers: readonly {
    readonly hospitalId: string;
    readonly hospitalNameBn: string;
    readonly hospitalNameEn: string;
    readonly departmentCode: string;
    readonly feePoisha: number;
    readonly room: string | null;
  }[];
}

export interface DoctorQuery {
  readonly specialty?: string | undefined;
  readonly hospitalId?: string | undefined;
  readonly q?: string | undefined;
  readonly limit: number;
}

/**
 * Publishable doctors and the chambers they sit in.
 *
 * `bmdc_verified_at IS NOT NULL` is not a filter that can be relaxed: an
 * unverified practitioner must never appear on a public surface (`FR-SUP-02`),
 * and a patient choosing a cardiologist is relying on that being true.
 */
export async function listDoctors(query: DoctorQuery): Promise<DoctorCard[]> {
  const result = await sql<{
    id: string;
    full_name_bn: string;
    full_name_en: string;
    degrees: string | null;
    specialties: string[];
    bmdc_verified_at: Date | null;
    default_consult_minutes: number;
    chambers: unknown;
  }>`
    SELECT d.id, d.full_name_bn, d.full_name_en, d.degrees, d.specialties,
           d.bmdc_verified_at, d.default_consult_minutes,
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object(
                       'hospitalId', h.id,
                       'hospitalNameBn', h.name_bn,
                       'hospitalNameEn', h.name_en,
                       'departmentCode', dep.code,
                       'feePoisha', dh.fee_poisha,
                       'room', dh.room
                     ) ORDER BY h.name_en)
                FROM doctor_hospitals dh
                JOIN hospitals h ON h.id = dh.hospital_id
                JOIN departments dep ON dep.id = dh.department_id
               WHERE dh.doctor_id = d.id
                 AND dh.deleted_at IS NULL AND dh.is_active
                 AND h.is_live AND h.deleted_at IS NULL),
             '[]'::jsonb
           ) AS chambers
      FROM doctors d
     WHERE d.deleted_at IS NULL
       AND d.bmdc_verified_at IS NOT NULL
       AND (${query.specialty ?? null}::text IS NULL
            OR EXISTS (SELECT 1 FROM departments dep2
                        JOIN doctor_hospitals dh2 ON dh2.department_id = dep2.id
                       WHERE dh2.doctor_id = d.id AND dep2.code = ${query.specialty ?? null}))
       AND (${query.hospitalId ?? null}::uuid IS NULL
            OR EXISTS (SELECT 1 FROM doctor_hospitals dh3
                       WHERE dh3.doctor_id = d.id
                         AND dh3.hospital_id = ${query.hospitalId ?? null}::uuid
                         AND dh3.deleted_at IS NULL AND dh3.is_active))
       AND (
         ${query.q ?? null}::text IS NULL
         OR d.full_name_en ILIKE '%' || ${query.q ?? null} || '%'
         OR d.full_name_bn LIKE '%' || ${query.q ?? null} || '%'
       )
     ORDER BY d.full_name_en
     LIMIT ${query.limit}
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    nameBn: row.full_name_bn,
    nameEn: row.full_name_en,
    degrees: row.degrees,
    specialties: row.specialties,
    bmdcVerifiedAt: row.bmdc_verified_at?.toISOString() ?? null,
    consultMinutes: row.default_consult_minutes,
    chambers: (row.chambers ?? []) as DoctorCard['chambers'],
  }));
}

/** A bookable session, with what a patient needs to choose between them. */
export interface SessionCard {
  readonly id: string;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly doctorId: string;
  readonly doctorNameBn: string;
  readonly departmentCode: string;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly status: string;
  readonly room: string | null;
  readonly feePoisha: number;
  readonly capacity: number | null;
  /** Serials already issued — `taken` against `capacity` (`S-A-07b`). */
  readonly taken: number;
}

/**
 * Sessions a patient could book, from today forward.
 *
 * Cancelled bookings do not count against capacity: the serial is freed for
 * reissue (`FR-QUE-30`), so counting them would show a session as full while
 * it had room.
 */
export async function listBookableSessions(input: {
  readonly doctorId?: string | undefined;
  readonly hospitalId?: string | undefined;
  readonly fromDate: string;
  readonly days: number;
}): Promise<SessionCard[]> {
  const result = await sql<{
    id: string;
    hospital_id: string;
    hospital_name_bn: string;
    doctor_id: string;
    doctor_name_bn: string;
    department_code: string;
    session_date: string;
    planned_start: Date;
    planned_end: Date;
    status: string;
    room: string | null;
    fee_poisha: number;
    capacity: number | null;
    taken: string;
  }>`
    SELECT s.id, s.hospital_id, h.name_bn AS hospital_name_bn,
           s.doctor_id, d.full_name_bn AS doctor_name_bn,
           dep.code AS department_code,
           s.session_date::text AS session_date,
           s.planned_start, s.planned_end, s.status::text AS status,
           s.room, s.fee_poisha, s.capacity,
           (SELECT count(*)::text FROM bookings b
             WHERE b.session_id = s.id AND b.status <> 'cancelled') AS taken
      FROM sessions s
      JOIN hospitals h ON h.id = s.hospital_id
      JOIN doctors d ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
     WHERE s.deleted_at IS NULL
       AND h.is_live
       AND s.session_date >= ${input.fromDate}::date
       AND s.session_date < ${input.fromDate}::date + ${input.days}::integer
       AND s.status IN ('scheduled', 'running', 'paused')
       AND (${input.doctorId ?? null}::uuid IS NULL OR s.doctor_id = ${input.doctorId ?? null}::uuid)
       AND (${input.hospitalId ?? null}::uuid IS NULL
            OR s.hospital_id = ${input.hospitalId ?? null}::uuid)
     ORDER BY s.session_date, s.planned_start
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    hospitalId: row.hospital_id,
    hospitalNameBn: row.hospital_name_bn,
    doctorId: row.doctor_id,
    doctorNameBn: row.doctor_name_bn,
    departmentCode: row.department_code,
    sessionDate: row.session_date,
    plannedStart: row.planned_start.toISOString(),
    plannedEnd: row.planned_end.toISOString(),
    status: row.status,
    room: row.room,
    feePoisha: row.fee_poisha,
    capacity: row.capacity,
    taken: Number(row.taken),
  }));
}

/** One facility, or null. Used by the detail screen. */
export async function findHospital(hospitalId: string): Promise<HospitalCard | null> {
  const rows = await listHospitalsById(hospitalId);
  return rows[0] ?? null;
}

async function listHospitalsById(hospitalId: string): Promise<HospitalCard[]> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals
     WHERE id = ${hospitalId} AND deleted_at IS NULL AND is_live
  `.execute(db);

  if (result.rows.length === 0) return [];

  // Reuses the list projection so a detail screen and a card can never
  // disagree about what a facility is.
  const all = await listHospitals({ limit: 500 });
  return all.filter((hospital) => hospital.id === hospitalId);
}
