import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests (BACKEND.md §11).
 *
 * Two projects, because they have different needs:
 *
 *   unit    pure functions — the queue reducer, ETA maths, replay determinism.
 *           No database, no network, runs anywhere.
 *   schema  the migrations against a real PostgreSQL. Needs `docker compose up`,
 *           rebuilds the *_test database from scratch once per run, and each
 *           test isolates itself in a transaction it rolls back.
 *
 * Keeping them apart means a developer working on domain logic is never asked
 * for a database, and CI can report which layer broke.
 *
 * Playwright owns the end-to-end suite and is configured separately; it arrives
 * with the first user-visible flow.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.{test,spec}.ts'],
          environment: 'node',
          globals: false,
          restoreMocks: true,
          // packages/config ships configuration and will never have tests.
          passWithNoTests: true,
        },
      },
      {
        test: {
          name: 'schema',
          include: ['db/tests/**/*.test.ts'],
          globalSetup: ['db/tests/support/global-setup.ts'],
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
