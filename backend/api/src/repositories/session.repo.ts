/**
 * Sessions: reading the plan, locking the row, and writing back the
 * projections the event log produces.
 *
 * The lock is the important part of this file. `lockForUpdate` is step 5 of
 * the `appendEvent` algorithm (BACKEND.md §4.1) and the reason two counters
 * cannot call a patient at the same moment (`FR-QUE-53`). Without it, both
 * read the same state, both decide the same patient is next, and both append —
 * and the log, which is supposed to settle disputes, contains the dispute.
 */

import { sql } from 'kysely';

import type { SessionStatus } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** A session's immutable plan plus the projections derived from its log. */
export interface SessionRow {
  readonly id: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly departmentId: string;
  readonly sessionDate: string;
  readonly plannedStart: Date;
  readonly plannedEnd: Date;
  readonly actualStart: Date | null;
  readonly actualEnd: Date | null;
  readonly status: SessionStatus;
  readonly capacity: number | null;
  readonly feePoisha: number;
  readonly delayMinutes: number;
  readonly avgConsultSeconds: number | null;
  readonly lastEventSeq: number;
  /** The doctor's configured starting rate, in minutes (`FR-QUE-10`). */
  readonly defaultConsultMinutes: number;
}

const SESSION_COLUMNS = [
  'sessions.id',
  'sessions.hospital_id',
  'sessions.doctor_id',
  'sessions.department_id',
  'sessions.session_date',
  'sessions.planned_start',
  'sessions.planned_end',
  'sessions.actual_start',
  'sessions.actual_end',
  'sessions.status',
  'sessions.capacity',
  'sessions.fee_poisha',
  'sessions.delay_minutes',
  'sessions.avg_consult_seconds',
  'sessions.last_event_seq',
] as const;

/** Reads a session without locking it. Used by the read paths. */
export async function findById(sessionId: string): Promise<SessionRow | null> {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('doctors', 'doctors.id', 'sessions.doctor_id')
    .select([...SESSION_COLUMNS, 'doctors.default_consult_minutes'])
    .where('sessions.id', '=', sessionId)
    .where('sessions.deleted_at', 'is', null)
    .executeTakeFirst();

  return row === undefined ? null : toSessionRow(row);
}

/**
 * Reads a session and holds its row until the transaction ends.
 *
 * `FOR UPDATE` on `sessions` rather than on `queue_events`: the log is
 * append-only and has no row to lock before the insert exists. The session row
 * is the natural mutex for "one thing happens to this queue at a time", and
 * every write path takes it in the same order, so there is no lock cycle to
 * deadlock on.
 *
 * `NOWAIT` is deliberately *not* used. A receptionist tapping `next` while
 * another counter is mid-append should wait the few milliseconds and succeed,
 * not be told to try again — the statement timeout on the pool (15 s) is the
 * backstop if something genuinely hangs.
 */
export async function lockForUpdate(trx: Tx, sessionId: string): Promise<SessionRow | null> {
  // `FOR UPDATE OF sessions` — only the session row is locked. Locking the
  // joined `doctors` row as well would serialise every chamber that doctor
  // sits in, so a cardiologist's evening clinic would block their morning one.
  const result = await sql<SessionQueryRow>`
    SELECT s.id, s.hospital_id, s.doctor_id, s.department_id, s.session_date,
           s.planned_start, s.planned_end, s.actual_start, s.actual_end,
           s.status, s.capacity, s.fee_poisha, s.delay_minutes,
           s.avg_consult_seconds, s.last_event_seq, d.default_consult_minutes
      FROM sessions s
      JOIN doctors d ON d.id = s.doctor_id
     WHERE s.id = ${sessionId} AND s.deleted_at IS NULL
       FOR UPDATE OF s
  `.execute(trx);

  const row = result.rows[0];
  return row === undefined ? null : toSessionRow(row);
}

/** What the reducer says is now true about the session (BACKEND.md §4.1.8). */
export interface SessionProjection {
  readonly status: SessionStatus;
  readonly actualStart: string | null;
  readonly actualEnd: string | null;
  readonly delayMinutes: number;
  readonly avgConsultSeconds: number | null;
  readonly lastEventSeq: number;
}

