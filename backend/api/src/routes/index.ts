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

import { adminRoutes } from './admin.routes.js';
import { bedRoutes } from './bed.routes.js';
import { bookingRoutes } from './booking.routes.js';
import { clinicalRoutes } from './clinical.routes.js';
import { consentRoutes } from './consent.routes.js';
import { demoRoutes } from './demo.routes.js';
import { discoveryRoutes } from './discovery.routes.js';
import { emergencyRoutes } from './emergency.routes.js';
import { guestRoutes } from './guest.routes.js';
import { healthRoutes } from './health.routes.js';
import { labRoutes } from './lab.routes.js';
import { paymentRoutes } from './payment.routes.js';
import { queueRoutes } from './queue.routes.js';
import { referralRoutes } from './referral.routes.js';
import { standbyRoutes } from './standby.routes.js';
import { syncRoutes } from './sync.routes.js';
import { webhookRoutes } from './webhooks.routes.js';

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
  // Also public: the token in the path is the credential (`FR-GST-05`).
  router.use(guestRoutes);
  // Public, and only while `DEMO_MODE` is on: how the console gets a
  // principal without a password (CLAUDE.md §4.1).
  router.use(demoRoutes);
  router.use(bookingRoutes);
  router.use(queueRoutes);
  // The patient's half of the standby list (`FR-PAT-25`…`27`): joining is
  // public like a guest booking, and the status token in the path answers
  // everything after it.
  router.use(standbyRoutes);
  // Records: the one router whose permission lives in the service rather than
  // the route, because `FR-DOC-10` is a relationship and not a role.
  router.use(clinicalRoutes);
  // Consent is the patient's side of the same records (`FR-PAT-63`, `-64`).
  router.use(consentRoutes);
  // The bed board (step 14). `POST /bed-requests` and its tracking read are
  // public, like a guest booking; everything else is the ward's.
  router.use(bedRoutes);
  // Emergency (step 15). Search, "I'm on my way" and the family's status
  // page need nobody (`GR-08`); the ER console is the coordinator's.
  router.use(emergencyRoutes);
  // Referrals between ERs (step 16): the coordinator's, at either end.
  router.use(referralRoutes);
  // The lab and the pharmacy (step 17). The medicine availability search is
  // public; everything else belongs to a bench or a counter.
  router.use(labRoutes);
  // Money (step 18). Paying is the patient's, refunding and settling the
  // administrator's.
  router.use(paymentRoutes);
  // The dashboard (step 19). No hospital in the path: these reads answer
  // everything about a facility at once, so the scope comes off the principal
  // and a caller cannot name a facility at all.
  router.use(adminRoutes);
  // Provider callbacks. No token, because a provider has none of ours — the
  // signature is the authentication, and it is checked before anything else.
  router.use(webhookRoutes);
  router.use(syncRoutes);
  return router;
}
