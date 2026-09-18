/**
 * Determines the environment for API tests, before any module is imported.
 *
 * `env.ts` validates at module load and refuses to start when a required key
 * is missing — which is the behaviour production depends on, and which means a
 * test that imports anything touching the environment needs one already in
 * place. Running as a vitest `setupFile` puts this ahead of every import in
 * the test file.
 *
 * These values are assigned rather than defaulted, and that is deliberate.
 * Vitest loads the repository's `.env` into `process.env`, so without an
 * outright assignment two things happen: the blank `JWT_ACCESS_SECRET` in
 * `.env.example` counts as "already set" and fails validation, and — far
 * worse — `DATABASE_URL` still points at `healthcare_dev` and the API suite
 * quietly runs against the developer's demo data.
 *
 * So the test environment is decided here and nowhere else. The one thing a
 * developer may override is which test database to use, through
 * `DATABASE_URL_TEST`, which is the same variable the schema suite honours.
 *
 * Every secret below is obviously fake and obviously test-only (FR-SEC-08).
 */

/** Chosen by the schema suite's resolver, so both suites share one database. */
const testDatabaseUrl =
  process.env['DATABASE_URL_TEST'] ??
  'postgresql://healthcare:healthcare@localhost:5432/healthcare_test';

if (!/_test(\?|$)/.test(testDatabaseUrl)) {
  throw new Error(
    `Refusing to run the API suite against "${testDatabaseUrl}": the database name must end in _test.`,
  );
}

const TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  PORT: '4099',
  API_BASE_URL: 'http://localhost:4099',
  WEB_BASE_URL: 'http://localhost:3000',

  DATABASE_URL: testDatabaseUrl,
  DATABASE_POOL_MAX: '5',

  // Long enough to satisfy the 32-character floor, and unmistakably not real.
  JWT_ACCESS_SECRET: 'test-only-access-secret-not-a-real-credential',
  JWT_REFRESH_SECRET: 'test-only-refresh-secret-not-a-real-credential',
  GUEST_LINK_SECRET: 'test-only-guest-link-secret-not-a-real-credential',

  SMS_PROVIDER: 'log',
  PAYMENT_PROVIDER: 'mock',
  TRAVEL_TIME_MODE: 'static',
  LOG_LEVEL: 'error',
  DEMO_MODE: 'true',
};

for (const [key, value] of Object.entries(TEST_ENV)) {
  process.env[key] = value;
}
