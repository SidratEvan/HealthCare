/**
 * What `gov-dashboard.spec.ts` needs to know about the seeded database.
 *
 * Two questions, both asked of the rows rather than hard-coded: which district
 * a fixture chamber is in, and every name the national layer must never show
 * (`FR-GOV-04`, `FR-GOV-06`) — so a spec that looks for them on the screen is
 * looking for the real ones.
 */

import { Client } from 'pg';

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

/** The district a facility is in, as `hospitals.district` stores it. */
export async function districtOf(hospitalId: string): Promise<string> {
  return await withClient(async (client) => {
    const { rows } = await client.query<{ district: string }>(
      'SELECT district FROM hospitals WHERE id = $1',
      [hospitalId],
    );
    const district = rows[0]?.district;
    if (district === undefined) throw new Error(`No hospital ${hospitalId}.`);
    return district;
  });
}

/** Every facility name, both languages, and a sample of patients' names. */
export async function namesThatMustNotAppear(): Promise<string[]> {
  return await withClient(async (client) => {
    const facilities = await client.query<{ name_bn: string; name_en: string }>(
      'SELECT name_bn, name_en FROM hospitals',
    );
    const patients = await client.query<{ full_name: string }>(
      'SELECT full_name FROM patients ORDER BY full_name LIMIT 40',
    );
    return [
      ...facilities.rows.flatMap((row) => [row.name_bn, row.name_en]),
      ...patients.rows.map((row) => row.full_name),
    ];
  });
}
