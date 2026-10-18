import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * The Node API suite, run against the Django server (`docs/django-migration/testing.md`).
 *
 *   pnpm exec vitest run -c vitest.django.config.ts [file filter]
 *
 * The same test files as the `api` project of `vitest.config.ts`, the same
 * environment and fixtures, one change: `../app.js` resolves to a shim whose
 * `createApp()` returns the Django server's address, so every supertest
 * request goes over HTTP to Django. The database is the Django run's own
 * (`healthcare_django_api_test`), built and served by the global setup.
 *
 * Seams keep the original assertions meaningful (all honoured by Django only
 * under NODE_ENV=test): each request carries the test's `Date.now()`, so a
 * faked clock moves the server's too, and the `env` values the test changed;
 * an SMS adapter a test installs receives the server's messages over a
 * loopback callback; `resetEmitter()` reads what the Django process broadcast. What still cannot be checked from here (spies on
 * Node services) is listed per file in the compatibility matrix.
 */
const appShim = fileURLToPath(new URL('./backend/django/tests/node_suite/app-shim.ts', import.meta.url));
const emitShim = fileURLToPath(new URL('./backend/django/tests/node_suite/emit-shim.ts', import.meta.url));
const smsShim = fileURLToPath(new URL('./backend/django/tests/node_suite/sms-shim.ts', import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^\.\.\/app\.js$/, replacement: appShim },
      { find: /^\.\.\/realtime\/emit\.js$/, replacement: emitShim },
      { find: /^\.\.\/adapters\/sms\.js$/, replacement: smsShim },
    ],
  },
  test: {
    name: 'api-django',
    include: ['backend/api/src/**/*.{test,spec}.ts'],
    setupFiles: [
      'backend/api/src/__tests__/support/env.setup.ts',
      'backend/api/src/__tests__/support/sender.setup.ts',
    ],
    globalSetup: ['backend/django/tests/node_suite/global-setup.ts'],
    env: {
      DATABASE_URL_API_TEST: 'postgresql://healthcare:healthcare@localhost:5432/healthcare_django_api_test',
      DJANGO_API_URL: 'http://127.0.0.1:4199',
    },
    maxWorkers: 1,
    environment: 'node',
    globals: false,
    restoreMocks: true,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
