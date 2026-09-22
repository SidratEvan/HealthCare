/**
 * Beds, wards, admissions and bed requests (DATABASE.md §2.5, migration 0008).
 *
 * The only place bed SQL lives (CLAUDE.md §7). Two rules shape it:
 *
 * **Every write happens under a row lock the service took first.** A bed is
 * locked before it is read for a decision, the pair of beds in a transfer is
 * locked in id order so two opposite transfers cannot deadlock, and a patient
 * row is locked before an admission is written for them. The unique indexes in
 * 0008 would refuse a double admit anyway; the locks turn that refusal into a
 * clear answer rather than a constraint violation surfacing as a 500.
 *
 * **Nothing the board reads names a patient.** `listBeds` returns states,
 * prices and times. The two reads that do carry identity — `occupantOf` and
 * `pendingRequests` — are separate functions so the service can audit exactly
 * those (`DB-P7`), and cannot audit a read it did not know was identifying.
 */

import { sql } from 'kysely';

import type {
  AdmissionSource,
  BedEventType,
  BedKind,
  BedState,
  BedView,
  DhakaDate,
  PublicCapacity,
  Timestamp,
  WardView,
} from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** A bed with the hospital it belongs to — what the service decides against. */
export interface BedRow extends BedView {
  readonly hospitalId: string;
}

interface BedSqlRow {
  id: string;
  hospital_id: string;
  ward_id: string;
  label: string;
  kind: BedKind;
  state: BedState;
  nightly_poisha: number;
  last_cleaned_at: Date | null;
  state_changed_at: Date;
  expected_discharge_date: string | null;
  reserved_until: Date | null;
  oos_reason: string | null;
  current_admission_id: string | null;
  held_for_request_id: string | null;
}

/**
 * The bed columns, plus the request it is held for.
 *
 * `heldForRequestId` is read through `bed_requests.bed_id` rather than stored
 * on the bed: 0008 makes a hold one row naming one bed, and a second copy of
 * that pointer on `beds` could disagree with it.
 */
const BED_SELECT = sql`
  b.id, b.hospital_id, b.ward_id, b.label, b.kind::text AS kind, b.state::text AS state,
  b.nightly_poisha, b.last_cleaned_at, b.state_changed_at,
  b.expected_discharge_date::text AS expected_discharge_date,
  b.reserved_until, b.oos_reason, b.current_admission_id,
  (SELECT r.id FROM bed_requests r
    WHERE r.bed_id = b.id AND r.state = 'held' AND r.deleted_at IS NULL
    LIMIT 1) AS held_for_request_id
`;

function toBed(row: BedSqlRow): BedRow {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    wardId: row.ward_id,
    label: row.label,
    kind: row.kind,
    state: row.state,
    nightlyPoisha: row.nightly_poisha,
    lastCleanedAt: iso(row.last_cleaned_at),
    stateChangedAt: row.state_changed_at.toISOString() as Timestamp,
    expectedDischargeDate: row.expected_discharge_date as DhakaDate | null,
    reservedUntil: iso(row.reserved_until),
    oosReason: row.oos_reason,
    admissionId: row.current_admission_id,
    heldForRequestId: row.held_for_request_id,
  };
}

