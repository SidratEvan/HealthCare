/**
 * Emergency cases, capabilities, and the geography of emergency search
 * (DATABASE.md §2.2, §2.5, §4; migrations 0004, 0008, 0013, 0016).
 *
 * The only place emergency SQL lives (CLAUDE.md §7). Three rules shape it:
 *
 * **A case is written under a lock the service took.** `lockCase` is `FOR
 * UPDATE`; two ER consoles tapping the same alert serialise on the row, and
 * the second decides against what the first wrote.
 *
 * **Tokens are allocated under a per-hospital lock.** An advisory lock keyed
 * on the hospital, held for the transaction, so two arrivals in the same
 * second at the same ER are told `ER-14` and `ER-15`, never both `ER-14`.
 * `emergency_cases_open_token_key` is the backstop.
 *
 * **Nothing the console lists names anybody.** `openCases` returns problems,
 * colours, ages and times, and whether a number was left. The number itself
 * comes from `contactOf`, one case at a time, so the service can audit exactly
 * that read (`DB-P7`) and cannot audit a read it did not know was identifying.
 */

import { sql } from 'kysely';

import type {
  BedKind,
  CapabilityKind,
  DhakaDate,
  EmergencyCaseView,
  EmergencyProblem,
  EmergencyState,
  Sex,
  Timestamp,
  TriageColor,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

// ---------------------------------------------------------------------------
// Facilities that run an ER
// ---------------------------------------------------------------------------

/** A facility as an emergency result card and the family's status page name it. */
export interface ErHospital {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly addressBn: string | null;
  readonly addressEn: string | null;
  readonly lat: number | null;
  readonly lng: number | null;
  /** The ER desk's line; the switchboard when the facility gives none. */
  readonly emergencyPhone: string | null;
}

/**
 * Live facilities with an ER console — a staff account holding the
 * `emergency` role.
 *
 * That is what "has an emergency department" means in this product: "I'm on
 * my way" rings a console (`FR-PAT-46`), and a facility with nobody to ring
 * would be told nothing while the family was told it had been. The diagnostic
 * centre and the clinic run no ER console, so emergency search does not list
 * them.
 */
export async function erHospitals(onlyIds?: readonly string[]): Promise<ErHospital[]> {
  const result = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    address_bn: string | null;
    address_en: string | null;
    lat: number | null;
    lng: number | null;
    emergency_phone: string | null;
  }>`
    SELECT h.id, h.name_bn, h.name_en, h.address_bn, h.address_en, h.lat, h.lng,
           COALESCE(h.emergency_phone, h.phone) AS emergency_phone
      FROM hospitals h
     WHERE h.deleted_at IS NULL
       AND h.is_live
       AND (${onlyIds === undefined}::boolean OR h.id = ANY(${[...(onlyIds ?? [])]}::uuid[]))
       AND EXISTS (
         SELECT 1
           FROM staff_roles sr
           JOIN staff_users su ON su.id = sr.staff_user_id
          WHERE sr.hospital_id = h.id
            AND sr.role = 'emergency'
            AND sr.deleted_at IS NULL
            AND su.deleted_at IS NULL
       )
     ORDER BY h.id
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    nameBn: row.name_bn,
    nameEn: row.name_en,
    addressBn: row.address_bn,
    addressEn: row.address_en,
    lat: row.lat,
    lng: row.lng,
    emergencyPhone: row.emergency_phone,
  }));
}

export async function hasEmergencyDesk(hospitalId: string): Promise<boolean> {
  return (await erHospitals([hospitalId])).length > 0;
}

/** `fn_nearby_hospitals` (migration 0013): within a radius, nearest first. */
export async function nearby(input: {
  readonly lat: number;
  readonly lng: number;
  readonly capability: CapabilityKind | null;
  readonly radiusMetres: number;
}): Promise<
  Map<string, { readonly distanceMetres: number; readonly hasCapability: boolean | null }>
> {
  const result = await sql<{
    hospital_id: string;
    distance_m: number;
    has_capability: boolean | null;
  }>`
    SELECT hospital_id, distance_m, has_capability
      FROM fn_nearby_hospitals(
        ${input.lat}::double precision, ${input.lng}::double precision,
        ${input.capability}::capability_kind, ${input.radiusMetres}::double precision
      )
  `.execute(db);

  return new Map(
    result.rows.map((row) => [
      row.hospital_id,
      { distanceMetres: Number(row.distance_m), hasCapability: row.has_capability },
    ]),
  );
}

/** Which of these facilities can take a case needing `capability` right now. */
export async function capableNow(
  hospitalIds: readonly string[],
  capability: CapabilityKind,
): Promise<Set<string>> {
  if (hospitalIds.length === 0) return new Set();
  const result = await sql<{ hospital_id: string }>`
    SELECT hospital_id FROM capabilities
     WHERE hospital_id = ANY(${[...hospitalIds]}::uuid[])
       AND kind = ${capability}::capability_kind
       AND is_available
  `.execute(db);
  return new Set(result.rows.map((row) => row.hospital_id));
}

/** Straight-line metres from a point to a facility, or null without a coordinate. */
export async function distanceTo(
  hospitalId: string,
  point: { readonly lat: number; readonly lng: number },
): Promise<number | null> {
  const result = await sql<{ distance_m: number | null }>`
    SELECT ST_Distance(h.geo, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)
             AS distance_m
      FROM hospitals h
     WHERE h.id = ${hospitalId}::uuid AND h.geo IS NOT NULL
  `.execute(db);
  const distance = result.rows[0]?.distance_m;
  return distance === undefined || distance === null ? null : Number(distance);
}

/** The ER half of the public view: load and capability freshness (`FR-EMG-04`, `FR-EMG-05`). */
export interface EmergencyFigures {
  readonly erActive: number;
  readonly capabilities: readonly CapabilityKind[];
  readonly capabilityAsOf: Timestamp | null;
}

/** From `v_public_hospital_capacity`, the only source the public API reads (DATABASE.md §5). */
export async function emergencyFigures(
  hospitalIds: readonly string[],
): Promise<Map<string, EmergencyFigures>> {
  if (hospitalIds.length === 0) return new Map();
  const result = await sql<{
    hospital_id: string;
    er_active: number;
    capabilities: CapabilityKind[];
    capability_as_of: Date | null;
  }>`
    SELECT hospital_id, er_active, capabilities, capability_as_of
      FROM v_public_hospital_capacity
     WHERE hospital_id = ANY(${[...hospitalIds]}::uuid[])
  `.execute(db);

  return new Map(
    result.rows.map((row) => [
      row.hospital_id,
      {
        erActive: row.er_active,
        capabilities: row.capabilities,
        capabilityAsOf: iso(row.capability_as_of),
      },
    ]),
  );
}

/** `hospital_settings.stale_threshold_minutes` per facility (`FR-OFF-04`). */
export async function staleThresholds(
  hospitalIds: readonly string[],
): Promise<Map<string, number>> {
  if (hospitalIds.length === 0) return new Map();
  const result = await sql<{ hospital_id: string; stale_threshold_minutes: number }>`
    SELECT hospital_id, stale_threshold_minutes FROM hospital_settings
     WHERE hospital_id = ANY(${[...hospitalIds]}::uuid[])
  `.execute(db);
  return new Map(result.rows.map((row) => [row.hospital_id, row.stale_threshold_minutes]));
}

/** Kinds of bed a facility has, for `BTN-B07-ADMIT`'s choice. */
export async function bedKindsAt(hospitalId: string): Promise<BedKind[]> {
  const result = await sql<{ kind: BedKind }>`
    SELECT DISTINCT kind::text AS kind FROM beds
     WHERE hospital_id = ${hospitalId}::uuid AND deleted_at IS NULL
     ORDER BY 1
  `.execute(db);
  return result.rows.map((row) => row.kind);
}

// ---------------------------------------------------------------------------
// Capabilities (`FR-EMG-05`)
// ---------------------------------------------------------------------------

export interface CapabilityRow {
  readonly kind: CapabilityKind;
  readonly available: boolean;
  readonly updatedAt: Timestamp;
}

export async function capabilitiesOf(hospitalId: string, trx?: Tx): Promise<CapabilityRow[]> {
  const result = await sql<{ kind: CapabilityKind; is_available: boolean; updated_at: Date }>`
    SELECT kind::text AS kind, is_available, updated_at
      FROM capabilities
     WHERE hospital_id = ${hospitalId}::uuid
     ORDER BY kind
  `.execute(trx ?? db);
  return result.rows.map((row) => ({
    kind: row.kind,
    available: row.is_available,
    updatedAt: row.updated_at.toISOString() as Timestamp,
  }));
}

/**
 * Writes each named capability with this person and this instant.
 *
 * Every row named is updated even when its value is unchanged: re-sending the
 * list is how a coordinator says "still true", and `updated_at` is what a
 * family's freshness line reads. `trg_capabilities_touch` sets it.
 */
export async function confirmCapabilities(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly entries: readonly { readonly kind: CapabilityKind; readonly available: boolean }[];
    readonly staffUserId: string;
  },
): Promise<void> {
  for (const entry of input.entries) {
    await sql`
      UPDATE capabilities
         SET is_available = ${entry.available},
             updated_by   = ${input.staffUserId}::uuid
       WHERE hospital_id = ${input.hospitalId}::uuid
         AND kind = ${entry.kind}::capability_kind
    `.execute(trx);
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

/** A case with what the service decides against: the view, plus who it names. */
export interface CaseRow extends EmergencyCaseView {
  readonly patientId: string | null;
  readonly createdAt: Timestamp;
}

interface CaseSqlRow {
  id: string;
  hospital_id: string;
  patient_id: string | null;
  state: EmergencyState;
  problem_type: EmergencyProblem;
  triage: TriageColor | null;
  token_label: string | null;
  patient_age_years: number | null;
  patient_sex: Sex | null;
  has_phone: boolean;
  inbound_at: Date | null;
  inbound_eta_minutes: number | null;
  acknowledged_at: Date | null;
  arrived_at: Date | null;
  closed_at: Date | null;
  decline_reason: string | null;
  admit_bed_kind: BedKind | null;
  admit_requested_at: Date | null;
  created_at: Date;
}

const CASE_COLUMNS = sql`
  ec.id, ec.hospital_id, ec.patient_id, ec.state::text AS state, ec.problem_type,
  ec.triage::text AS triage, ec.token_label, ec.patient_age_years,
  ec.patient_sex::text AS patient_sex, (ec.contact_phone IS NOT NULL) AS has_phone,
  ec.inbound_at, ec.inbound_eta_minutes, ec.acknowledged_at, ec.arrived_at, ec.closed_at,
  ec.decline_reason, ec.admit_bed_kind::text AS admit_bed_kind, ec.admit_requested_at,
  ec.created_at
`;

function toCase(row: CaseSqlRow): CaseRow {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    patientId: row.patient_id,
    state: row.state,
    problem: row.problem_type,
    triage: row.triage,
    tokenLabel: row.token_label,
    ageYears: row.patient_age_years,
    sex: row.patient_sex,
    hasPhone: row.has_phone,
    inboundAt: iso(row.inbound_at),
    inboundEtaMinutes: row.inbound_eta_minutes,
    acknowledgedAt: iso(row.acknowledged_at),
    arrivedAt: iso(row.arrived_at),
    closedAt: iso(row.closed_at),
    declineReason: row.decline_reason,
    admitBedKind: row.admit_bed_kind,
    admitRequestedAt: iso(row.admit_requested_at),
    createdAt: row.created_at.toISOString() as Timestamp,
  };
}

export async function findCase(caseId: string, trx?: Tx): Promise<CaseRow | null> {
  const result = await sql<CaseSqlRow>`
    SELECT ${CASE_COLUMNS} FROM emergency_cases ec
     WHERE ec.id = ${caseId}::uuid AND ec.deleted_at IS NULL
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toCase(row);
}

