/** Synthetic reception desks built from the canonical seeded doctors/patients.
 * No prototype state, clinical invention or remote database (FR-DEM-07/SEC-08).
 */
import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { createConsoleSession, type ConsoleSession } from './console.js';
import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';
import { addStaffMember, newFacility } from './facility.js';
import { DEMO_PASSWORD, staffWithRoles } from './staff.js';

export async function receptionFixture(
  count: number,
  opening: 'scheduled' | 'in-chamber' | 'overdue' = 'in-chamber',
): Promise<{
  readonly staff: { id: string; email: string; hospitalId: string | null };
  readonly code: string;
  readonly deskId: string;
  readonly sessions: readonly ConsoleSession[];
}> {
  assertLocalDatabase();
  const facility = await newFacility(DEMO_PASSWORD);
  const staff = await staffWithRoles(facility.code, ['receptionist']);
  await addStaffMember(facility.hospitalId, 'doctor', DEMO_PASSWORD);
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  let doctors: string[];
  const deskId = randomUUID();
  try {
    await client.query(
      "UPDATE hospitals SET lifecycle='active',onboarded_at=now(),is_live=true WHERE id=$1",
      [facility.hospitalId],
    );
    const rows = await client.query<{
      doctor_id: string;
      code: string;
      name_bn: string;
      name_en: string | null;
      fee_poisha: number;
      default_consult_minutes: number;
    }>(
      `SELECT DISTINCT ON(d.id) d.id AS doctor_id, dep.code, dep.name_bn, dep.name_en,
          dh.fee_poisha, d.default_consult_minutes FROM doctors d
       JOIN doctor_hospitals dh ON dh.doctor_id=d.id
       JOIN departments dep ON dep.id=dh.department_id
       WHERE d.bmdc_verified_at IS NOT NULL AND d.deleted_at IS NULL AND dh.deleted_at IS NULL
       ORDER BY d.id LIMIT $1`,
      [count],
    );
    if (rows.rows.length !== count) throw new Error('Not enough canonical seeded doctors');
    for (const row of rows.rows) {
      await client.query(
        `INSERT INTO departments(hospital_id,code,name_bn,name_en)
        SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM departments WHERE hospital_id=$1 AND code=$2)`,
        [facility.hospitalId, row.code, row.name_bn, row.name_en],
      );
      await client.query(
        `INSERT INTO doctor_hospitals(doctor_id,hospital_id,department_id,fee_poisha)
        SELECT $1,$2,id,$4 FROM departments WHERE hospital_id=$2 AND code=$3`,
        [row.doctor_id, facility.hospitalId, row.code, row.fee_poisha],
      );
    }
    doctors = rows.rows.map((row) => row.doctor_id);
    await client.query(
      'INSERT INTO reception_desks(id,hospital_id,name_bn,name_en) VALUES($1,$2,$3,$4)',
      [deskId, facility.hospitalId, 'রিসেপশন ডেস্ক (ডেমো)', 'Reception desk (Demo)'],
    );
    await client.query(
      'INSERT INTO reception_desk_staff(desk_id,staff_user_id,hospital_id) VALUES($1,$2,$3)',
      [deskId, staff.id, facility.hospitalId],
    );
    for (const id of doctors)
      await client.query(
        'INSERT INTO reception_desk_doctors(desk_id,doctor_id,hospital_id) VALUES($1,$2,$3)',
        [deskId, id, facility.hospitalId],
      );
  } finally {
    await client.end();
  }
  const sessions: ConsoleSession[] = [];
  for (const [i, doctorId] of doctors.entries())
    sessions.push(
      await createConsoleSession(4, opening, {
        hospitalId: facility.hospitalId,
        doctorId,
        room: `Review ${i + 1} (Demo)`,
      }),
    );
  return { staff, code: facility.code, deskId, sessions };
}

export async function secondReceptionist(code: string, deskId: string): Promise<{ email: string }> {
  assertLocalDatabase();
  const staff = await staffWithRoles(code, ['receptionist']);
  const client = new Client({ connectionString: E2E_DATABASE_URL });
  await client.connect();
  try {
    await client.query(
      'INSERT INTO reception_desk_staff(desk_id,staff_user_id,hospital_id) VALUES($1,$2,$3)',
      [deskId, staff.id, staff.hospitalId],
    );
  } finally {
    await client.end();
  }
  return staff;
}