function iso(value: Date | null): Timestamp | null {
  return value === null ? null : (value.toISOString() as Timestamp);
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** The ward tabs, ground floor first (`TAB-B06-<ward>`). */
export async function listWards(hospitalId: string): Promise<WardView[]> {
  const result = await sql<{
    id: string;
    name_bn: string;
    name_en: string;
    floor: number;
    kind: BedKind;
  }>`
    SELECT id, name_bn, name_en, floor, kind::text AS kind
      FROM wards
     WHERE hospital_id = ${hospitalId}::uuid AND deleted_at IS NULL
     ORDER BY floor, name_en
  `.execute(db);

  return result.rows.map((row) => ({
    id: row.id,
    nameBn: row.name_bn,
    nameEn: row.name_en,
    floor: row.floor,
    kind: row.kind,
  }));
}

/** Every bed at a hospital, in label order. No patient identity (`DB-P7`). */
export async function listBeds(hospitalId: string, trx?: Tx): Promise<BedRow[]> {
  const result = await sql<BedSqlRow>`
    SELECT ${BED_SELECT}
      FROM beds b
     WHERE b.hospital_id = ${hospitalId}::uuid AND b.deleted_at IS NULL
     ORDER BY b.label
  `.execute(trx ?? db);

  return result.rows.map(toBed);
}

/** One bed, unlocked. */
export async function findBed(bedId: string): Promise<BedRow | null> {
  const result = await sql<BedSqlRow>`
    SELECT ${BED_SELECT} FROM beds b WHERE b.id = ${bedId}::uuid AND b.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  return row === undefined ? null : toBed(row);
}

/**
 * Locks beds for a decision, in id order.
 *
 * Id order is what keeps two transfers in opposite directions — 301 to 302
 * and 302 to 301, tapped on two consoles at once — from each holding one lock
 * and waiting for the other.
 */
export async function lockBeds(trx: Tx, bedIds: readonly string[]): Promise<BedRow[]> {
  const result = await sql<BedSqlRow>`
    SELECT ${BED_SELECT}
      FROM beds b
     WHERE b.id = ANY(${[...bedIds]}::uuid[]) AND b.deleted_at IS NULL
     ORDER BY b.id
       FOR UPDATE OF b
  `.execute(trx);

  return result.rows.map(toBed);
}

/** Reserved beds whose hold has run out, locked, skipping any another console holds. */
export async function lockLapsedHolds(trx: Tx, hospitalId: string): Promise<BedRow[]> {
  const result = await sql<BedSqlRow>`
    SELECT ${BED_SELECT}
      FROM beds b
     WHERE b.hospital_id = ${hospitalId}::uuid
       AND b.state = 'reserved'
       AND b.reserved_until <= now()
       AND b.deleted_at IS NULL
       FOR UPDATE OF b SKIP LOCKED
  `.execute(trx);

  return result.rows.map(toBed);
}

/** What a bed becomes. Every column that describes one state is written, so none survives into another. */
export interface BedWrite {
  readonly state: BedState;
  readonly admissionId: string | null;
  readonly expectedDischargeDate: string | null;
  readonly reservedUntil: Date | null;
  readonly oosReason: string | null;
  /** Set when a clean finishes. */
  readonly cleaned?: boolean;
}

export async function writeBed(trx: Tx, bedId: string, write: BedWrite): Promise<void> {
  await sql`
    UPDATE beds
       SET state                   = ${write.state}::bed_state,
           current_admission_id    = ${write.admissionId}::uuid,
           expected_discharge_date = ${write.expectedDischargeDate}::date,
           reserved_until          = ${write.reservedUntil},
           oos_reason              = ${write.oosReason},
           last_cleaned_at         = CASE WHEN ${write.cleaned === true} THEN now() ELSE last_cleaned_at END,
           state_changed_at        = now()
     WHERE id = ${bedId}::uuid
  `.execute(trx);
}

/** `SEL-B06-EXPDIS`: the forecast on the bed and on its stay, together. */
export async function writeDischargeForecast(
  trx: Tx,
  input: { readonly bedId: string; readonly admissionId: string; readonly date: string | null },
): Promise<void> {
  await sql`
    UPDATE beds SET expected_discharge_date = ${input.date}::date WHERE id = ${input.bedId}::uuid
  `.execute(trx);
  await sql`
    UPDATE admissions SET expected_discharge_date = ${input.date}::date
     WHERE id = ${input.admissionId}::uuid
  `.execute(trx);
}

// ---------------------------------------------------------------------------
// The event log
// ---------------------------------------------------------------------------

export interface BedEventWrite {
  readonly hospitalId: string;
  readonly bedId: string;
  readonly type: BedEventType;
  readonly from: BedState;
  readonly to: BedState;
  readonly admissionId: string | null;
  readonly bedRequestId: string | null;
  readonly actorStaffId: string | null;
  readonly payload: Record<string, unknown>;
  readonly clientEventId: string | null;
  readonly clientTs: string | null;
}

/** Appends one fact. Returns its server time, which is what freshness is read from. */
export async function appendEvent(
  trx: Tx,
  event: BedEventWrite,
): Promise<{ id: string; serverTs: string }> {
  const result = await sql<{ id: string; server_ts: Date }>`
    INSERT INTO bed_events
      (hospital_id, bed_id, type, from_state, to_state, admission_id, bed_request_id,
       actor_staff_id, payload, client_event_id, client_ts)
    VALUES (
      ${event.hospitalId}::uuid, ${event.bedId}::uuid, ${event.type},
      ${event.from}::bed_state, ${event.to}::bed_state,
      ${event.admissionId}::uuid, ${event.bedRequestId}::uuid, ${event.actorStaffId}::uuid,
      ${JSON.stringify(event.payload)}::jsonb, ${event.clientEventId}::uuid,
      ${event.clientTs}::timestamptz
    )
    RETURNING id, server_ts
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('bed_events insert returned no row.');
  return { id: row.id, serverTs: row.server_ts.toISOString() };
}

/**
 * The bed an already-applied client event was about (`SY-02`).
 *
 * A ward console replaying an admit it sent before the connection dropped is
 * told the admit happened, with the bed as it now stands, rather than being
 * refused because the bed is no longer free — which it is not, because of the
 * very admit being replayed.
 */
export async function findReplay(
  clientEventId: string,
): Promise<{
  readonly bedId: string;
  readonly hospitalId: string;
  readonly serverTs: string;
} | null> {
  const result = await sql<{ bed_id: string; hospital_id: string; server_ts: Date }>`
    SELECT bed_id, hospital_id, server_ts FROM bed_events
     WHERE client_event_id = ${clientEventId}::uuid
  `.execute(db);

  const row = result.rows[0];
  return row === undefined
    ? null
    : { bedId: row.bed_id, hospitalId: row.hospital_id, serverTs: row.server_ts.toISOString() };
}

// ---------------------------------------------------------------------------
// Admissions
// ---------------------------------------------------------------------------

/**
 * Locks a patient for the length of an admit, and says whether they are
 * already in a bed.
 *
 * Two consoles admitting the same person into two beds at once would each
 * find no open stay and each write one; the lock makes the second wait and
 * then see the first.
 */
export async function lockPatientForAdmit(
  trx: Tx,
  patientId: string,
): Promise<{ readonly exists: boolean; readonly openAdmissionBedId: string | null }> {
  const locked = await sql<{ id: string }>`
    SELECT id FROM patients WHERE id = ${patientId}::uuid AND deleted_at IS NULL FOR UPDATE
  `.execute(trx);
  if (locked.rows.length === 0) return { exists: false, openAdmissionBedId: null };

  const open = await sql<{ bed_id: string }>`
    SELECT bed_id FROM admissions
     WHERE patient_id = ${patientId}::uuid AND discharged_at IS NULL AND deleted_at IS NULL
  `.execute(trx);

  return { exists: true, openAdmissionBedId: open.rows[0]?.bed_id ?? null };
}

export async function insertAdmission(
  trx: Tx,
  input: {
    readonly patientId: string;
    readonly hospitalId: string;
    readonly bedId: string;
    readonly source: AdmissionSource;
    readonly bedRequestId: string | null;
    readonly expectedDischargeDate: string | null;
    readonly createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO admissions
      (patient_id, hospital_id, bed_id, source, bed_request_id, expected_discharge_date, created_by)
    VALUES (
      ${input.patientId}::uuid, ${input.hospitalId}::uuid, ${input.bedId}::uuid, ${input.source},
      ${input.bedRequestId}::uuid, ${input.expectedDischargeDate}::date, ${input.createdBy}::uuid
    )
    RETURNING id
  `.execute(trx);

  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('admissions insert returned no id.');
  return id;
}

export async function closeAdmission(trx: Tx, admissionId: string): Promise<void> {
  await sql`
    UPDATE admissions SET discharged_at = now() WHERE id = ${admissionId}::uuid AND discharged_at IS NULL
  `.execute(trx);
}

/** A transfer: the stay continues, in another bed. */
export async function moveAdmission(trx: Tx, admissionId: string, toBedId: string): Promise<void> {
  await sql`UPDATE admissions SET bed_id = ${toBedId}::uuid WHERE id = ${admissionId}::uuid`.execute(
    trx,
  );
}

/** Who is in a bed, for the bed panel. **Identifying**: the caller audits it. */
export interface Occupant {
  readonly admissionId: string;
  readonly patientId: string;
  readonly fullName: string;
  readonly ageYears: number | null;
  readonly sex: string;
  readonly admittedAt: string;
  readonly source: AdmissionSource;
  readonly bedRequestId: string | null;
}

export async function occupantOf(bedId: string): Promise<Occupant | null> {
  const result = await sql<{
    admission_id: string;
    patient_id: string;
    full_name: string;
    age_years: number | null;
    sex: string;
    admitted_at: Date;
    source: AdmissionSource;
    bed_request_id: string | null;
  }>`
    SELECT a.id AS admission_id, p.id AS patient_id, p.full_name, p.age_years, p.sex::text AS sex,
           a.admitted_at, a.source, a.bed_request_id
      FROM beds b
      JOIN admissions a ON a.id = b.current_admission_id
      JOIN patients p ON p.id = a.patient_id
     WHERE b.id = ${bedId}::uuid AND b.state = 'occupied'
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    admissionId: row.admission_id,
    patientId: row.patient_id,
    fullName: row.full_name,
    ageYears: row.age_years,
    sex: row.sex,
    admittedAt: row.admitted_at.toISOString(),
    source: row.source,
    bedRequestId: row.bed_request_id,
  };
}

// ---------------------------------------------------------------------------
// What the public sees
// ---------------------------------------------------------------------------

interface CapacitySqlRow {
  hospital_id: string;
  bed_total: number;
  bed_free: number;
  icu_total: number | null;
  icu_free: number | null;
  icu_as_of: Date | null;
  beds_as_of: Date | null;
  by_kind: {
    kind: BedKind;
    total: number;
    free: number;
    nightlyMinPoisha: number | null;
    nightlyMaxPoisha: number | null;
    asOf: string | null;
  }[];
}

function toCapacity(row: CapacitySqlRow): PublicCapacity {
  return {
    hospitalId: row.hospital_id,
    bedTotal: row.bed_total,
    bedFree: row.bed_free,
    icuTotal: row.icu_total,
    icuFree: row.icu_free,
    icuAsOf: iso(row.icu_as_of),
    bedsAsOf: iso(row.beds_as_of),
    // jsonb carries Postgres's timestamp text; normalised to ISO so every
    // `asOf` a client parses has one shape.
    byKind: row.by_kind.map((entry) => ({
      ...entry,
      asOf: entry.asOf === null ? null : (new Date(entry.asOf).toISOString() as Timestamp),
    })),
  };
}

/**
 * `v_public_hospital_capacity` for some hospitals — the only source the
 * public API reads (DATABASE.md §5).
 */
export async function publicCapacity(
  hospitalIds: readonly string[],
): Promise<Map<string, PublicCapacity>> {
  if (hospitalIds.length === 0) return new Map();

  const result = await sql<CapacitySqlRow>`
    SELECT hospital_id, bed_total, bed_free, icu_total, icu_free, icu_as_of, beds_as_of, by_kind
      FROM v_public_hospital_capacity
     WHERE hospital_id = ANY(${[...hospitalIds]}::uuid[])
  `.execute(db);

  return new Map(result.rows.map((row) => [row.hospital_id, toCapacity(row)]));
}

/** Hospitals with at least one bed of `kind` (`CHIP-A11-<type>`). */
export async function hospitalsWithKind(kind: BedKind): Promise<Set<string>> {
  const result = await sql<{ hospital_id: string }>`
    SELECT DISTINCT hospital_id FROM beds WHERE kind = ${kind}::bed_kind AND deleted_at IS NULL
  `.execute(db);
  return new Set(result.rows.map((row) => row.hospital_id));
}

/** `hospital_settings.stale_threshold_minutes`, or the documented default (`FR-OFF-04`). */
export async function staleThresholdMinutes(hospitalId: string): Promise<number> {
  const result = await sql<{ stale_threshold_minutes: number }>`
    SELECT stale_threshold_minutes FROM hospital_settings WHERE hospital_id = ${hospitalId}::uuid
  `.execute(db);
  return result.rows[0]?.stale_threshold_minutes ?? 10;
}

// ---------------------------------------------------------------------------
// Bed requests (`FR-PAT-52`, `FR-BED-07`)
// ---------------------------------------------------------------------------

export type BedRequestState = 'requested' | 'held' | 'confirmed' | 'declined' | 'expired';

export interface BedRequestRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly patientId: string;
  readonly bedKind: BedKind;
  readonly state: BedRequestState;
  readonly bedId: string | null;
  readonly holdExpiresAt: string | null;
  readonly requestedByGuestId: string | null;
  readonly requestedByUserId: string | null;
  readonly respondedAt: string | null;
  readonly createdAt: string;
  readonly expectedArrivalAt: string | null;
}

