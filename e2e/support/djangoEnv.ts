/**
 * The environment the browser suites run with against the Django API
 * (`playwright.django.config.ts`), set before anything reads it.
 *
 * Throwaway local values, as `backend/django/env/test.env` holds for the API
 * suite: secrets named as not real, and the local database. A value already
 * in the environment is kept, so a machine with its own `.env` signs with its
 * own. Nothing here points anywhere but this machine.
 */

const DEFAULTS: Readonly<Record<string, string>> = {
  NODE_ENV: 'development',
  API_BASE_URL: 'http://localhost:4000',
  WEB_BASE_URL: 'http://localhost:3000',
  CONSOLE_BASE_URL: 'http://localhost:3100',
  DATABASE_URL: 'postgresql://healthcare:healthcare@localhost:5432/healthcare_dev',
  JWT_ACCESS_SECRET: 'e2e-only-access-secret-not-a-real-credential',
  JWT_REFRESH_SECRET: 'e2e-only-refresh-secret-not-a-real-credential',
  GUEST_LINK_SECRET: 'e2e-only-guest-link-secret-not-a-real-credential',
  TOTP_ENCRYPTION_KEY: 'e2e-only-totp-key-not-a-real-credential-0123456789',
  SMS_PROVIDER: 'log',
  PAYMENT_PROVIDER: 'mock',
  TRAVEL_TIME_MODE: 'static',
  STORAGE_PROVIDER: 'mock',
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  process.env[key] ??= value;
}

export {};
