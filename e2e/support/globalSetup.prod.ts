/**
 * Global setup for the production-configuration suite
 * (`playwright.prod.config.ts`, `pnpm test:e2e:prod`).
 *
 * The same disposable database as the main suite, rebuilt the same way —
 * seeded demonstration data, because that is the only data there is
 * (`FR-SEC-08`). What differs is everything around it: the API runs with
 * `NODE_ENV=production` and `DEMO_MODE=false`, and it connects as the role a
 * hospital's server gives it, not as the owner. So that role is made here, by
 * the owner, exactly as `pnpm db:role` makes it on a server
 * (`database/scripts/lib/role.ts`).
 *
 * No routes are warmed: both apps are built, and a built page has nothing to
 * compile.
 */

import { Client } from 'pg';

import { ensureApiRole } from '../../database/scripts/lib/role.js';

import { E2E_DATABASE_URL } from './database.js';
import { prepareDatabase } from './globalSetup.js';
import { E2E_API_ROLE } from './production.js';

export default async function globalSetup(): Promise<void> {
  prepareDatabase();

  const owner = new Client({
    connectionString: E2E_DATABASE_URL,
    options: '-c search_path=public,extensions',
  });
  await owner.connect();
  try {
    await ensureApiRole(owner, E2E_API_ROLE);
  } finally {
    await owner.end();
  }
}
