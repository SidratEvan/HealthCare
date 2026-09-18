/**
 * Route mounting (BACKEND.md §3, §7).
 *
 * Base path `/api/v1`. Every response is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message, details } }` — no endpoint returns a
 * bare array or a bare object, so a client has one shape to parse and one
 * place to look for a failure.
 *
 * The routers named in BACKEND.md §3 arrive with the steps that build them:
 * auth and guest in step 4, discovery and booking in steps 6 and 9, queue in
 * step 6, and so on. Each brings its own auth-matrix tests.
 */

import { Router } from 'express';

import { healthRoutes } from './health.routes.js';

/** Version prefix for everything a client calls. */
export const API_BASE_PATH = '/api/v1';

/** Probes, mounted at the root rather than under the version prefix. */
export const rootRoutes: Router = healthRoutes;

/**
 * The versioned API.
 *
 * Empty of endpoints until step 4. It is mounted now so that the middleware
 * chain, the error envelope and the 404 handler are exercised by tests before
 * any real endpoint depends on them.
 */
export function buildApiRouter(): Router {
  const router = Router();
  return router;
}
