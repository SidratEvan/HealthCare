import { defineConfig, devices } from '@playwright/test';

/** Isolated company presentation: no API, database or clinical test setup. */
export default defineConfig({
  testDir: '.',
  testMatch: 'landing.spec.ts',
  outputDir: '../test-results',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3200',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'pnpm --filter @platform/site start',
    url: 'http://localhost:3200/bn',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
