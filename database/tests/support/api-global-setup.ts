/**
 * Builds the API suite's database once per `pnpm test` run.
 *
 * Lives in this workspace rather than in `backend/api` because the migration
 * runner and the seeds live here, and a global setup reaching across a
 * workspace boundary by relative path puts files outside the API's `rootDir`.
 *
 * Why it is a separate database at all: see `build.ts`.
 */

import { resolveApiTestDatabaseUrl } from '../../scripts/lib/env.js';

import { buildTestDatabase } from './build.js';

export default async function setup(): Promise<void> {
  await buildTestDatabase(resolveApiTestDatabaseUrl(), 'API test');
}
