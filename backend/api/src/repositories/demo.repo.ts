/**
 * What a demo console needs in order to let somebody in (CLAUDE.md §4.1).
 *
 * "Under `DEMO_MODE=true`, the console picks a hospital and a role without a
 * password. That is the correct implementation for a pitch version, not a
 * shortcut to apologise for."
 *
 * So these reads answer one question: which hospitals are running something
 * today, which staff accounts exist to act as, and which chambers are worth
 * opening. Nothing here is reachable unless `DEMO_MODE` is on — the route
 * refuses first — and nothing here returns a patient's name.
 */

import { sql } from 'kysely';

import { db } from '../config/db.js';

/** A chamber a demo console can open. */
export interface DemoSessionRow {
  readonly id: string;
  readonly doctorNameBn: string;
  readonly doctorNameEn: string;
  readonly departmentNameBn: string;
  readonly room: string | null;
  readonly status: string;
  readonly plannedStart: string;
  readonly plannedEnd: string;
  readonly waiting: number;
  readonly total: number;
}

/** A hospital, the roles there are accounts for, and today's chambers. */
export interface DemoConsoleRow {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly district: string;
  readonly roles: readonly string[];
  readonly sessions: readonly DemoSessionRow[];
}

/**
 * Every live facility with a staff account, and what it is running now.
 *
 * "Now" rather than "today": a session still running from the previous Dhaka
 * day counts, because a receptionist whose chamber has not closed yet needs
 * their console at one in the morning as much as at nine at night.
 *
 * Ordered so the chamber the pitch opens on comes first: a session already
 * mid-queue is the one that demonstrates the product, and making somebody hunt
 * for it is the difference between a demo that lands and one that explains
 * itself. `FR-DEM-06` builds exactly one of those.
 */
export async function listConsoles(): Promise<DemoConsoleRow[]> {
  const hospitals = await sql<{
    hospital_id: string;
    name_bn: string;
    name_en: string;
    district: string;
    roles: string[];
  }>`
    SELECT h.id AS hospital_id, h.name_bn, h.name_en, h.district,
           array_agg(DISTINCT sr.role::text) AS roles
      FROM hospitals h
      JOIN staff_users su ON su.hospital_id = h.id AND su.deleted_at IS NULL
      JOIN staff_roles sr ON sr.staff_user_id = su.id
     WHERE h.is_live AND h.deleted_at IS NULL
     GROUP BY h.id, h.name_bn, h.name_en, h.district
     ORDER BY h.name_en
  `.execute(db);

  const sessions = await sql<{
    hospital_id: string;
    id: string;
    doctor_name_bn: string;
    doctor_name_en: string;
    department_name_bn: string;
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
           s.room, s.status::text AS status, s.planned_start, s.planned_end,
           count(b.id) FILTER (WHERE b.status IN ('booked', 'waiting'))::text AS waiting,
           count(b.id)::text AS total
      FROM sessions s
      JOIN doctors d       ON d.id = s.doctor_id
      JOIN departments dep ON dep.id = s.department_id
      LEFT JOIN bookings b ON b.session_id = s.id AND b.deleted_at IS NULL
     WHERE s.deleted_at IS NULL
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
              dep.name_bn, s.room, s.status, s.planned_start, s.planned_end
     ORDER BY
       -- A chamber already mid-queue first: it is the one that demonstrates
       -- the product rather than describing it (FR-DEM-06).
       CASE s.status WHEN 'running' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END,
       s.planned_start
  `.execute(db);

  const byHospital = new Map<string, DemoSessionRow[]>();
  for (const row of sessions.rows) {
    const list = byHospital.get(row.hospital_id) ?? [];
    list.push({
      id: row.id,
      doctorNameBn: row.doctor_name_bn,
      doctorNameEn: row.doctor_name_en,
      departmentNameBn: row.department_name_bn,
      room: row.room,
      status: row.status,
      plannedStart: row.planned_start.toISOString(),
      plannedEnd: row.planned_end.toISOString(),
      waiting: Number(row.waiting),
      total: Number(row.total),
    });
    byHospital.set(row.hospital_id, list);
  }

  return (
    hospitals.rows
      .map((row) => ({
        hospitalId: row.hospital_id,
        nameBn: row.name_bn,
        nameEn: row.name_en,
        district: row.district,
        roles: [...row.roles].sort(),
        sessions: byHospital.get(row.hospital_id) ?? [],
      }))
      // A facility with nothing running today has no console worth opening.
      .filter((hospital) => hospital.sessions.length > 0)
      .sort((a, b) => runningFirst(b) - runningFirst(a))
  );
}

function runningFirst(hospital: { sessions: readonly DemoSessionRow[] }): number {
  return hospital.sessions.some((session) => session.status === 'running') ? 1 : 0;
}

/**
 * A real staff account at this hospital holding this role.
 *
 * Real, not invented: `queue_events.actor_staff_id` is a foreign key, so a
 * token minted for an id that does not exist produces a console whose every
 * action is refused by the database. `FR-QUE-04` — an unattributable queue
 * action cannot be recorded at all — is what makes that the right behaviour.
 */
export async function staffFor(
  hospitalId: string,
  role: string,
): Promise<{ readonly id: string; readonly fullName: string } | null> {
  const result = await sql<{ id: string; full_name: string }>`
    SELECT su.id, su.full_name
      FROM staff_users su
      JOIN staff_roles sr ON sr.staff_user_id = su.id
     WHERE su.hospital_id = ${hospitalId}::uuid
       AND sr.role = ${role}::staff_role
       AND su.deleted_at IS NULL
     ORDER BY su.full_name
     LIMIT 1
  `.execute(db);

  const row = result.rows[0];
  return row === undefined ? null : { id: row.id, fullName: row.full_name };
}
