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

/** The console. The patient app joins it at step 9. */
const CONSOLE_URL = 'http://localhost:3100';
const API_URL = 'http://localhost:4000';

/**
 * The local container, never Supabase.
 *
 * These specs write queue events and cannot clean up after themselves —
 * `queue_events` is append-only (`DB-P1`). Pointed at a shared database they
 * would leave a trail through somebody else's demo.
 */
const DATABASE_URL = 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev';

export default defineConfig({
  testDir: './e2e',

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
    trace: 'retain-on-failure',
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
  ],
});