interface RequestSqlRow {
  id: string;
  hospital_id: string;
  patient_id: string;
  bed_kind: BedKind;
  state: BedRequestState;
  bed_id: string | null;
  hold_expires_at: Date | null;
  requested_by_guest_id: string | null;
  requested_by_user_id: string | null;
  responded_at: Date | null;
  created_at: Date;
  expected_arrival_at: Date | null;
}

const REQUEST_SELECT = sql`
  r.id, r.hospital_id, r.patient_id, r.bed_kind::text AS bed_kind, r.state, r.bed_id,
  r.hold_expires_at, r.requested_by_guest_id, r.requested_by_user_id, r.responded_at,
  r.created_at, r.expected_arrival_at
`;

function toRequest(row: RequestSqlRow): BedRequestRow {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    patientId: row.patient_id,
    bedKind: row.bed_kind,
    state: row.state,
    bedId: row.bed_id,
    holdExpiresAt: row.hold_expires_at?.toISOString() ?? null,
    requestedByGuestId: row.requested_by_guest_id,
    requestedByUserId: row.requested_by_user_id,
    respondedAt: row.responded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    expectedArrivalAt: row.expected_arrival_at?.toISOString() ?? null,
  };
}

export async function findRequest(requestId: string, trx?: Tx): Promise<BedRequestRow | null> {
  const result = await sql<RequestSqlRow>`
    SELECT ${REQUEST_SELECT} FROM bed_requests r
     WHERE r.id = ${requestId}::uuid AND r.deleted_at IS NULL
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toRequest(row);
}

export async function lockRequest(trx: Tx, requestId: string): Promise<BedRequestRow | null> {
  const result = await sql<RequestSqlRow>`
    SELECT ${REQUEST_SELECT} FROM bed_requests r
     WHERE r.id = ${requestId}::uuid AND r.deleted_at IS NULL
       FOR UPDATE OF r
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toRequest(row);
}

