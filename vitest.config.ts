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
        test: {
          name: 'api',
          include: ['backend/*/src/**/*.{test,spec}.ts'],
          // Must run before any import: env.ts validates at module load.
          setupFiles: ['backend/api/src/__tests__/support/env.setup.ts'],
          // Its own database: this suite mutates the demo data, the schema
          // suite asserts on exact counts of it.
          globalSetup: ['database/tests/support/api-global-setup.ts'],
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
