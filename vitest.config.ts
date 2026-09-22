import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests (BACKEND.md §11).
 *
 * Three projects, because they have different needs:
 *
 *   unit    pure functions — the queue reducer, ETA maths, replay determinism.
 *           No database, no network, runs anywhere.
 *   api     Supertest against the Express app: the auth matrix for every
 *           endpoint, the error envelope, the middleware chain. Needs a
 *           validated environment, and the database for readiness.
 *   schema  the migrations against a real PostgreSQL. Rebuilds the *_test
 *           database from scratch once per run, and each test isolates itself
 *           in a transaction it rolls back.
 *
 * Keeping them apart means a developer working on domain logic is never asked
 * for a database, and CI can report which layer broke.
 *
 * Playwright owns the end-to-end suite and is configured separately; it
 * arrives with the first user-visible flow.
 */
export default defineConfig({
  test: {
    // Playwright owns `e2e/`; vitest must not try to collect those specs.
    exclude: ['**/node_modules/**', '**/dist/**', 'e2e/**'],
    projects: [
      {
        test: {
          name: 'unit',
          include: ['shared/*/src/**/*.{test,spec}.ts'],
          environment: 'node',
          globals: false,
          restoreMocks: true,
          // shared/config ships configuration and will never have tests.
          passWithNoTests: true,
        },
      },
      {
        // The design system's components, rendered (FRONTEND.md §5).
        //
        // Separate from `unit` because these need a DOM and that costs a
        // second of startup — a developer working on the queue reducer should
        // never pay for jsdom. Separate from `api` because they need no
        // database.
        //
        // What is asserted here is behaviour and accessibility, not
        // appearance: roles, labels, focus order, keyboard handling, and an
        // axe pass. Tailwind classes are strings in this environment, so a
        // colour cannot be checked from here — `tokens.test.ts` and
        // `contrast.test.ts` cover the visual layer instead.
        test: {
          name: 'ui',
          include: ['shared/ui/src/**/*.{test,spec}.tsx'],
          environment: 'jsdom',
          setupFiles: ['shared/ui/src/__tests__/setup.ts'],
          globals: false,
          restoreMocks: true,
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'api',
          include: ['backend/*/src/**/*.{test,spec}.ts'],
          // Must run before any import: env.ts validates at module load.
          setupFiles: ['backend/api/src/__tests__/support/env.setup.ts'],
          // Its own database: this suite mutates the demo data, the schema
          // suite asserts on exact counts of it.
          globalSetup: ['database/tests/support/api-global-setup.ts'],
          // One database, shared, and — unlike the schema suite — mutated for
          // real: these tests go through the API, so a transaction cannot be
          // rolled back around them. Files therefore interfere through
          // anything counted per hospital: `emergency.routes.test.ts` opens
          // and closes cases at Shapla General while
          // `referral.routes.test.ts` asserts that one handover moved
          // Shapla's `er_active` by exactly one. Running the files one at a
          // time costs about thirty seconds on `pnpm test` and removes the
          // whole class; hunting for fixtures that happen not to collide
          // would leave it, and it fails once in several runs.
          //
          // One worker rather than `fileParallelism: false`, which vitest
          // applies to the whole run — the unit, ui and schema suites need no
          // such care and should keep their workers.
          maxWorkers: 1,
          environment: 'node',
          globals: false,
          restoreMocks: true,
          passWithNoTests: true,
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
      {
        test: {
          name: 'schema',
          include: ['database/tests/**/*.test.ts'],
          globalSetup: ['database/tests/support/global-setup.ts'],
          environment: 'node',
          globals: false,
          restoreMocks: true,
          passWithNoTests: true,
          // One database, shared. Transactions give isolation; a long-running
          // pg_sleep in a timestamp test should not fail a neighbour.
          testTimeout: 20_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
