/** Counts-only chamber board, never patient records (FR-ADM-12, FR-SEC-11).
 * One bounded set-based statement; no per-chamber API/queue replay.
 */
import { sql } from 'kysely';

import type { SessionStatus } from '@platform/domain';

import { db } from '../config/db.js';

export const CHAMBER_LIMIT = 250;

export interface ChamberSummary {
  readonly sessionId: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly room: string | null;
  readonly status: SessionStatus;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly actualStart: string | null;
  readonly declaredDelayMinutes: number;
  readonly waiting: number;
  readonly seen: number;
  readonly noShows: number;
  readonly desks: readonly {
    readonly id: string;
    readonly nameBn: string;
    readonly nameEn: string;
  }[];
}

/** Scope and date are server-owned. Bookings are the queue's persisted
 * projection; missing queue_state does not fabricate a zero (DB-P1).
 */
export async function chambersToday(
  hospitalId: string,
  date: string,
): Promise<{
  readonly chambers: readonly ChamberSummary[];
  readonly chambersTruncated: boolean;
}> {
  const result = await sql<{
    session_id: string;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
    department_name_en: string;
    room: string | null;
    status: SessionStatus;
    planned_start: Date;
    planned_end: Date;
    actual_start: Date | null;
    declared_delay_minutes: number;
    waiting: number;
    seen: number;
    no_shows: number;
    desks: ChamberSummary['desks'];
  }>`
    WITH selected AS MATERIALIZED (
      SELECT s.id, s.doctor_id, s.department_id, s.room, s.status,
             s.planned_start, s.planned_end, s.actual_start, s.delay_minutes
        FROM sessions s
       WHERE s.hospital_id = ${hospitalId}::uuid
         AND s.session_date = ${date}::date AND s.deleted_at IS NULL
       ORDER BY s.planned_start, s.id
       LIMIT ${CHAMBER_LIMIT + 1}
    ), counts AS (
      SELECT b.session_id,
             count(*) FILTER (WHERE b.status IN ('booked', 'waiting'))::int AS waiting,
             count(*) FILTER (WHERE b.status = 'done')::int AS seen,
             count(*) FILTER (WHERE b.status = 'no_show')::int AS no_shows
        FROM bookings b JOIN selected s ON s.id = b.session_id
       WHERE b.deleted_at IS NULL
       GROUP BY b.session_id
    ), desks AS (
      SELECT dd.doctor_id,
             jsonb_agg(jsonb_build_object('id', d.id, 'nameBn', d.name_bn, 'nameEn', d.name_en)
                       ORDER BY d.name_en, d.id) AS desks
        FROM reception_desk_doctors dd
        JOIN reception_desks d ON d.id = dd.desk_id
       WHERE dd.hospital_id = ${hospitalId}::uuid AND d.hospital_id = ${hospitalId}::uuid
         AND d.deleted_at IS NULL
         AND dd.doctor_id IN (SELECT doctor_id FROM selected)
       GROUP BY dd.doctor_id
    )
    SELECT s.id AS session_id, d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en, dep.name_bn AS department_name_bn,
           dep.name_en AS department_name_en, s.room, s.status,
           s.planned_start, s.planned_end, s.actual_start,
           s.delay_minutes AS declared_delay_minutes,
           coalesce(c.waiting, 0)::int AS waiting, coalesce(c.seen, 0)::int AS seen,
           coalesce(c.no_shows, 0)::int AS no_shows, coalesce(desks.desks, '[]'::jsonb) AS desks
      FROM selected s
      JOIN doctors d ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id AND dep.hospital_id = ${hospitalId}::uuid
      LEFT JOIN counts c ON c.session_id = s.id
      LEFT JOIN desks ON desks.doctor_id = s.doctor_id
     ORDER BY s.planned_start, s.id
  `.execute(db);
  return {
    chambersTruncated: result.rows.length > CHAMBER_LIMIT,
    chambers: result.rows.slice(0, CHAMBER_LIMIT).map((row) => ({
      sessionId: row.session_id,
      doctorNameBn: row.doctor_name_bn,
      doctorNameEn: row.doctor_name_en,
      departmentNameBn: row.department_name_bn,
      departmentNameEn: row.department_name_en,
      room: row.room,
      status: row.status,
      plannedStart: row.planned_start.toISOString(),
      plannedEnd: row.planned_end.toISOString(),
      actualStart: row.actual_start?.toISOString() ?? null,
      declaredDelayMinutes: row.declared_delay_minutes,
      waiting: row.waiting,
      seen: row.seen,
      noShows: row.no_shows,
      desks: row.desks,
    })),
  };
}
