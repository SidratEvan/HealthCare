import { defineConfig } from 'vitest/config';

/**
 * Unit and integration tests (BACKEND.md §11).
 *
 * Every test runs against seeded demo data rather than fixtures scattered
 * through test files (CLAUDE.md §6); the seeds arrive with step 5.
 * Playwright owns the end-to-end suite and is configured separately.
 */
export default defineConfig({
  test: {
    include: ['{apps,packages,db}/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'e2e/**'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    // packages/config ships configuration and will never have tests; a
    // workspace without a spec must not fail the run.
    passWithNoTests: true,
    reporters: process.env['CI'] === 'true' ? ['default', 'github-actions'] : ['default'],
  },
});