/** The request a replayed create already filed, or the patient's open one here. */
export async function findExistingRequest(
  trx: Tx,
  input: {
    readonly idempotencyKey: string | null;
    readonly patientId: string;
    readonly hospitalId: string;
  },
): Promise<BedRequestRow | null> {
  const result = await sql<RequestSqlRow>`
    SELECT ${REQUEST_SELECT} FROM bed_requests r
     WHERE r.deleted_at IS NULL
       AND (
         (${input.idempotencyKey}::text IS NOT NULL AND r.idempotency_key = ${input.idempotencyKey})
         OR (r.patient_id = ${input.patientId}::uuid AND r.hospital_id = ${input.hospitalId}::uuid
             AND r.state IN ('requested', 'held'))
       )
     ORDER BY r.created_at DESC
     LIMIT 1
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toRequest(row);
}

export async function insertRequest(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly patientId: string;
    readonly bedKind: BedKind;
    readonly guestId: string;
    readonly note: string | null;
    readonly expectedArrivalAt: string | null;
    readonly idempotencyKey: string | null;
  },
): Promise<BedRequestRow> {
  const result = await sql<RequestSqlRow>`
    INSERT INTO bed_requests AS r
      (hospital_id, patient_id, bed_kind, requested_by_guest_id, note, expected_arrival_at, idempotency_key)
    VALUES (
      ${input.hospitalId}::uuid, ${input.patientId}::uuid, ${input.bedKind}::bed_kind,
      ${input.guestId}::uuid, ${input.note}, ${input.expectedArrivalAt}::timestamptz,
      ${input.idempotencyKey}
    )
    RETURNING ${REQUEST_SELECT}
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('bed_requests insert returned no row.');
  return toRequest(row);
}

