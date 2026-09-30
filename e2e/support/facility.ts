/**
 * A facility with no seed data, for `hospital-settings.spec.ts` (pilot step 22).
 *
 * Made the way `pnpm staff:create` makes one — a hospital row with a code and
 * one administrator — and nothing else, because the spec's whole point is that
 * the rest comes from the settings screen. The one step here that a hospital
 * cannot do for itself is `pnpm doctor:verify` (`FR-SUP-02`), which is platform
 * staff checking the BMDC register; the spec does it the same way, in SQL.
 *
 * Everything carries the demo label (`FR-DEM-07`), and `removeFacility` takes
 * it all away again, so the demo database is left with its seeded six.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { hashPassword } from '../../backend/api/src/config/password.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

async function withClient<T>(body: (client: Client) => Promise<T>): Promise<T> {
  assertLocalDatabase();
  const client = new Client({
    connectionString: E2E_DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await client.connect();
  try {
    return await body(client);
  } finally {
    await client.end();
  }
}

export interface NewFacility {
  readonly hospitalId: string;
  readonly code: string;
  readonly adminEmail: string;
}

/** An empty, unpublished facility and its first administrator. */
export async function newFacility(password: string): Promise<NewFacility> {
  const hash = await hashPassword(password);
  const code = `E2E${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
  const adminEmail = `admin-${code.toLowerCase()}@settings.demo.invalid`;
  return await withClient(async (client) => {
    const hospital = await client.query<{ id: string }>(
      `INSERT INTO hospitals (name_bn, name_en, kind, division, district, code)
       VALUES ('নতুন হাসপাতাল (ডেমো)', 'New Hospital (Demo)', 'hospital', 'Dhaka', 'Dhaka', $1)
       RETURNING id`,
      [code],
    );
    const hospitalId = hospital.rows[0]?.id;
    if (hospitalId === undefined) throw new Error('hospitals returned no id');
    const admin = await client.query<{ id: string }>(
      `INSERT INTO staff_users (hospital_id, email, full_name, password_hash)
       VALUES ($1, $2, 'প্রশাসক (ডেমো)', $3) RETURNING id`,
      [hospitalId, adminEmail, hash],
    );
    await client.query(
      `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, $2, 'hospital_admin')`,
      [admin.rows[0]?.id, hospitalId],
    );
    return { hospitalId, code, adminEmail };
  });
}

/** One more account at the facility, with its own password already set (pilot step 28). */
export async function addStaffMember(
  hospitalId: string,
  role: string,
  password: string,
): Promise<{ readonly id: string; readonly email: string }> {
  const hash = await hashPassword(password);
  const email = `${role}-${randomUUID().slice(0, 8)}@settings.demo.invalid`;
  return await withClient(async (client) => {
    const staff = await client.query<{ id: string }>(
      `INSERT INTO staff_users (hospital_id, email, full_name, password_hash)
       VALUES ($1, $2, 'কর্মী (ডেমো)', $3) RETURNING id`,
      [hospitalId, email, hash],
    );
    const id = staff.rows[0]?.id;
    if (id === undefined) throw new Error('staff_users returned no id');
    await client.query(
      `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, $2, $3::staff_role)`,
      [id, hospitalId, role],
    );
    return { id, email };
  });
}

/** `pnpm doctor:verify`: platform staff, after checking the register (`FR-SUP-02`). */
export async function verifyDoctor(bmdcNumber: string): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `UPDATE doctors SET bmdc_verified_at = now() WHERE bmdc_number = $1 AND deleted_at IS NULL`,
      [bmdcNumber],
    );
  });
}

/** The chambers the facility's schedules made, as `YYYY-MM-DD`. */
export async function chamberDates(hospitalId: string): Promise<string[]> {
  return await withClient(async (client) => {
    const result = await client.query<{ day: string }>(
      `SELECT to_char(session_date, 'YYYY-MM-DD') AS day FROM sessions
        WHERE hospital_id = $1 AND template_id IS NOT NULL AND deleted_at IS NULL
        ORDER BY session_date`,
      [hospitalId],
    );
    return result.rows.map((row) => row.day);
  });
}

export async function bedStates(hospitalId: string): Promise<string[]> {
  return await withClient(async (client) => {
    const result = await client.query<{ state: string }>(
      `SELECT state::text AS state FROM beds WHERE hospital_id = $1 AND deleted_at IS NULL ORDER BY label`,
      [hospitalId],
    );
    return result.rows.map((row) => row.state);
  });
}

/** Removes everything the spec made at the facility, and the facility. */
export async function removeFacility(hospitalId: string): Promise<void> {
  await withClient(async (client) => {
    const ids = [hospitalId];
    await client.query(
      'DELETE FROM bookings WHERE session_id IN (SELECT id FROM sessions WHERE hospital_id = ANY($1::uuid[]))',
      [ids],
    );
    await client.query('DELETE FROM sessions WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM external_refs WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM import_batches WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM patients WHERE owner_hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM beds WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM wards WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query(
      `DELETE FROM session_templates WHERE doctor_hospital_id IN
         (SELECT id FROM doctor_hospitals WHERE hospital_id = ANY($1::uuid[]))`,
      [ids],
    );
    const doctors = await client.query<{ doctor_id: string }>(
      'SELECT DISTINCT doctor_id FROM doctor_hospitals WHERE hospital_id = ANY($1::uuid[])',
      [ids],
    );
    await client.query('DELETE FROM doctor_hospitals WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query(
      `DELETE FROM doctors d WHERE d.id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM doctor_hospitals dh WHERE dh.doctor_id = d.id)`,
      [doctors.rows.map((row) => row.doctor_id)],
    );
    await client.query('DELETE FROM departments WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM capabilities WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM audit_log WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query(
      `DELETE FROM sessions_auth WHERE subject_id IN
         (SELECT id FROM staff_users WHERE hospital_id = ANY($1::uuid[]))`,
      [ids],
    );
    await client.query('DELETE FROM staff_roles WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM hospital_settings WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM staff_users WHERE hospital_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM hospitals WHERE id = ANY($1::uuid[])', [ids]);
  });
}
