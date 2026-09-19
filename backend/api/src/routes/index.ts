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

import { bookingRoutes } from './booking.routes.js';
import { discoveryRoutes } from './discovery.routes.js';
import { healthRoutes } from './health.routes.js';
import { queueRoutes } from './queue.routes.js';
import { syncRoutes } from './sync.routes.js';

/** Version prefix for everything a client calls. */
export const API_BASE_PATH = '/api/v1';

/** Probes, mounted at the root rather than under the version prefix. */
export const rootRoutes: Router = healthRoutes;

/**
 * The versioned API.
 *
 * The queue router arrived with step 6 and is the first real one. Discovery,
 * booking and the rest follow with their steps; each brings its own auth
 * matrix tests.
 */
export function buildApiRouter(): Router {
  const router = Router();
  // Public first: discovery is the only unauthenticated surface, and mounting
  // it ahead of the guarded routers keeps that visible at a glance.
  router.use(discoveryRoutes);
  router.use(bookingRoutes);
  router.use(queueRoutes);
  router.use(syncRoutes);
  return router;
}
