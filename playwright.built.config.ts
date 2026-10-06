/**
 * End-to-end configuration for the specs that need the console **as built**
 * (`e2e/built/`, `pnpm test:e2e:built`).
 *
 * `playwright.config.ts` drives the apps through `next dev`, which is what
 * makes a change visible in seconds. Some things are only true of the build a
 * hospital runs, and the first of them is opening the console with no network
 * (`FR-OFF-01`): the development client will not start the app until it has
 * heard from its dev server, so an offline reload can never be shown there.
 *
 * So this is the same suite's rules — no retries, one worker, the seeded demo
 * database — over `next build` and `next start`. It is part of the gate, not
 * an extra: a commit is green when `pnpm test:e2e` **and** `pnpm
 * test:e2e:built` are.
 *
 * The console is served on its usual port, because the API answers exactly two
 * browser origins (`middleware/cors.ts`) and a test is not a reason to add a
 * third. Nothing else may be listening there: a `next dev` left running on
 * 3100 would be the development client again, so an existing server is never
 * reused.
 */

import { defineConfig, devices } from '@playwright/test';

import { asApiRole } from './e2e/support/database.js';

const CONSOLE_URL = 'http://localhost:3100';
const API_URL = 'http://localhost:4000';

export default defineConfig({
  testDir: './e2e/built',
  globalSetup: './e2e/support/globalSetup.built.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,

  reporter: process.env['CI'] === 'true' ? [['github'], ['list']] : [['list']],

  use: {
    baseURL: CONSOLE_URL,
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
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: asApiRole(),
        DEMO_MODE: 'true',
        NODE_ENV: 'development',
      },
    },
    {
      // Built, then served: the two steps a deployment takes.
      command: 'pnpm --filter @platform/console build && pnpm --filter @platform/console start',
      url: CONSOLE_URL,
      reuseExistingServer: false,
      // A cold build of the console is about a minute on a small machine.
      timeout: 300_000,
      env: {
        NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
        NEXT_PUBLIC_SOCKET_URL: API_URL,
      },
    },
  ],
});
