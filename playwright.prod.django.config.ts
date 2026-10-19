/**
 * The production browser suite against the Django API
 * (`docs/django-migration/final-report.md`).
 *
 *   pnpm exec playwright test -c playwright.prod.django.config.ts
 *
 * Everything is `playwright.prod.config.ts`'s: the same specs, global setup,
 * built console and patient app, `DEMO_MODE=false`, the limited database
 * role and the production secrets. One server differs: the API on port 4000
 * is uvicorn serving `backend/django`, given the same `PRODUCTION_API_ENV`
 * the Node API is given there.
 */

// First: local, throwaway values for whatever the environment does not set,
// before anything below reads it (a worktree has no `.env`).
import './e2e/support/djangoEnv.js';

import { defineConfig } from '@playwright/test';

import { PRODUCTION_API_ENV } from './e2e/support/production.js';
import base from './playwright.prod.config.js';

// The defaults above include `NODE_ENV=development`, which the API servers of
// the other configurations want. Here the web apps are built, and `next build`
// under a development NODE_ENV prerenders with the wrong React and fails; it
// sets the value itself when none is given. The API is given its own below.
delete process.env['NODE_ENV'];

const API_URL = 'http://localhost:4000';

const frontends = Array.isArray(base.webServer) ? base.webServer.slice(1) : [];

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
      env: { ...PRODUCTION_API_ENV, PYTHONUNBUFFERED: '1' },
    },
    ...frontends,
  ],
});
