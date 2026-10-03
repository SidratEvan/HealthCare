/**
 * Staff accounts for `staff-login.spec.ts` (pilot step 21).
 *
 * The seeded accounts all sign in with the documented demo password
 * (`DEMO_STAFF_PASSWORD`); an account whose password an administrator set is
 * made here, with the API's own hashing, because the seeds give nobody a
 * temporary password and the flow is about what happens to one.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';

import { hashPassword } from '../../backend/api/src/config/password.js';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

/** `DEMO_STAFF_PASSWORD` in `database/seeds/lib/demo.ts`. */
export const DEMO_PASSWORD = 'demo-password-2026';

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

/** A seeded receptionist at a facility, by its code — never one a test made. */
export async function seededReceptionist(
  code: string,
): Promise<{ email: string; hospitalId: string }> {
  return await withClient(async (client) => {
    const result = await client.query<{ email: string; hospital_id: string }>(
      `SELECT su.email, su.hospital_id
         FROM staff_users su
         JOIN hospitals h ON h.id = su.hospital_id
         JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.role = 'receptionist'
        WHERE h.code = $1 AND su.deleted_at IS NULL
          -- Seeded accounts carry an ID-card code; the ones this spec makes do not.
          AND su.staff_code IS NOT NULL
        ORDER BY su.email LIMIT 1`,
      [code],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error(`No seeded receptionist at ${code} (FR-DEM-01).`);
    return { email: row.email, hospitalId: row.hospital_id };
  });
}

/** A new receptionist whose password an administrator set. */
export async function staffWithTemporaryPassword(
  code: string,
  password: string,
): Promise<{ email: string }> {
  const hash = await hashPassword(password);
  return await withClient(async (client) => {
    const email = `e2e-${randomUUID().slice(0, 8)}@${code.toLowerCase()}.demo.invalid`;
    const inserted = await client.query<{ id: string; hospital_id: string }>(
      `INSERT INTO staff_users (hospital_id, email, full_name, password_hash, must_change_password)
       SELECT id, $2, 'নতুন রিসেপশন (ডেমো)', $3, true FROM hospitals WHERE code = $1
       RETURNING id, hospital_id`,
      [code, email, hash],
    );
    const row = inserted.rows[0];
    if (row === undefined) throw new Error(`No facility with code ${code}.`);
    await client.query(
      `INSERT INTO staff_roles (staff_user_id, hospital_id, role) VALUES ($1, $2, 'receptionist')`,
      [row.id, row.hospital_id],
    );
    return { email };
  });
}

/**
 * A seeded receptionist at a facility, by its id — the facility a fixture's
 * chamber happens to be in, which the spec does not choose.
 */
export async function seededReceptionistAt(hospitalId: string): Promise<{ email: string }> {
  return await withClient(async (client) => {
    const result = await client.query<{ email: string }>(
      `SELECT su.email
         FROM staff_users su
         JOIN staff_roles sr ON sr.staff_user_id = su.id AND sr.role = 'receptionist'
        WHERE su.hospital_id = $1 AND su.deleted_at IS NULL
          AND su.staff_code IS NOT NULL
        ORDER BY su.email LIMIT 1`,
      [hospitalId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error('No seeded receptionist at that facility (FR-DEM-01).');
    return { email: row.email };
  });
}
