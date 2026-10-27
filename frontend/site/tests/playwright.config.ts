import { defineConfig, devices } from '@playwright/test';

/** Isolated company presentation: no API, database or clinical test setup. */
export default defineConfig({
  testDir: '.',
  testMatch: 'site.spec.ts',
  outputDir: '../test-results',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:3210',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node scripts/preview-static.mjs',
    cwd: '..',
    url: 'http://localhost:3210/bn',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
