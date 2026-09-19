/**
 * Rebuilds the demo data before the suite runs.
 *
 * `FR-DEM-06`: "A seed script can reset the demo to a known state in one
 * command, including a session mid-queue ready for the pitch." These specs
 * assert on that state — one patient in the chamber, the rest waiting — and
 * `queue_events` is append-only, so a previous run cannot undo what it did.
 * Without this, the suite passes once and then fails on the session it
 * consumed, which is indistinguishable from flakiness.
 *
 * Resetting here rather than asking a developer to remember is what makes
 * `pnpm test:e2e` one command on a clean machine.
 */

import { execFileSync } from 'node:child_process';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

export default function globalSetup(): void {
  // The guard in `database/scripts/lib/env.ts` decides on the host, so a
  // remote target needs saying out loud. Nothing here opts into one: these
  // specs truncate and reseed, and that is not something to do to a shared
  // database by accident.
  assertLocalDatabase();

  execFileSync('pnpm', ['db:reset'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DEMO_MODE: 'true' },
  });
}
