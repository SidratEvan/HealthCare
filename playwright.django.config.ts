/**
 * The browser suites against the Django API (`docs/django-migration/PROGRESS.md`).
 *
 *   pnpm exec playwright test -c playwright.django.config.ts [spec]
 *
 * Everything is `playwright.config.ts`'s: the same specs, the same global
 * setup (the local database reset and reseeded), the same console and
 * patient app on `next dev`, `retries: 0`, one worker. One server differs:
 * the API on port 4000 is uvicorn serving `backend/django`, not
 * `pnpm dev:api`. The frontends do not know which answers them.
 *
 * The specs sign tokens with the API's secrets (`backend/api/src/config/jwt.ts`
 * reads them from the repository's `.env`), so the Django server is given the
 * same values. Its `DATABASE_URL` is set here, to the local database as the
 * API's own role, whatever `.env` says: the Supabase URL a `.env` may hold
 * never reaches it, and the Django API refuses a non-local database outside
 * production anyway.
 */

// First: local, throwaway values for whatever the environment does not set,
// before anything below reads it (a worktree has no `.env`).
import './e2e/support/djangoEnv.js';

import { defineConfig } from '@playwright/test';

import { asApiRole, assertLocalDatabase } from './e2e/support/database.js';
import base from './playwright.config.js';

// Merges the repository's `.env`, if any, into process.env as the Node API
// does, so the secrets the specs sign with are the ones this server is given.
import './backend/api/src/env.js';

assertLocalDatabase();

const API_URL = 'http://127.0.0.1:4000';

const nodeApi = Array.isArray(base.webServer) ? base.webServer[0] : undefined;
const frontends = Array.isArray(base.webServer) ? base.webServer.slice(1) : [];

const djangoEnv: Record<string, string> = {};
for (const [key, value] of Object.entries(process.env)) {
  if (typeof value === 'string') djangoEnv[key] = value;
}
Object.assign(djangoEnv, nodeApi?.env ?? {}, {
  DATABASE_URL: asApiRole(),
  PORT: '4000',
  PYTHONUNBUFFERED: '1',
});

export default defineConfig({
  ...base,
  webServer: [
    {
      command:
        process.platform === 'win32'
          ? '.venv\\Scripts\\python -m uvicorn medlive.asgi:application --host 127.0.0.1 --port 4000 --no-proxy-headers'
          : '.venv/bin/python -m uvicorn medlive.asgi:application --host 127.0.0.1 --port 4000 --no-proxy-headers',
      cwd: 'backend/django',
      url: `${API_URL}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: djangoEnv,
    },
    ...frontends,
  ],
});