/** Moves a request to a new state, recording who answered and when. */
export async function answerRequest(
  trx: Tx,
  input: {
    readonly requestId: string;
    readonly state: BedRequestState;
    readonly bedId: string | null;
    readonly holdExpiresAt: Date | null;
    /** Null for the system: a hold that lapsed. */
    readonly respondedBy: string | null;
  },
): Promise<void> {
  await sql`
    UPDATE bed_requests
       SET state           = ${input.state},
           bed_id          = ${input.bedId}::uuid,
           hold_expires_at = ${input.holdExpiresAt},
           responded_by    = coalesce(${input.respondedBy}::uuid, responded_by),
           responded_at    = coalesce(responded_at, now())
     WHERE id = ${input.requestId}::uuid
  `.execute(trx);
}

/** One entry in `LIST-B06-PENDING`. **Identifying**: the caller audits it. */
export interface PendingRequest extends BedRequestRow {
  readonly patientName: string;
  readonly patientAgeYears: number | null;
  readonly patientSex: string;
  readonly contactPhone: string | null;
  readonly note: string | null;
  readonly heldBedLabel: string | null;
}

export async function pendingRequests(hospitalId: string): Promise<PendingRequest[]> {
  const result = await sql<
    RequestSqlRow & {
      full_name: string;
      age_years: number | null;
      sex: string;
      contact_phone: string | null;
      note: string | null;
      held_bed_label: string | null;
    }
  >`
    SELECT ${REQUEST_SELECT},
           p.full_name, p.age_years, p.sex::text AS sex,
           COALESCE(p.phone, g.phone, u.phone) AS contact_phone,
           r.note, hb.label AS held_bed_label
      FROM bed_requests r
      JOIN patients p ON p.id = r.patient_id
      LEFT JOIN guest_identities g ON g.id = r.requested_by_guest_id
      LEFT JOIN users u ON u.id = r.requested_by_user_id
      LEFT JOIN beds hb ON hb.id = r.bed_id
     WHERE r.hospital_id = ${hospitalId}::uuid
       AND r.state IN ('requested', 'held')
       AND r.deleted_at IS NULL
     ORDER BY r.created_at
  `.execute(db);

  return result.rows.map((row) => ({
    ...toRequest(row),
    patientName: row.full_name,
    patientAgeYears: row.age_years,
    patientSex: row.sex,
    contactPhone: row.contact_phone,
    note: row.note,
    heldBedLabel: row.held_bed_label,
  }));
}