export async function lockCase(trx: Tx, caseId: string): Promise<CaseRow | null> {
  const result = await sql<CaseSqlRow>`
    SELECT ${CASE_COLUMNS} FROM emergency_cases ec
     WHERE ec.id = ${caseId}::uuid AND ec.deleted_at IS NULL
       FOR UPDATE
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toCase(row);
}

/**
 * Serialises two requests carrying the same key for the rest of the
 * transaction, so a retry that races its original waits and then finds the
 * case, rather than meeting the unique index as an error.
 */
export async function lockIdempotencyKey(trx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`er-key:${key}`}, 0))`.execute(trx);
}

/** The case a retried alert or a replayed walk-in already made. */
export async function findByIdempotencyKey(trx: Tx, key: string): Promise<CaseRow | null> {
  const result = await sql<CaseSqlRow>`
    SELECT ${CASE_COLUMNS} FROM emergency_cases ec WHERE ec.idempotency_key = ${key}
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toCase(row);
}

/** Every open case at one ER: the alerts and the triage list (`S-B-07`). */
export async function openCases(hospitalId: string): Promise<CaseRow[]> {
  const result = await sql<CaseSqlRow>`
    SELECT ${CASE_COLUMNS} FROM emergency_cases ec
     WHERE ec.hospital_id = ${hospitalId}::uuid
       AND ec.closed_at IS NULL
       AND ec.deleted_at IS NULL
     ORDER BY ec.created_at
  `.execute(db);
  return result.rows.map(toCase);
}

/**
 * Open cases the ER has handed to the ward — the ER half of
 * `LIST-B06-PENDING` (`FR-BED-07`). Names nobody.
 */
export async function handoffs(hospitalId: string): Promise<CaseRow[]> {
  const result = await sql<CaseSqlRow>`
    SELECT ${CASE_COLUMNS} FROM emergency_cases ec
     WHERE ec.hospital_id = ${hospitalId}::uuid
       AND ec.admit_requested_at IS NOT NULL
       AND ec.closed_at IS NULL
       AND ec.deleted_at IS NULL
     ORDER BY ec.admit_requested_at
  `.execute(db);
  return result.rows.map(toCase);
}

/** The number somebody left. **Identifying**: the caller audits it. */
export async function contactOf(caseId: string): Promise<string | null> {
  const result = await sql<{ contact_phone: string | null }>`
    SELECT contact_phone FROM emergency_cases WHERE id = ${caseId}::uuid AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.contact_phone ?? null;
}