/**
 * Writes the projections back.
 *
 * Every value here comes from the reducer. Nothing in this function decides
 * anything — a session is `running` because `DOCTOR_ARRIVED` landed, not
 * because this repository inferred it (`DB-P1`).
 */
export async function saveProjection(
  trx: Tx,
  sessionId: string,
  projection: SessionProjection,
): Promise<void> {
  await trx
    .updateTable('sessions')
    .set({
      status: projection.status,
      actual_start: projection.actualStart,
      actual_end: projection.actualEnd,
      delay_minutes: projection.delayMinutes,
      avg_consult_seconds: projection.avgConsultSeconds,
      last_event_seq: String(projection.lastEventSeq),
    })
    .where('id', '=', sessionId)
    .execute();
}

/** Sessions a hospital is running on a date, for the console's selector. */
export async function listForHospitalDate(
  hospitalId: string,
  sessionDate: string,
): Promise<SessionRow[]> {
  const rows = await db
    .selectFrom('sessions')
    .innerJoin('doctors', 'doctors.id', 'sessions.doctor_id')
    .select([...SESSION_COLUMNS, 'doctors.default_consult_minutes'])
    .where('sessions.hospital_id', '=', hospitalId)
    .where('sessions.session_date', '=', sessionDate)
    .where('sessions.deleted_at', 'is', null)
    .orderBy('sessions.planned_start')
    .execute();

  return rows.map(toSessionRow);
}

/**
 * The hospital a session belongs to, for the scope check.
 *
 * Its own query because authorisation happens before the lock is taken
 * (BACKEND.md §4.1 steps 2 and 5): refusing a caller from another hospital
 * should not first make them queue behind a counter that is allowed.
 */
export async function hospitalIdOf(sessionId: string): Promise<string | null> {
  const row = await db
    .selectFrom('sessions')
    .select('hospital_id')
    .where('id', '=', sessionId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();

  return row?.hospital_id ?? null;
}

/**
 * Bumps `avg_consult_seconds` from the rolling rate after `PATIENT_DONE`.
 *
 * Separate from `saveProjection` because DATABASE.md §6 requires it to be
 * maintained incrementally rather than recomputed by a full scan, and because
 * it is the one projection that outlives the session: tomorrow's ETAs for this
 * doctor start from it (`FR-QUE-10`).
 */
export async function touchConsultRate(
  trx: Tx,
  sessionId: string,
  avgConsultSeconds: number,
): Promise<void> {
  await trx
    .updateTable('sessions')
    .set({ avg_consult_seconds: avgConsultSeconds })
    .where('id', '=', sessionId)
    .execute();
}

/** True when the database is reachable and the session exists. */
export async function exists(sessionId: string): Promise<boolean> {
  const row = await db
    .selectFrom('sessions')
    .select(sql<number>`1`.as('present'))
    .where('id', '=', sessionId)
    .executeTakeFirst();
  return row !== undefined;
}

interface SessionQueryRow {
  id: string;
  hospital_id: string;
  doctor_id: string;
  department_id: string;
  session_date: string;
  planned_start: Date;
  planned_end: Date;
  actual_start: Date | null;
  actual_end: Date | null;
  status: SessionStatus;
  capacity: number | null;
  fee_poisha: number;
  delay_minutes: number;
  avg_consult_seconds: number | null;
  last_event_seq: string;
  default_consult_minutes: number;
}

/** Row vocabulary to application vocabulary — the repository's other job. */
function toSessionRow(row: SessionQueryRow): SessionRow {
  return {
    id: row.id,
    hospitalId: row.hospital_id,
    doctorId: row.doctor_id,
    departmentId: row.department_id,
    sessionDate: row.session_date,
    plannedStart: row.planned_start,
    plannedEnd: row.planned_end,
    actualStart: row.actual_start,
    actualEnd: row.actual_end,
    status: row.status,
    capacity: row.capacity,
    feePoisha: row.fee_poisha,
    delayMinutes: row.delay_minutes,
    avgConsultSeconds: row.avg_consult_seconds,
    // bigserial arrives as a string to preserve precision; a session's own
    // sequence never approaches 2^53, so narrowing here is safe and the rest
    // of the application gets to work in numbers.
    lastEventSeq: Number(row.last_event_seq),
    defaultConsultMinutes: row.default_consult_minutes,
  };
}
