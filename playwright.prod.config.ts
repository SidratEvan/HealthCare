/**
 * End-to-end configuration for **the production configuration**
 * (`pnpm test:e2e:prod`, `docs/PLATFORM_PLAN.md` 1.8).
 *
 * `playwright.config.ts` runs the demonstration: `next dev`, `DEMO_MODE=true`,
 * the API connected as the database's owner. That is what the pitch runs on
 * and it is the right thing to test for the pitch. It is not what a hospital
 * runs, and until this file existed nothing had ever driven a browser against
 * what a hospital runs:
 *
 *   the API      `NODE_ENV=production`, `DEMO_MODE=false`, started the way the
 *                container starts it, connected as the role that owns nothing
 *                (`DATABASE.md` §5.1), no online payment, SMS recorded only
 *   the console  `next build`, then `next start`
 *   the patient  `next build`, then `next start`
 *
 * What runs here is the product's one promise and the counter that keeps it:
 * the two-device canary in its production form (`e2e/production/`), and the
 * reception specs as they are — offline, undo, pause and resume, and the
 * console opening with no network.
 *
 * The same rules as the main suite: no retries, one worker, the seeded
 * database. A commit is green when `pnpm test:e2e`, `pnpm test:e2e:built` and
 * this are.
 *
 * Nothing else may be listening on 3000, 3100 or 4000: a `next dev` or a
 * demonstration API left running would be answered instead, and the run would
 * prove nothing about production. An existing server is never reused.
 */

import { defineConfig, devices } from '@playwright/test';

import { PRODUCTION_API_ENV, useProductionSecrets } from './e2e/support/production.js';

// Before any spec imports the API's `signToken`: the tokens the reception
// specs mint have to be signed with the secret this API was started with.
useProductionSecrets();
// What tells the shared helpers which way a receptionist gets into the
// console here: by signing in (`e2e/support/consoleSession.ts`).
process.env['E2E_CONFIGURATION'] = 'production';

const CONSOLE_URL = 'http://localhost:3100';
const PATIENT_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:4000';

const WEB_ENV = {
  NEXT_PUBLIC_API_URL: `${API_URL}/api/v1`,
  NEXT_PUBLIC_SOCKET_URL: API_URL,
};

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    // The canary, in the form the production configuration allows.
    'production/**/*.spec.ts',
    // The counter, unchanged: these specs are true of any configuration.
    'offline-console.spec.ts',
    'console-undo.spec.ts',
    'pause-resume.spec.ts',
    'built/**/*.spec.ts',
  ],
  // Two of the counter's tests are left to the main suite, and why:
  //  - the pitch session is the demonstration's own (`FR-DEM-06`): there is no
  //    picker here to open it from;
  //  - 'the next person at the same PC' puts a second person in the tab by
  //    hand. Under this configuration that needs a second account signed in,
  //    which the spec does not yet do.
  grepInvert: [/FR-DEM-06/, /the next person at the same PC/],
  globalSetup: './e2e/support/globalSetup.prod.ts',
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
      // As the container starts it (`Dockerfile`, plan I1): compiled to
      // JavaScript and run by node, with the shared packages resolved to
      // their own compiled output. Not `tsx`, and not `tsx watch`.
      command: 'pnpm build:api && pnpm --filter @platform/api start:compiled',
      // Liveness here, not readiness: the servers start before the global
      // setup that makes the API's role, so at this moment the API cannot
      // reach its database and is right to say it is not ready. The first
      // spec asks `/readyz` once the role exists (`e2e/production/`).
      url: `${API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: PRODUCTION_API_ENV,
    },
    {
      command: 'pnpm --filter @platform/console build && pnpm --filter @platform/console start',
      url: CONSOLE_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: WEB_ENV,
    },
    {
      command: 'pnpm --filter @platform/patient build && pnpm --filter @platform/patient start',
      url: PATIENT_URL,
      reuseExistingServer: false,
      timeout: 300_000,
      env: WEB_ENV,
    },
  ],
});