/** `POST /emergency/inbound` — "I'm on my way" (`FR-PAT-46`). */
export async function insertInbound(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly problem: EmergencyProblem;
    readonly etaMinutes: number | null;
    readonly phone: string | null;
    readonly ageYears: number | null;
    readonly sex: Sex | null;
    readonly idempotencyKey: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO emergency_cases
      (hospital_id, problem_type, state, inbound_at, inbound_eta_minutes,
       contact_phone, patient_age_years, patient_sex, idempotency_key)
    VALUES (
      ${input.hospitalId}::uuid, ${input.problem}, 'inbound', now(), ${input.etaMinutes},
      ${input.phone}, ${input.ageYears}, ${input.sex}::sex, ${input.idempotencyKey}
    )
    RETURNING id
  `.execute(trx);
  return requiredId(result.rows[0]?.id);
}

/** `POST /emergency/cases` — somebody who walked in, straight onto the triage list. */
export async function insertWalkIn(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly problem: EmergencyProblem;
    readonly triage: TriageColor | null;
    readonly tokenLabel: string;
    readonly phone: string | null;
    readonly ageYears: number | null;
    readonly sex: Sex | null;
    readonly idempotencyKey: string | null;
    readonly createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO emergency_cases
      (hospital_id, problem_type, state, arrived_at, token_label, triage,
       contact_phone, patient_age_years, patient_sex, idempotency_key, created_by)
    VALUES (
      ${input.hospitalId}::uuid, ${input.problem}, 'arrived', now(), ${input.tokenLabel},
      ${input.triage}::triage_color, ${input.phone}, ${input.ageYears}, ${input.sex}::sex,
      ${input.idempotencyKey}, ${input.createdBy}::uuid
    )
    RETURNING id
  `.execute(trx);
  return requiredId(result.rows[0]?.id);
}

