/**
 * The derived cache (DATABASE.md §2.3).
 *
 * `queue_state` is never a source of truth. It exists so a patient opening
 * their phone does not replay a hundred events to be told they are number
 * eighteen (DATABASE.md §6), and it is safe to delete at any time — `rebuild`
 * in the queue service reconstructs it from the log.
 *
 * `rebuilt_from_seq` is what makes that safe to rely on: a value behind
 * `sessions.last_event_seq` means the cache has not consumed the whole log
 * yet, and the reader must fold the remainder before trusting it.
 */

import { sql } from 'kysely';

import type { QueueStateProjection } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** The cache as stored, plus the freshness stamp every live figure carries. */
export interface CachedQueueState {
  readonly sessionId: string;
  readonly nowServingBookingId: string | null;
  readonly nowServingSerial: number | null;
  readonly waitingCount: number;
  readonly lateCount: number;
  readonly noShowCount: number;
  readonly doneCount: number;
  readonly avgConsultSeconds: number | null;
  readonly projectedEnd: Date | null;
  readonly rebuiltFromSeq: number;
  /**
   * Drives the freshness line every patient sees (`FR-PAT-35`, `FR-OFF-03`).
   * Never omitted from a response: a live number without its age is the thing
   * `PRD.md` §3.2 forbids.
   */
  readonly updatedAt: Date;
}

export async function find(sessionId: string): Promise<CachedQueueState | null> {
  const result = await sql<StateQueryRow>`
    SELECT session_id, now_serving_booking_id, now_serving_serial, waiting_count,
           late_count, no_show_count, done_count, avg_consult_seconds,
           projected_end, rebuilt_from_seq, updated_at
      FROM queue_state
     WHERE session_id = ${sessionId}
  `.execute(db);

  const row = result.rows[0];
  return row === undefined ? null : toCachedState(row);
}

/**
 * Writes what the reducer produced.
 *
 * Takes a `QueueStateProjection` — the shape `project()` returns in
 * `shared/domain` — rather than loose arguments, so the cache and the reducer
 * cannot describe the same session differently. `projectedEnd` is separate
 * because it is a function of the clock as well as the state, and the domain
 * keeps the clock out.
 */
export async function save(
  trx: Tx,
  projection: QueueStateProjection,
  projectedEnd: string | null,
): Promise<void> {
  await trx
    .insertInto('queue_state')
    .values({
      session_id: projection.sessionId,
      now_serving_booking_id: projection.nowServingBookingId,
      now_serving_serial: projection.nowServingSerial,
      waiting_count: projection.waitingCount,
      late_count: projection.lateCount,
      no_show_count: projection.noShowCount,
      done_count: projection.doneCount,
      avg_consult_seconds: projection.avgConsultSeconds,
      projected_end: projectedEnd,
      rebuilt_from_seq: String(projection.rebuiltFromSeq),
    })
    .onConflict((conflict) =>
      conflict.column('session_id').doUpdateSet({
        now_serving_booking_id: projection.nowServingBookingId,
        now_serving_serial: projection.nowServingSerial,
        waiting_count: projection.waitingCount,
        late_count: projection.lateCount,
        no_show_count: projection.noShowCount,
        done_count: projection.doneCount,
        avg_consult_seconds: projection.avgConsultSeconds,
        projected_end: projectedEnd,
        rebuilt_from_seq: String(projection.rebuiltFromSeq),
      }),
    )
    .execute();
}

/**
 * Drops the cache for a session.
 *
 * Used by `rebuild`, and safe by design: the next read reconstructs it from
 * `queue_events`, which is the only thing that was ever true.
 */
export async function clear(trx: Tx, sessionId: string): Promise<void> {
  await trx.deleteFrom('queue_state').where('session_id', '=', sessionId).execute();
}

interface StateQueryRow {
  session_id: string;
  now_serving_booking_id: string | null;
  now_serving_serial: number | null;
  waiting_count: number;
  late_count: number;
  no_show_count: number;
  done_count: number;
  avg_consult_seconds: number | null;
  projected_end: Date | null;
  rebuilt_from_seq: string;
  updated_at: Date;
}

function toCachedState(row: StateQueryRow): CachedQueueState {
  return {
    sessionId: row.session_id,
    nowServingBookingId: row.now_serving_booking_id,
    nowServingSerial: row.now_serving_serial,
    waitingCount: row.waiting_count,
    lateCount: row.late_count,
    noShowCount: row.no_show_count,
    doneCount: row.done_count,
    avgConsultSeconds: row.avg_consult_seconds,
    projectedEnd: row.projected_end,
    rebuiltFromSeq: Number(row.rebuilt_from_seq),
    updatedAt: row.updated_at,
  };
}
