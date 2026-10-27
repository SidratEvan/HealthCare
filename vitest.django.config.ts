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
 * an SMS adapter, payment provider or mapping provider a test installs answers the server's
 * calls over a loopback callback; `counter.reset()` empties the server's rate
 * limiter too, as does each new test file; a heartbeat a test records reaches
 * the server's; `resetEmitter()` reads what the Django process broadcast. What still cannot be checked from here (spies on
 * Node services) is listed per file in the compatibility matrix.
 */
const appShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/app-shim.ts', import.meta.url),
);
const emitShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/emit-shim.ts', import.meta.url),
);
const smsShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/sms-shim.ts', import.meta.url),
);
const realtimeServerShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/realtime-server-shim.ts', import.meta.url),
);
const paymentsShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/payments-shim.ts', import.meta.url),
);
const queueServiceShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/queue-service-shim.ts', import.meta.url),
);
const notificationServiceShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/notification-service-shim.ts', import.meta.url),
);
const rateLimitShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/ratelimit-shim.ts', import.meta.url),
);
const mappingShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/mapping-shim.ts', import.meta.url),
);
const modulesServiceShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/modules-service-shim.ts', import.meta.url),
);
const heartbeatShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/heartbeat-shim.ts', import.meta.url),
);
const portalServiceShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/portal-service-shim.ts', import.meta.url),
);
const realtimeAuthShim = fileURLToPath(
  new URL('./backend/django/tests/node_suite/realtime-auth-shim.ts', import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      { find: /^\.\.\/app\.js$/, replacement: appShim },
      { find: /^\.\.\/realtime\/emit\.js$/, replacement: emitShim },
      { find: /^\.\.\/adapters\/sms\.js$/, replacement: smsShim },
      { find: /^\.\.\/adapters\/mapping\.js$/, replacement: mappingShim },
      { find: /^\.\.\/adapters\/payments\/index\.js$/, replacement: paymentsShim },
      { find: /^\.\.\/realtime\/server\.js$/, replacement: realtimeServerShim },
      { find: /^\.\.\/realtime\/auth\.js$/, replacement: realtimeAuthShim },
      { find: /^\.\.\/middleware\/rateLimit\.js$/, replacement: rateLimitShim },
      { find: /^\.\.\/services\/heartbeat\.service\.js$/, replacement: heartbeatShim },
      { find: /^\.\.\/services\/modules\.service\.js$/, replacement: modulesServiceShim },
      { find: /^\.\.\/services\/portal\.service\.js$/, replacement: portalServiceShim },
      { find: /^\.\.\/services\/queue\.service\.js$/, replacement: queueServiceShim },
      {
        find: /^(?:\.\.\/){1,2}services\/notification\.service\.js$/,
        replacement: notificationServiceShim,
      },
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
      DATABASE_URL_API_TEST:
        process.env['DATABASE_URL_DJANGO_TEST'] ??
        'postgresql://healthcare:healthcare@localhost:5432/healthcare_django_api_test',
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