/**
 * What an action changes on a case. Each field is written only when present,
 * so an action names exactly what it moves and nothing else is touched.
 */
export interface CaseWrite {
  readonly state?: EmergencyState;
  readonly triage?: TriageColor;
  readonly tokenLabel?: string;
  readonly acknowledged?: true;
  readonly arrived?: true;
  readonly closed?: true;
  readonly declineReason?: string;
  readonly admitBedKind?: BedKind;
  readonly patientId?: string;
}

export async function writeCase(trx: Tx, caseId: string, write: CaseWrite): Promise<void> {
  await sql`
    UPDATE emergency_cases
       SET state              = coalesce(${write.state ?? null}::emergency_state, state),
           triage             = coalesce(${write.triage ?? null}::triage_color, triage),
           token_label        = coalesce(${write.tokenLabel ?? null}, token_label),
           acknowledged_at    = CASE WHEN ${write.acknowledged === true} THEN now() ELSE acknowledged_at END,
           arrived_at         = CASE WHEN ${write.arrived === true} THEN now() ELSE arrived_at END,
           closed_at          = CASE WHEN ${write.closed === true} THEN now() ELSE closed_at END,
           decline_reason     = coalesce(${write.declineReason ?? null}, decline_reason),
           admit_bed_kind     = coalesce(${write.admitBedKind ?? null}::bed_kind, admit_bed_kind),
           admit_requested_at = CASE
                                  WHEN ${write.admitBedKind !== undefined} THEN coalesce(admit_requested_at, now())
                                  ELSE admit_requested_at
                                END,
           patient_id         = coalesce(${write.patientId ?? null}::uuid, patient_id)
     WHERE id = ${caseId}::uuid
  `.execute(trx);
}

