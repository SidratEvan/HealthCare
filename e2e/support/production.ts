/**
 * What the production-configuration suite runs the API with
 * (`playwright.prod.config.ts`).
 *
 * In production the API does not read `.env` — a server is given its
 * environment, and a file on disk is not it (`backend/api/src/env.ts`). So
 * every value is stated here. They are the values of a hospital's own server
 * (`deploy/docker-compose.yml`): no demonstration mode, no online payment
 * until a merchant account exists, messages recorded rather than sent until an
 * aggregator exists, files on the local disk, and a database role that owns
 * nothing.
 *
 * Every secret below is obviously fake and exists only for this suite
 * (`FR-SEC-08`). They are also set on this process, because the specs sign
 * their own staff tokens with `signToken` and the API has to accept them.
 */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { E2E_DATABASE_URL } from './database.js';

/** The role the API connects as; made by `globalSetup.prod.ts`. */
export const E2E_API_ROLE = {
  name: 'healthcare_e2e_api',
  password: 'e2e-only-api-role-not-a-real-credential',
} as const;

const SECRETS = {
  JWT_ACCESS_SECRET: 'e2e-only-access-secret-not-a-real-credential',
  JWT_REFRESH_SECRET: 'e2e-only-refresh-secret-not-a-real-credential',
  GUEST_LINK_SECRET: 'e2e-only-guest-link-secret-not-a-real-credential',
  // 64 hex characters, as the key must be. All zeros and ones: not a key.
  TOTP_ENCRYPTION_KEY: '0101010101010101010101010101010101010101010101010101010101010101',
} as const;

function asApiRole(ownerUrl: string): string {
  const url = new URL(ownerUrl);
  url.username = E2E_API_ROLE.name;
  url.password = E2E_API_ROLE.password;
  return url.toString();
}

export const PRODUCTION_API_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'production',
  DEMO_MODE: 'false',
  PORT: '4000',
  DATABASE_URL: asApiRole(E2E_DATABASE_URL),
  DATABASE_POOL_MAX: '10',
  API_BASE_URL: 'http://localhost:4000',
  WEB_BASE_URL: 'http://localhost:3000',
  CONSOLE_BASE_URL: 'http://localhost:3100',
  ...SECRETS,
  STORAGE_PROVIDER: 'local',
  STORAGE_DIR: join(tmpdir(), 'healthcare-e2e-prod-files'),
  PAYMENT_PROVIDER: 'off',
  SMS_PROVIDER: 'log',
  TRAVEL_TIME_MODE: 'static',
  TRUST_PROXY_HOPS: '0',
  LOG_LEVEL: 'warn',
};

/**
 * Puts the suite's secrets on this process, ahead of the API's `env.ts`
 * reading the developer's `.env` — a variable already set always wins over
 * the file. Called from the configuration, which every worker loads first.
 */
export function useProductionSecrets(): void {
  for (const [key, value] of Object.entries(SECRETS)) {
    process.env[key] = value;
  }
}
