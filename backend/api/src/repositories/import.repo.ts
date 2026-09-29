/**
 * Import batches, their rows, and the hospital's own identifiers (pilot step
 * 24, `FR-IMP-04`…`08`, DATABASE.md §2.6b, `external_refs`).
 *
 * Rows only. What a row means — whether it adds, updates or is refused — is
 * the service's; what it writes is the settings repository's and the guest
 * repository's own functions wherever one exists, so an imported department
 * is made exactly as one typed into `S-B-11` is.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

type Executor = typeof db | Tx;

export interface BatchRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly setKind: string;
  readonly fileName: string;
  readonly fileSha256: string;
  readonly state: 'checked' | 'committed' | 'undone' | 'discarded';
  readonly counts: { add: number; update: number; skip: number; error: number };
  readonly createdBy: string;
  readonly createdByName: string | null;
  readonly createdAt: string;
  readonly committedByName: string | null;
  readonly committedAt: string | null;
  readonly undoneByName: string | null;
  readonly undoneAt: string | null;
}

interface RawBatch {
  id: string;
  hospital_id: string;
  set_kind: string;
  file_name: string;
  file_sha256: string;
  state: BatchRow['state'];
  counts: Partial<BatchRow['counts']>;
  created_by: string;
  created_by_name: string | null;
  created_at: Date;
  committed_by_name: string | null;
  committed_at: Date | null;
  undone_by_name: string | null;
  undone_at: Date | null;
}

function toBatch(row: RawBatch): BatchRow {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    setKind: row.set_kind,
    fileName: row.file_name,
    fileSha256: row.file_sha256,
    state: row.state,
    counts: { add: 0, update: 0, skip: 0, error: 0, ...row.counts },
    createdBy: row.created_by,
    createdByName: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    committedByName: row.committed_by_name,
    committedAt: row.committed_at?.toISOString() ?? null,
    undoneByName: row.undone_by_name,
    undoneAt: row.undone_at?.toISOString() ?? null,
  };
}

const BATCH_SELECT = sql`
  SELECT b.id, b.hospital_id, b.set_kind::text AS set_kind, b.file_name, b.file_sha256,
         b.state::text AS state, b.counts, b.created_by, c.full_name AS created_by_name, b.created_at,
         m.full_name AS committed_by_name, b.committed_at, u.full_name AS undone_by_name, b.undone_at
    FROM import_batches b
    LEFT JOIN staff_users c ON c.id = b.created_by
    LEFT JOIN staff_users m ON m.id = b.committed_by
    LEFT JOIN staff_users u ON u.id = b.undone_by
`;

export async function batchesOf(hospitalId: string): Promise<BatchRow[]> {
  const result = await sql<RawBatch>`
    ${BATCH_SELECT}
     WHERE b.hospital_id = ${hospitalId}
     ORDER BY b.created_at DESC
     LIMIT 100
  `.execute(db);
  return result.rows.map(toBatch);
}

/** A batch of this facility's, locked when `trx` is given (commit, undo, discard). */
export async function batchOf(
  hospitalId: string,
  batchId: string,
  trx: Tx | null = null,
): Promise<BatchRow | null> {
  const lock = trx === null ? sql`` : sql`FOR UPDATE OF b`;
  const result = await sql<RawBatch>`
    ${BATCH_SELECT}
     WHERE b.id = ${batchId} AND b.hospital_id = ${hospitalId}
     ${lock}
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toBatch(row);
}

export interface NewRow {
  readonly rowNumber: number;
  readonly raw: Record<string, string>;
  readonly action: 'add' | 'update' | 'skip' | 'error';
  readonly errors: readonly { readonly field: string; readonly code: string }[];
  readonly targetKind: string | null;
  readonly targetId: string | null;
}

export async function createBatch(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly setKind: string;
    readonly fileName: string;
    readonly fileSha256: string;
    readonly counts: BatchRow['counts'];
    readonly createdBy: string;
    readonly rows: readonly NewRow[];
  },
): Promise<string> {
  const created = await sql<{ id: string }>`
    INSERT INTO import_batches (hospital_id, set_kind, file_name, file_sha256, counts, created_by)
    VALUES (${input.hospitalId}, ${input.setKind}::import_set, ${input.fileName}, ${input.fileSha256},
            ${JSON.stringify(input.counts)}::jsonb, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const batchId = created.rows[0]?.id;
  if (batchId === undefined) throw new Error('import_batches returned no id');

  for (let start = 0; start < input.rows.length; start += 200) {
    const values = input.rows.slice(start, start + 200).map(
      (
        row,
      ) => sql`(${batchId}::uuid, ${row.rowNumber}::int, ${JSON.stringify(row.raw)}::jsonb, ${row.action},
                    ${JSON.stringify(row.errors)}::jsonb, ${row.targetKind}::external_kind, ${row.targetId}::uuid)`,
    );
    if (values.length === 0) continue;
    await sql`
      INSERT INTO import_rows (batch_id, row_number, raw, action, errors, target_kind, target_id)
      VALUES ${sql.join(values)}
    `.execute(trx);
  }
  return batchId;
}

export interface StoredRow {
  readonly id: string;
  readonly rowNumber: number;
  readonly raw: Record<string, string> | null;
  readonly action: NewRow['action'];
  readonly errors: readonly { readonly field: string; readonly code: string }[];
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly previous: Record<string, unknown> | null;
}

export async function rowsOf(batchId: string, executor: Executor = db): Promise<StoredRow[]> {
  const result = await sql<{
    id: string;
    row_number: number;
    raw: Record<string, string> | null;
    action: NewRow['action'];
    errors: { field: string; code: string }[];
    target_kind: string | null;
    target_id: string | null;
    previous: Record<string, unknown> | null;
  }>`
    SELECT id, row_number, raw, action, errors, target_kind::text AS target_kind, target_id, previous
      FROM import_rows WHERE batch_id = ${batchId} ORDER BY row_number
  `.execute(executor);
  return result.rows.map((row) => ({
    id: row.id,
    rowNumber: row.row_number,
    raw: row.raw,
    action: row.action,
    errors: row.errors,
    targetKind: row.target_kind,
    targetId: row.target_id,
    previous: row.previous,
  }));
}

export async function markRowWritten(
  trx: Tx,
  rowId: string,
  input: {
    readonly targetKind: string;
    readonly targetId: string;
    readonly previous: Record<string, unknown> | null;
  },
): Promise<void> {
  await sql`
    UPDATE import_rows SET target_kind = ${input.targetKind}::external_kind, target_id = ${input.targetId},
           previous = ${input.previous === null ? null : JSON.stringify(input.previous)}::jsonb
     WHERE id = ${rowId}
  `.execute(trx);
}

export async function setState(
  trx: Tx,
  batchId: string,
  state: 'committed' | 'undone' | 'discarded',
  by: string,
): Promise<void> {
  if (state === 'committed') {
    await sql`UPDATE import_batches SET state = 'committed', committed_by = ${by}, committed_at = now() WHERE id = ${batchId}`.execute(
      trx,
    );
  } else if (state === 'undone') {
    await sql`UPDATE import_batches SET state = 'undone', undone_by = ${by}, undone_at = now() WHERE id = ${batchId}`.execute(
      trx,
    );
  } else {
    await sql`UPDATE import_batches SET state = 'discarded' WHERE id = ${batchId}`.execute(trx);
    await purgeRows(trx, batchId);
  }
}

/** Clears the rows' contents, keeping numbers, actions and errors (`FR-IMP-08`). */
export async function purgeRows(trx: Tx, batchId: string): Promise<void> {
  await sql`UPDATE import_rows SET raw = NULL, previous = NULL WHERE batch_id = ${batchId}`.execute(
    trx,
  );
  await sql`UPDATE import_batches SET rows_purged_at = now() WHERE id = ${batchId}`.execute(trx);
}

/** Batches committed more than 30 days ago whose rows are still held (`FR-IMP-08`). */
export async function purgeExpired(): Promise<number> {
  const result = await sql<{ id: string }>`
    WITH due AS (
      UPDATE import_batches SET rows_purged_at = now()
       WHERE rows_purged_at IS NULL AND state IN ('committed', 'undone')
         AND coalesce(undone_at, committed_at) < now() - interval '30 days'
      RETURNING id
    )
    UPDATE import_rows SET raw = NULL, previous = NULL WHERE batch_id IN (SELECT id FROM due)
    RETURNING batch_id AS id
  `.execute(db);
  return new Set(result.rows.map((row) => row.id)).size;
}

// --- the hospital's own identifiers (FR-IMP-04) -------------------------------

/** Every identifier this facility has imported, by kind, as `ref → entity`. */
export async function refsOf(
  hospitalId: string,
  executor: Executor = db,
): Promise<Map<string, string>> {
  const result = await sql<{ kind: string; external_ref: string; entity_id: string }>`
    SELECT kind::text AS kind, external_ref, entity_id FROM external_refs WHERE hospital_id = ${hospitalId}
  `.execute(executor);
  return new Map(result.rows.map((row) => [`${row.kind}:${row.external_ref}`, row.entity_id]));
}

export async function upsertRef(
  trx: Tx,
  input: {
    readonly hospitalId: string;
    readonly kind: string;
    readonly externalRef: string;
    readonly entityId: string;
    readonly batchId: string;
  },
): Promise<void> {
  await sql`
    INSERT INTO external_refs (hospital_id, kind, external_ref, entity_id, batch_id)
    VALUES (${input.hospitalId}, ${input.kind}::external_kind, ${input.externalRef}, ${input.entityId}, ${input.batchId})
    ON CONFLICT (hospital_id, kind, external_ref) DO UPDATE SET entity_id = excluded.entity_id
  `.execute(trx);
}

/** The identifiers a batch first wrote, removed when the batch is undone. */
export async function dropRefsOf(trx: Tx, batchId: string): Promise<void> {
  await sql`DELETE FROM external_refs WHERE batch_id = ${batchId}`.execute(trx);
}

/** One `IMPORT` audit row (`FR-IMP-08`): who, which batch, what happened to it. */
export async function audit(
  trx: Tx,
  input: {
    readonly actorStaffId: string;
    readonly hospitalId: string;
    readonly batchId: string;
    readonly event: 'checked' | 'committed' | 'undone' | 'discarded';
    readonly meta: Record<string, unknown>;
    readonly ip: string | null;
    readonly userAgent: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO audit_log (actor_staff_id, hospital_id, action, subject_table, subject_id, ip, user_agent, meta)
    VALUES (${input.actorStaffId}, ${input.hospitalId}, 'IMPORT', 'import_batches', ${input.batchId},
            ${input.ip}::inet, ${input.userAgent}, ${JSON.stringify({ event: input.event, ...input.meta })}::jsonb)
  `.execute(trx);
}

// --- what an import reads and writes beyond the settings repository -----------

/** The tables an import writes, and so the only ones these helpers will name. */
export type ImportTable =
  | 'departments'
  | 'doctor_hospitals'
  | 'session_templates'
  | 'wards'
  | 'beds'
  | 'staff_users'
  | 'patients'
  | 'bookings';

/** A row's current values for `columns`, kept so an undo can put them back (`FR-IMP-07`). */
export async function currentValues(
  trx: Tx,
  table: ImportTable,
  id: string,
  columns: readonly string[],
): Promise<Record<string, unknown> | null> {
  const pairs = sql.join(columns.map((column) => sql`${column}::text, t.${sql.ref(column)}`));
  const result = await sql<{ values: Record<string, unknown> }>`
    SELECT jsonb_build_object(${pairs}) AS values FROM ${sql.table(table)} t WHERE t.id = ${id}
  `.execute(trx);
  return result.rows[0]?.values ?? null;
}

/** Puts back what `currentValues` kept, each column cast to its own type by Postgres. */
export async function restoreValues(
  trx: Tx,
  table: ImportTable,
  id: string,
  values: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(values);
  if (columns.length === 0) return;
  const list = sql.join(columns.map((column) => sql.ref(column)));
  await sql`
    UPDATE ${sql.table(table)} AS t SET (${list}) =
      (SELECT ${list} FROM jsonb_populate_record(NULL::${sql.table(table)}, ${JSON.stringify(values)}::jsonb))
     WHERE t.id = ${id}
  `.execute(trx);
}

/** Marks rows removed, as every soft delete in this schema does. */
export async function softDelete(
  trx: Tx,
  table: ImportTable,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  await sql`
    UPDATE ${sql.table(table)} SET deleted_at = now() WHERE id = ANY(${[...ids]}::uuid[]) AND deleted_at IS NULL
  `.execute(trx);
}

export async function departmentIdByCode(hospitalId: string, code: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM departments WHERE hospital_id = ${hospitalId} AND code = ${code} AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

export async function doctorHospitalFor(
  executor: Executor,
  input: { hospitalId: string; doctorId: string; departmentId: string },
): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM doctor_hospitals
     WHERE hospital_id = ${input.hospitalId} AND doctor_id = ${input.doctorId}
       AND department_id = ${input.departmentId} AND deleted_at IS NULL
  `.execute(executor);
  return result.rows[0]?.id ?? null;
}

export async function bedIdByLabel(hospitalId: string, label: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM beds WHERE hospital_id = ${hospitalId} AND lower(label) = lower(${label}) AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

export async function staffIdByEmail(hospitalId: string, email: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM staff_users
     WHERE hospital_id = ${hospitalId} AND lower(email) = lower(${email}) AND deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.id ?? null;
}

/**
 * The chamber an imported appointment belongs to: this doctor's, in this
 * department, on this date, not cancelled or ended — and, when a start time
 * is given, the one whose window holds it.
 */
export async function chamberFor(
  executor: Executor,
  input: {
    hospitalId: string;
    doctorId: string;
    departmentId: string;
    date: string;
    startTime: string | null;
  },
): Promise<{ id: string; feePoisha: number } | null> {
  const result = await sql<{ id: string; fee_poisha: number }>`
    SELECT s.id, s.fee_poisha FROM sessions s
     WHERE s.hospital_id = ${input.hospitalId} AND s.doctor_id = ${input.doctorId}
       AND s.department_id = ${input.departmentId} AND s.session_date = ${input.date}::date
       AND s.deleted_at IS NULL AND s.status NOT IN ('cancelled', 'ended')
       AND (${input.startTime}::time IS NULL OR
            (${input.startTime}::time >= (s.planned_start AT TIME ZONE 'Asia/Dhaka')::time
             AND ${input.startTime}::time < (s.planned_end AT TIME ZONE 'Asia/Dhaka')::time))
     ORDER BY s.planned_start
     LIMIT 1
  `.execute(executor);
  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, feePoisha: row.fee_poisha };
}

/** Whether a live booking in the chamber holds this serial, other than `exceptBookingId`. */
export async function serialHeld(
  executor: Executor,
  sessionId: string,
  serial: number,
  exceptBookingId: string | null,
): Promise<boolean> {
  const result = await sql<{ one: number }>`
    SELECT 1 AS one FROM bookings
     WHERE session_id = ${sessionId} AND serial_number = ${serial} AND deleted_at IS NULL
       AND (${exceptBookingId}::uuid IS NULL OR id <> ${exceptBookingId}::uuid)
  `.execute(executor);
  return result.rows.length > 0;
}

/** A patient the hospital holds (`FR-IMP-10`). */
export async function insertHospitalPatient(
  trx: Tx,
  input: {
    hospitalId: string;
    fullName: string;
    dateOfBirth: string | null;
    ageYears: number | null;
    sex: string;
    phone: string | null;
    bloodGroup: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO patients (owner_hospital_id, full_name, date_of_birth, age_years, sex, phone, blood_group,
                          relationship, is_primary)
    VALUES (${input.hospitalId}, ${input.fullName}, ${input.dateOfBirth}::date, ${input.ageYears},
            ${input.sex}::sex, ${input.phone}, ${input.bloodGroup}, 'self', false)
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('patients insert returned no id');
  return id;
}

export async function updateHospitalPatient(
  trx: Tx,
  patientId: string,
  input: {
    fullName: string;
    dateOfBirth: string | null;
    ageYears: number | null;
    sex: string;
    phone: string | null;
    bloodGroup: string | null;
  },
): Promise<void> {
  await sql`
    UPDATE patients SET full_name = ${input.fullName}, date_of_birth = ${input.dateOfBirth}::date,
           age_years = ${input.ageYears}, sex = ${input.sex}::sex, phone = ${input.phone},
           blood_group = ${input.bloodGroup}, updated_at = now()
     WHERE id = ${patientId}
  `.execute(trx);
}

export async function updateImportedBooking(
  trx: Tx,
  bookingId: string,
  input: { serial: number; paid: boolean },
): Promise<void> {
  await sql`
    UPDATE bookings SET serial_number = ${input.serial},
           intake = jsonb_set(intake, '{import}', ${JSON.stringify({ paid: input.paid })}::jsonb),
           updated_at = now()
     WHERE id = ${bookingId}
  `.execute(trx);
}

/**
 * What stops an undo (`FR-IMP-07`): of the rows the batch added, those that
 * something outside the batch has since been built on. `own` is every entity
 * the batch wrote, so the batch's own rows never hold each other.
 */
export async function heldByOthers(
  trx: Tx,
  input: { kind: string; ids: readonly string[]; own: readonly string[] },
): Promise<string[]> {
  const ids = [...input.ids];
  const own = [...input.own];
  if (ids.length === 0) return [];
  const query = (() => {
    switch (input.kind) {
      case 'department':
        return sql<{ id: string }>`
          SELECT DISTINCT department_id AS id FROM doctor_hospitals
           WHERE department_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND NOT (id = ANY(${own}::uuid[]))
        `;
      case 'doctor':
        return sql<{ id: string }>`
          SELECT DISTINCT dh.id FROM doctor_hospitals dh
            JOIN sessions s ON s.doctor_id = dh.doctor_id AND s.department_id = dh.department_id
                           AND s.hospital_id = dh.hospital_id AND s.deleted_at IS NULL
            JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
           WHERE dh.id = ANY(${ids}::uuid[]) AND NOT (b.id = ANY(${own}::uuid[]))
        `;
      case 'schedule':
        return sql<{ id: string }>`
          SELECT DISTINCT s.template_id AS id FROM sessions s
            JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
           WHERE s.template_id = ANY(${ids}::uuid[]) AND s.deleted_at IS NULL
             AND NOT (b.id = ANY(${own}::uuid[]))
        `;
      case 'ward':
        return sql<{ id: string }>`
          SELECT DISTINCT ward_id AS id FROM beds
           WHERE ward_id = ANY(${ids}::uuid[]) AND deleted_at IS NULL AND NOT (id = ANY(${own}::uuid[]))
        `;
      case 'bed':
        return sql<{ id: string }>`
          SELECT b.id FROM beds b
           WHERE b.id = ANY(${ids}::uuid[])
             AND (b.state <> 'out_of_service' OR EXISTS (SELECT 1 FROM bed_events e WHERE e.bed_id = b.id))
        `;
      case 'staff':
        return sql<{ id: string }>`
          SELECT id FROM staff_users WHERE id = ANY(${ids}::uuid[]) AND last_login_at IS NOT NULL
        `;
      case 'patient':
        return sql<{ id: string }>`
          SELECT p.id FROM patients p
           WHERE p.id = ANY(${ids}::uuid[])
             AND (EXISTS (SELECT 1 FROM bookings b WHERE b.patient_id = p.id AND b.deleted_at IS NULL
                                                    AND NOT (b.id = ANY(${own}::uuid[])))
                  OR EXISTS (SELECT 1 FROM visits v WHERE v.patient_id = p.id))
        `;
      case 'appointment':
        return sql<{ id: string }>`
          SELECT id FROM bookings
           WHERE id = ANY(${ids}::uuid[]) AND (status <> 'booked' OR payment_id IS NOT NULL)
        `;
      default:
        return null;
    }
  })();
  if (query === null) return [];
  return (await query.execute(trx)).rows.map((row) => row.id);
}

/** Reads that need no transaction, named so a call site says so. */
export const readOnly: Executor = db;

/**
 * An appointment from the hospital's own system (set C): a booking with the
 * hospital's serial, `source = 'import'`, booked by nobody in this product.
 * "Paid" is kept as the hospital's word in `intake.import`.
 */
export async function insertImportedBooking(
  trx: Tx,
  input: {
    sessionId: string;
    patientId: string;
    serial: number;
    feePoisha: number;
    paid: boolean;
    createdBy: string;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, intake, created_by)
    VALUES (${input.sessionId}, ${input.patientId}, ${input.serial}, 'import', ${input.feePoisha},
            ${JSON.stringify({ import: { paid: input.paid } })}::jsonb, ${input.createdBy})
    RETURNING id
  `.execute(trx);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('bookings insert returned no id');
  return id;
}

export async function sessionOfBooking(trx: Tx, bookingId: string): Promise<string | null> {
  const result = await sql<{ session_id: string }>`
    SELECT session_id FROM bookings WHERE id = ${bookingId}
  `.execute(trx);
  return result.rows[0]?.session_id ?? null;
}

/** An imported account taken back: removed, with its roles and any session. */
export async function retireStaff(trx: Tx, staffId: string): Promise<void> {
  await sql`UPDATE staff_roles SET deleted_at = now() WHERE staff_user_id = ${staffId} AND deleted_at IS NULL`.execute(
    trx,
  );
  await sql`UPDATE sessions_auth SET revoked_at = now() WHERE subject_id = ${staffId} AND revoked_at IS NULL`.execute(
    trx,
  );
  await sql`UPDATE staff_users SET deleted_at = now(), is_active = false WHERE id = ${staffId}`.execute(
    trx,
  );
}

/** A schedule an import replaced, brought back when the import is undone. */
export async function reviveTemplate(trx: Tx, templateId: string): Promise<void> {
  await sql`UPDATE session_templates SET deleted_at = NULL WHERE id = ${templateId}`.execute(trx);
}
