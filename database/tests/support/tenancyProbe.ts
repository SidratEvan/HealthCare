/**
 * The role `tenancy.test.ts` asks the policies as (`FR-SEC-11`, migration
 * 0043): rows only, no bypass, a member of `app_tenant` — what the API's own
 * role is on a hospital's server (`scripts/lib/role.ts`).
 *
 * Its rights are given once, by the suite's global setup, before any test
 * runs. Given inside each test they were a change to every table's catalogue
 * row, made while other files changed the same rows (a materialised view
 * refreshed, a truncate refused), and PostgreSQL answers that with "tuple
 * concurrently updated": the suite failed once in a few runs for a reason
 * that was not in the test.
 */

import { Client } from 'pg';

import { PG_CONNECTION_OPTIONS } from '../../scripts/lib/env.js';

export const TENANCY_PROBE_ROLE = 'tenancy_probe';

export async function ensureTenancyProbe(connectionString: string): Promise<void> {
  const client = new Client({ connectionString, options: PG_CONNECTION_OPTIONS });
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${TENANCY_PROBE_ROLE}') THEN
          CREATE ROLE ${TENANCY_PROBE_ROLE} NOLOGIN NOBYPASSRLS;
        END IF;
      END
      $$;
    `);
    await client.query(`GRANT app_tenant TO ${TENANCY_PROBE_ROLE}`);
    await client.query(`GRANT USAGE ON SCHEMA public, extensions TO ${TENANCY_PROBE_ROLE}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${TENANCY_PROBE_ROLE}`,
    );
  } finally {
    await client.end();
  }
}
