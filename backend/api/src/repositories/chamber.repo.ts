/**
 * Today's chambers at a facility, with how many are waiting in each.
 *
 * Shared by the two ways into a chamber console: the demo picker, which lists
 * every live facility (`demo.repo`), and a signed-in member of staff, who sees
 * their own facility only (`GET /staff/chambers`, pilot step 21). One query,
 * so the two cannot disagree about which chambers are "today's".
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

export interface ChamberRow {
  readonly hospitalId: string;
  readonly id: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly departmentNameEn: string;
  readonly room: string | null;
  readonly status: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly waiting: number;
  readonly total: number;
}

/** Every facility's chambers when `hospitalId` is null; one facility's otherwise. */
export async function todaysChambers(hospitalId: string | null): Promise<ChamberRow[]> {
  const sessions = await sql<{
    hospital_id: string;
    id: string;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
    department_name_en: string;
    room: string | null;
    status: string;
    planned_start: Date;
    planned_end: Date;
    waiting: string;
    total: string;
  }>`
    SELECT s.hospital_id, s.id,
           d.full_name_bn AS doctor_name_bn,
           d.full_name_en AS doctor_name_en,
           dep.name_bn    AS department_name_bn,
           dep.name_en    AS department_name_en,
           s.room, s.status::text AS status, s.planned_start, s.planned_end,
           count(b.id) FILTER (WHERE b.status IN ('booked', 'waiting'))::text AS waiting,
           count(b.id)::text AS total
      FROM sessions s
      JOIN doctors d       ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
      LEFT JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
       AND (${hospitalId}::uuid IS NULL OR s.hospital_id = ${hospitalId}::uuid)
       AND s.room IS DISTINCT FROM 'E2E'
       AND (
         s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
         -- A chamber that opened at half past eleven and is still going at one
         -- in the morning belongs to the console somebody is standing at right
         -- now, whatever date it is filed under. Filtering on the date alone
         -- hid it, and hid it worst in the demo: FR-DEM-06 builds the pitch
         -- session by walking a mid-queue log backwards from the present, so a
         -- reset between midnight and about 01:20 Dhaka dates the one session
         -- that demonstrates the product to yesterday and the picker then
         -- offered nothing running.
         OR (s.status = 'running'
             AND s.session_date >= (now() AT TIME ZONE 'Asia/Dhaka')::date - 1)
       )
     GROUP BY s.hospital_id, s.id, d.full_name_bn, d.full_name_en,
              dep.name_bn, dep.name_en, s.room, s.status, s.planned_start, s.planned_end
     ORDER BY
       -- A chamber already mid-queue first: it is the one that demonstrates
       -- the product rather than describing it (FR-DEM-06).
       CASE s.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
       s.planned_start
  `.execute(db);

  return sessions.rows.map((row) => ({
    hospitalId: row.hospital_id,
    id: row.id,
    doctorNameBn: row.doctor_name_bn,
    doctorNameEn: row.doctor_name_en,
    departmentNameBn: row.department_name_bn,
    departmentNameEn: row.department_name_en,
    room: row.room,
    status: row.status,
    plannedStart: row.planned_start.toISOString(),
    plannedEnd: row.planned_end.toISOString(),
    waiting: Number(row.waiting),
    total: Number(row.total),
  }));
}
