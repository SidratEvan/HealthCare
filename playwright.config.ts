/**
 * End-to-end configuration (CLAUDE.md §6, FRONTEND.md §9).
 *
 * Five specs are required by CLAUDE.md §6, and one of them —
 * `two-device-queue.spec.ts` — is the product's canary and may never be
 * skipped or marked flaky. That rule shapes this file:
 *
 *   - **`retries: 0`, everywhere, including CI.** "A flaky test is a bug. Fix
 *     it or delete the flakiness; never retry-loop around it." A retry budget
 *     is exactly the mechanism by which a flaky canary keeps passing while the
 *     thing it watches quietly breaks.
 *   - **`workers: 1`.** These specs drive a shared database and a shared
 *     session; running them in parallel would have them fighting over the same
 *     queue, and the failures would look like flakiness rather than
 *     interference.
 *
 * The servers are started by `webServer` rather than by hand, so `pnpm
 * test:e2e` is one command on a clean machine — which is what makes it
 * something a person actually runs before a demo.
 */

import { defineConfig, devices } from '@playwright/test';

import { asApiRole } from './e2e/support/database.js';

/** The three servers these specs drive. */
const CONSOLE_URL = 'http://localhost:3100';
const PATIENT_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

/**
 * The local container, never Supabase.
 *
 * These specs write queue events and cannot clean up after themselves —
 * `queue_events` is append-only (`DB-P1`). Pointed at a shared database they
 * would leave a trail through somebody else's demo.
 *
 * Resolved in `e2e/support/database.ts` so that the servers started here and
 * the fixtures the specs use cannot end up on different databases — which is
 * exactly what happened while this was a second, independent copy of the URL.
 */
// As the API's own role, which the tenant policies bind, and not as the
// owner, which they do not (`e2e/support/database.ts`, migration 0043).
const DATABASE_URL = asApiRole();

export default defineConfig({
  testDir: './e2e',

  // `e2e/built/` runs against the console as built, not against `next dev`
  // (`playwright.built.config.ts`, `pnpm test:e2e:built`). Both are the gate.
  testIgnore: ['**/built/**', '**/production/**'],

  /**
   * Rebuild the demo data first (`FR-DEM-06`).
   *
   * These specs assert on the seeded mid-queue session, and `queue_events` is
   * append-only — a previous run cannot undo what it did. Starting from a
   * known state is what makes the suite deterministic rather than
   * order-dependent.
   */
  globalSetup: './e2e/support/globalSetup.ts',
  // A queue action crossing a socket takes a moment; a whole offline shift
  // replaying takes several. Generous per test, strict overall.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,

  reporter: process.env['CI'] === 'true' ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: CONSOLE_URL,
    // A failure in the two-device test is the one worth being able to watch
    // afterwards, so the trace and the video survive it.
    //
    // Not the trace in CI. `retain-on-failure` records every test and throws
    // the recording away if it passed, and the recorder keeps what it has
    // seen: the worker grows by about 18 MB a test and stands at 6.7 GB by the
    // last of 150 (`docs/STATUS.md`, measured). This machine survives that by
    // growing its page file; a hosted runner with 7 GB does not. So in CI a
    // failure keeps its video, its screenshot and the page as it stood, and
    // the step-by-step trace is what is given up. Nothing that is asserted
    // changes. The canary's own step runs first and alone, where a trace would
    // cost nothing — it is still off there, so that one run is one setting.
    trace: process.env['CI'] === 'true' ? 'off' : 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: [
    {
      command: 'pnpm dev:api',
      url: `${API_URL}/healthz`,
      reuseExistingServer: process.env['CI'] !== 'true',
      timeout: 120_000,
      env: {
        DATABASE_URL,
        DEMO_MODE: 'true',
        NODE_ENV: 'development',
        // This machine is the platform (`FR-BRD-07`): `padma.localhost` is
        // Padma's portal, as `padma.<the platform's domain>` is on a server.
        PLATFORM_DOMAIN: 'localhost',
        // Every patient in this suite books from this one machine, and the API
        // limits what one address may do: thirty phone checks in ten minutes.
        // A runner fast enough to fit the thirty-first into that window had
        // five bookings refused (the first CI run, 3 October; `docs/STATUS.md`
        // decision 90) — correctly, by a limit that was never meant to count a
        // hundred and fifty people as one. This says what the machine is. The
        // limits themselves are tested where they belong, at their defaults
        // (`middleware.test.ts`).
        ADDRESS_RATE_LIMIT_FACTOR: '100',
      },
    },
    {
      command: 'pnpm dev:console',
      url: CONSOLE_URL,
      reuseExistingServer: process.env['CI'] !== 'true',
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
        NEXT_PUBLIC_SOCKET_URL: API_URL,
      },
    },
    {
      command: 'pnpm dev:patient',
      url: PATIENT_URL,
      reuseExistingServer: process.env['CI'] !== 'true',
      timeout: 180_000,
      env: {
        NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
        NEXT_PUBLIC_SOCKET_URL: API_URL,
        // The same domain the API was given, so the app reads a portal's
        // address the way the server does (`e2e/portal-address.spec.ts`).
        NEXT_PUBLIC_PLATFORM_DOMAIN: 'localhost',
        // A hospital's own domain, as that spec maps one to this machine.
        DEV_PORTAL_HOSTS: 'portal.hospital-own.test',
      },
    },
  ],
});