/**
 * Takes this hospital's token lock for the rest of the transaction, and says
 * how many people arrived today and which labels open cases still answer to.
 */
export async function tokenContext(
  trx: Tx,
  hospitalId: string,
  today: DhakaDate,
): Promise<{ readonly arrivedToday: number; readonly openLabels: ReadonlySet<string> }> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`er-token:${hospitalId}`}, 0))`.execute(
    trx,
  );

  const counted = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM emergency_cases
     WHERE hospital_id = ${hospitalId}::uuid
       AND arrived_at IS NOT NULL
       AND (arrived_at AT TIME ZONE 'Asia/Dhaka')::date = ${today}::date
  `.execute(trx);

  const open = await sql<{ token_label: string }>`
    SELECT token_label FROM emergency_cases
     WHERE hospital_id = ${hospitalId}::uuid
       AND closed_at IS NULL AND token_label IS NOT NULL AND deleted_at IS NULL
  `.execute(trx);

  return {
    arrivedToday: Number(counted.rows[0]?.n ?? '0'),
    openLabels: new Set(open.rows.map((row) => row.token_label)),
  };
}

/** What the family's status screen shows (`S-A-10c`). The facility, and nothing about anyone. */
export interface CaseStatusRow {
  readonly id: string;
  readonly state: EmergencyState;
  readonly problem: EmergencyProblem;
  readonly inboundAt: Timestamp | null;
  readonly inboundEtaMinutes: number | null;
  readonly acknowledgedAt: Timestamp | null;
  readonly arrivedAt: Timestamp | null;
  readonly closedAt: Timestamp | null;
  readonly declineReason: string | null;
  readonly hospital: ErHospital;
}

export async function caseStatus(caseId: string): Promise<CaseStatusRow | null> {
  const result = await sql<{
    id: string;
    state: EmergencyState;
    problem_type: EmergencyProblem;
    inbound_at: Date | null;
    inbound_eta_minutes: number | null;
    acknowledged_at: Date | null;
    arrived_at: Date | null;
    closed_at: Date | null;
    decline_reason: string | null;
    hospital_id: string;
    name_bn: string;
    name_en: string;
    address_bn: string | null;
    address_en: string | null;
    lat: number | null;
    lng: number | null;
    emergency_phone: string | null;
  }>`
    SELECT ec.id, ec.state::text AS state, ec.problem_type, ec.inbound_at,
           ec.inbound_eta_minutes, ec.acknowledged_at, ec.arrived_at, ec.closed_at,
           ec.decline_reason, h.id AS hospital_id, h.name_bn, h.name_en, h.address_bn, h.address_en,
           h.lat, h.lng, COALESCE(h.emergency_phone, h.phone) AS emergency_phone
      FROM emergency_cases ec
      JOIN hospitals h ON h.id = ec.hospital_id
     WHERE ec.id = ${caseId}::uuid AND ec.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    state: row.state,
    problem: row.problem_type,
    inboundAt: iso(row.inbound_at),
    inboundEtaMinutes: row.inbound_eta_minutes,
    acknowledgedAt: iso(row.acknowledged_at),
    arrivedAt: iso(row.arrived_at),
    closedAt: iso(row.closed_at),
    declineReason: row.decline_reason,
    hospital: {
      id: row.hospital_id,
      nameBn: row.name_bn,
      nameEn: row.name_en,
      addressBn: row.address_bn,
      addressEn: row.address_en,
      lat: row.lat,
      lng: row.lng,
      emergencyPhone: row.emergency_phone,
    },
  };
}

function iso(value: Date | null): Timestamp | null {
  return value === null ? null : (value.toISOString() as Timestamp);
}

function requiredId(id: string | undefined): string {
  if (id === undefined) throw new Error('emergency_cases insert returned no id.');
  return id;
}