/** What the family's status screen shows (`S-A-11` request status). No identity beyond their own. */
export interface RequestStatus {
  readonly id: string;
  readonly state: BedRequestState;
  readonly bedKind: BedKind;
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  readonly hospitalPhone: string | null;
  readonly holdExpiresAt: string | null;
  readonly respondedAt: string | null;
  readonly createdAt: string;
}

export async function requestStatus(requestId: string): Promise<RequestStatus | null> {
  const result = await sql<{
    id: string;
    state: BedRequestState;
    bed_kind: BedKind;
    hospital_id: string;
    name_bn: string;
    name_en: string;
    phone: string | null;
    hold_expires_at: Date | null;
    responded_at: Date | null;
    created_at: Date;
  }>`
    SELECT r.id, r.state, r.bed_kind::text AS bed_kind, r.hospital_id,
           h.name_bn, h.name_en, h.phone, r.hold_expires_at, r.responded_at, r.created_at
      FROM bed_requests r
      JOIN hospitals h ON h.id = r.hospital_id
     WHERE r.id = ${requestId}::uuid AND r.deleted_at IS NULL
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    id: row.id,
    state: row.state,
    bedKind: row.bed_kind,
    hospitalId: row.hospital_id,
    hospitalNameBn: row.name_bn,
    hospitalNameEn: row.name_en,
    hospitalPhone: row.phone,
    holdExpiresAt: row.hold_expires_at?.toISOString() ?? null,
    respondedAt: row.responded_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

/** The live, non-deleted hospital a request is for, if it is one. */
export async function hospitalExists(hospitalId: string): Promise<boolean> {
  const result = await sql<{ id: string }>`
    SELECT id FROM hospitals WHERE id = ${hospitalId}::uuid AND is_live AND deleted_at IS NULL
  `.execute(db);
  return result.rows.length > 0;
}
