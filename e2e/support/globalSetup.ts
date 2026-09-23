/**
 * Rebuilds the demo data before the suite runs, then warms every route.
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
 *
 * ## Why it migrates first
 *
 * `db:reset` truncates and reseeds; it does not create what a new migration
 * adds. The unit and API suites build their databases from nothing, so a
 * step's migration is always there for them — and never here, until somebody
 * remembers to run it. Step 19 found it: every dashboard spec failed on a 500
 * because `v_admin_daily` did not exist in this database, while every other
 * suite was green. Migrating is additive and idempotent, so it runs every
 * time.
 *
 * ## Why the routes are visited first
 *
 * The apps run under `next dev`, which compiles a route the first time it is
 * requested. On this machine that is five or six seconds for a page, and a
 * spec whose first visit to a route happens *inside* an expectation spends its
 * ten-second budget waiting for webpack rather than for the product. Step 15
 * found it: `ward-board.spec.ts` waited on `/beds/request` for 10.8 s, 6 s of
 * which was the document compiling, and failed with the page one frame from
 * rendering. That is a flaky test (`CLAUDE.md` §6), and the fix is to take the
 * compile out of every spec at once rather than to raise one timeout.
 *
 * Playwright starts `webServer` before `globalSetup`, so the servers are up by
 * the time this runs.
 */

import { execFileSync } from 'node:child_process';

import { E2E_DATABASE_URL, assertLocalDatabase } from './database.js';

const PATIENT = 'http://localhost:3000';
const CONSOLE = 'http://localhost:3100';

/** Every page route the specs open. A new page belongs in this list. */
const ROUTES = [
  `${PATIENT}/`,
  `${PATIENT}/book`,
  `${PATIENT}/s`,
  `${PATIENT}/serials`,
  `${PATIENT}/records`,
  `${PATIENT}/profile`,
  `${PATIENT}/beds`,
  `${PATIENT}/beds/request`,
  `${PATIENT}/ambulance`,
  `${PATIENT}/blood`,
  `${PATIENT}/emergency`,
  `${PATIENT}/emergency/results`,
  `${PATIENT}/emergency/onway`,
  `${CONSOLE}/`,
];

export default async function globalSetup(): Promise<void> {
  // The guard in `database/scripts/lib/env.ts` decides on the host, so a
  // remote target needs saying out loud. Nothing here opts into one: these
  // specs truncate and reseed, and that is not something to do to a shared
  // database by accident.
  assertLocalDatabase();

  const env = { ...process.env, DATABASE_URL: E2E_DATABASE_URL, DEMO_MODE: 'true' };

  execFileSync('pnpm', ['db:migrate'], { stdio: 'inherit', shell: true, env });
  execFileSync('pnpm', ['db:reset'], { stdio: 'inherit', shell: true, env });

  // One at a time: compiling in parallel only makes each compile slower.
  for (const route of ROUTES) {
    const response = await fetch(route, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok) throw new Error(`Warming ${route} returned ${String(response.status)}.`);
    await response.arrayBuffer();
  }
}
