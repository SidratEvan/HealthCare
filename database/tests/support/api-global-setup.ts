/**
 * Builds the API suite's database once per `pnpm test` run.
 *
 * Lives in this workspace rather than in `backend/api` because the migration
 * runner and the seeds live here, and a global setup reaching across a
 * workspace boundary by relative path puts files outside the API's `rootDir`.
 *
 * Why it is a separate database at all: see `build.ts`.
 *
 * ## The suite runs as the API's role, not as the owner
 *
 * The database is built by the owner, as a deployment's is. Then the role the
 * API connects as on a hospital's server is created (`scripts/lib/role.ts`),
 * and `env.setup.ts` points the API at it. So every endpoint's test is also a
 * test that the endpoint works without owning anything — a query that needs
 * more than rows fails here, not on the first server it is deployed to
 * (`docs/PLATFORM_PLAN.md` 1.7).
 */

import { Client } from 'pg';

import { PG_CONNECTION_OPTIONS, resolveApiTestDatabaseUrl } from '../../scripts/lib/env.js';
import { ensureApiRole } from '../../scripts/lib/role.js';

import { buildTestDatabase } from './build.js';

/**
 * The same two values `backend/api/src/__tests__/support/env.setup.ts` builds
 * its connection string from. Obviously fake, and test-only (`FR-SEC-08`).
 */
export const API_TEST_ROLE = {
  name: 'healthcare_api',
  password: 'test-only-api-role-not-a-real-credential',
} as const;

export default async function setup(): Promise<void> {
  const connectionString = resolveApiTestDatabaseUrl();
  await buildTestDatabase(connectionString, 'API test');

  const owner = new Client({ connectionString, options: PG_CONNECTION_OPTIONS });
  await owner.connect();
  try {
    await ensureApiRole(owner, API_TEST_ROLE);
  } finally {
    await owner.end();
  }
}
