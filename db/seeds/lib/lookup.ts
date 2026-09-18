/**
 * Finding rows an earlier seed module wrote.
 *
 * Each module looks its dependencies up by a stable natural key rather than
 * receiving a bag of ids from the runner. Ids are UUID v7 generated
 * server-side (`DB-P9`), so they cannot be known in advance — and threading a
 * mutable context through eight modules would mean none of them could be read,
 * debugged or re-run on its own.
 *
 * The natural keys are the ones the declared demo set already has: a
 * facility's English name, a department's code, a doctor's `DEMO-…` BMDC
 * number, a staff member's `.invalid` email. All four are unique in the
 * schema, so a lookup that finds nothing is a missing seed rather than an
 * ambiguous match.
 */

import { DEMO_DOCTORS } from '../data/doctors.js';
import { DEMO_FACILITIES } from '../data/hospitals.js';

import { demoBmdc, labelEn } from './demo.js';

import type { Client } from 'pg';

/** Facility slug → `hospitals.id`. */
export async function facilityIds(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; name_en: string }>(
    'SELECT id, name_en FROM hospitals WHERE deleted_at IS NULL',
  );
  const byName = new Map(rows.map((row) => [row.name_en, row.id]));

  const ids = new Map<string, string>();
  for (const declared of DEMO_FACILITIES) {
    const id = byName.get(labelEn(declared.nameEn));
    if (id !== undefined) ids.set(declared.slug, id);
  }
  return ids;
}

/** `"<facility slug>:<department code>"` → `departments.id`. */
export async function departmentIds(client: Client): Promise<Map<string, string>> {
  const facilities = await facilityIds(client);
  const bySlug = new Map([...facilities].map(([slug, id]) => [id, slug]));

  const { rows } = await client.query<{ id: string; hospital_id: string; code: string }>(
    'SELECT id, hospital_id, code FROM departments WHERE deleted_at IS NULL',
  );

  const ids = new Map<string, string>();
  for (const row of rows) {
    const slug = bySlug.get(row.hospital_id);
    if (slug !== undefined) ids.set(`${slug}:${row.code}`, row.id);
  }
  return ids;
}

/** Doctor slug → `doctors.id`, keyed through the `DEMO-…` BMDC number. */
export async function doctorIds(client: Client): Promise<Map<string, string>> {
  const { rows } = await client.query<{ id: string; bmdc_number: string }>(
    'SELECT id, bmdc_number FROM doctors WHERE deleted_at IS NULL',
  );
  const byBmdc = new Map(rows.map((row) => [row.bmdc_number, row.id]));

  const ids = new Map<string, string>();
  for (const [index, declared] of DEMO_DOCTORS.entries()) {
    const id = byBmdc.get(demoBmdc(index + 1));
    if (id !== undefined) ids.set(declared.slug, id);
  }
  return ids;
}

/** A chamber row, with the keys the other modules need to reach it. */
export interface ChamberRow {
  readonly id: string;
  readonly doctorSlug: string;
  readonly hospitalSlug: string;
  readonly departmentCode: string;
  readonly doctorId: string;
  readonly hospitalId: string;
  readonly departmentId: string;
  readonly feePoisha: number;
  readonly room: string | null;
  readonly consultMinutes: number;
}

/** Every `doctor_hospitals` row the seeds wrote, in declaration order. */
export async function chambers(client: Client): Promise<ChamberRow[]> {
  const facilities = await facilityIds(client);
  const doctors = await doctorIds(client);
  const departments = await departmentIds(client);

  const { rows } = await client.query<{
    id: string;
    doctor_id: string;
    hospital_id: string;
    department_id: string;
    fee_poisha: number;
    room: string | null;
  }>(
    `SELECT id, doctor_id, hospital_id, department_id, fee_poisha, room
       FROM doctor_hospitals
      WHERE deleted_at IS NULL AND is_active`,
  );

  const found: ChamberRow[] = [];

  for (const declared of DEMO_DOCTORS) {
    const doctorId = doctors.get(declared.slug);
    if (doctorId === undefined) continue;

    for (const chamber of declared.chambers) {
      const hospitalId = facilities.get(chamber.hospitalSlug);
      const departmentId = departments.get(`${chamber.hospitalSlug}:${chamber.departmentCode}`);
      if (hospitalId === undefined || departmentId === undefined) continue;

      const row = rows.find(
        (candidate) =>
          candidate.doctor_id === doctorId &&
          candidate.hospital_id === hospitalId &&
          candidate.department_id === departmentId,
      );
      if (row === undefined) continue;

      found.push({
        id: row.id,
        doctorSlug: declared.slug,
        hospitalSlug: chamber.hospitalSlug,
        departmentCode: chamber.departmentCode,
        doctorId,
        hospitalId,
        departmentId,
        feePoisha: row.fee_poisha,
        room: row.room,
        consultMinutes: declared.consultMinutes,
      });
    }
  }

  return found;
}

/** The chamber a declared doctor sits in at a declared facility. */
export function chamberOf(
  rows: readonly ChamberRow[],
  doctorSlug: string,
  hospitalSlug: string,
): ChamberRow {
  const found = rows.find(
    (row) => row.doctorSlug === doctorSlug && row.hospitalSlug === hospitalSlug,
  );
  if (found === undefined) {
    throw new Error(`No seeded chamber for ${doctorSlug} at ${hospitalSlug}. Has seed_02 run?`);
  }
  return found;
}

/** Facility slug → the staff member who holds `role` there, if any. */
export async function staffByRole(client: Client, role: string): Promise<Map<string, string>> {
  const facilities = await facilityIds(client);
  const bySlug = new Map([...facilities].map(([slug, id]) => [id, slug]));

  const { rows } = await client.query<{ staff_user_id: string; hospital_id: string }>(
    `SELECT staff_user_id, hospital_id
       FROM staff_roles
      WHERE role = $1 AND deleted_at IS NULL
      ORDER BY created_at, staff_user_id`,
    [role],
  );

  const ids = new Map<string, string>();
  for (const row of rows) {
    const slug = bySlug.get(row.hospital_id);
    // First writer wins: the roster seeds counters in order, and the demo
    // wants a stable "which receptionist tapped next" rather than whichever
    // row the planner happened to return.
    if (slug !== undefined && !ids.has(slug)) ids.set(slug, row.staff_user_id);
  }
  return ids;
}
