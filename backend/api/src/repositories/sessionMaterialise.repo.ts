/**
 * The weekly schedules and the chambers made from them (pilot step 22,
 * BACKEND.md §8 `sessions.materialise`, DATABASE.md §2.3).
 *
 * Two reads and one write. Which dates a schedule falls on is decided in
 * `shared/domain` (`plannedSessions`), not here: this file only fetches the
 * schedules and writes the rows it is handed.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

export interface ScheduleRow {
  readonly id: string;
  readonly weekday: number;
  /** `HH:MM`, Asia/Dhaka wall clock. */
  readonly startTime: string;
  readonly endTime: string;
  /** `YYYY-MM-DD`. */
  readonly activeFrom: string;
  readonly activeTo: string | null;
  readonly capacity: number | null;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly departmentId: string;
  readonly room: string | null;
  readonly feePoisha: number;
}

/**
 * Every schedule that can still produce a chamber: not ended, its doctor
 * still sitting at the facility, the facility not removed. A doctor made
 * inactive keeps their schedules but gets no new chambers until made active.
 * `onlyTemplate` narrows it to one, for the write that follows adding one.
 */
export async function activeSchedules(
  from: string,
  onlyTemplate: string | null = null,
): Promise<ScheduleRow[]> {
  const result = await sql<{
    id: string;
    weekday: number;
    start_time: string;
    end_time: string;
    active_from: string;
    active_to: string | null;
    capacity: number | null;
    hospital_id: string;
    doctor_id: string;
    department_id: string;
    room: string | null;
    fee_poisha: number;
  }>`
    SELECT t.id, t.weekday, to_char(t.start_time, 'HH24:MI') AS start_time,
           to_char(t.end_time, 'HH24:MI') AS end_time,
           to_char(t.active_from, 'YYYY-MM-DD') AS active_from,
           to_char(t.active_to, 'YYYY-MM-DD') AS active_to,
           t.capacity, dh.hospital_id, dh.doctor_id, dh.department_id, dh.room, dh.fee_poisha
      FROM session_templates t
      JOIN doctor_hospitals dh ON dh.id = t.doctor_hospital_id
      JOIN doctors d ON d.id = dh.doctor_id
      JOIN hospitals h ON h.id = dh.hospital_id
      JOIN departments dep ON dep.id = dh.department_id
     WHERE t.deleted_at IS NULL AND dh.deleted_at IS NULL AND dh.is_active
       AND d.deleted_at IS NULL AND h.deleted_at IS NULL AND dep.deleted_at IS NULL
       AND (t.active_to IS NULL OR t.active_to >= ${from}::date)
       AND (${onlyTemplate}::uuid IS NULL OR t.id = ${onlyTemplate}::uuid)
  `.execute(db);
  return result.rows.map((row) => ({
    id: row.id,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
    activeFrom: row.active_from,
    activeTo: row.active_to,
    capacity: row.capacity,
    hospitalId: row.hospital_id,
    doctorId: row.doctor_id,
    departmentId: row.department_id,
    room: row.room,
    feePoisha: row.fee_poisha,
  }));
}

export interface SessionToWrite {
  readonly templateId: string;
  readonly hospitalId: string;
  readonly doctorId: string;
  readonly departmentId: string;
  readonly room: string | null;
  readonly sessionDate: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly capacity: number | null;
  readonly feePoisha: number;
}

/**
 * Writes the chambers that do not exist yet and returns how many it wrote.
 *
 * `ON CONFLICT DO NOTHING` against `sessions_template_date_key` (0028) is the
 * whole guarantee: two processes, a missed night, or a run straight after a
 * schedule was added all end with one chamber per schedule per day. The fee
 * is copied, as every session's is, so a later fee change never reaches a
 * booking already made (DB-P5).
 */
export async function insertMissing(rows: readonly SessionToWrite[]): Promise<number> {
  let written = 0;
  // Batches keep a statement well under the parameter limit for a facility
  // with a hundred doctors and eight days ahead.
  for (let start = 0; start < rows.length; start += 200) {
    const batch = rows.slice(start, start + 200);
    const values = batch.map(
      (row) =>
        sql`(${row.templateId}::uuid, ${row.hospitalId}::uuid, ${row.doctorId}::uuid, ${row.departmentId}::uuid,
             ${row.room}, ${row.sessionDate}::date, ${row.plannedStart}::timestamptz,
             ${row.plannedEnd}::timestamptz, ${row.capacity}::int, ${row.feePoisha}::int)`,
    );
    const result = await sql<{ id: string }>`
      INSERT INTO sessions (template_id, hospital_id, doctor_id, department_id, room, session_date,
                            planned_start, planned_end, capacity, fee_poisha)
      VALUES ${sql.join(values)}
      ON CONFLICT (template_id, session_date) WHERE template_id IS NOT NULL AND deleted_at IS NULL
      DO NOTHING
      RETURNING id
    `.execute(db);
    written += result.rows.length;
  }
  return written;
}
