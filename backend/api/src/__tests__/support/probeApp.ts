/**
 * A minimal Express app for exercising the middleware chain.
 *
 * Step 3 has only the health probes, which are public — so the auth matrix
 * needs guarded routes to test against. Building them here rather than adding
 * test-only routes to `app.ts` keeps the shipped surface honest: a route that
 * exists only for a test is a route an attacker can also reach.
 *
 * The middleware is the real middleware and the error handler is the real
 * error handler, so what these tests exercise is production code arranged the
 * way `app.ts` arranges it.
 */

import express, { json, type Express, type RequestHandler } from 'express';

import type { NationalRole, StaffRole } from '@platform/domain';

import { attachPrincipal, requireAuth } from '../../middleware/auth.js';
import { errorHandler, notFoundHandler } from '../../middleware/error.js';
import { attachGuestFromLink, requireBookingScope } from '../../middleware/guestAuth.js';
import { idempotency } from '../../middleware/idempotency.js';
import { requestLog } from '../../middleware/requestLog.js';
import {
  requireHospitalScope,
  requireNationalRole,
  requireOwner,
  requireRole,
} from '../../middleware/requireRole.js';

/** Echoes the principal, so a test can assert on who the chain identified. */
const whoami: RequestHandler = (req, res) => {
  res.json({ ok: true, data: { principal: req.principal ?? null } });
};

/**
 * Builds an app with `guards` applied to `/probe`.
 *
 * The chain before the route matches `app.ts` exactly.
 */
export function probeApp(guards: readonly RequestHandler[] = []): Express {
  const app = express();

  app.set('trust proxy', false);
  app.use(requestLog);
  app.use(json({ limit: '256kb' }));
  app.use(attachPrincipal);
  app.use(attachGuestFromLink);
  app.use(idempotency());

  app.get('/probe', ...guards, whoami);
  app.post('/probe', ...guards, whoami);
  app.get('/probe/hospital/:hospitalId', ...guards, whoami);
  app.get('/probe/booking/:bookingId', ...guards, whoami);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

/** Pre-built apps for the cases the matrix covers. */
export const apps = {
  /** No guard at all: emergency search, hospital browse (GR-08). */
  public: (): Express => probeApp(),
  /** Any authenticated caller. */
  authenticated: (): Express => probeApp([requireAuth]),
  /** One role. */
  role: (...roles: StaffRole[]): Express => probeApp([requireAuth, requireRole(...roles)]),
  /** A role, scoped to the hospital in the path. */
  hospitalScoped: (...roles: StaffRole[]): Express =>
    probeApp([requireAuth, requireRole(...roles), requireHospitalScope()]),
  /** A national role: no hospital at all (`FR-ROLE-01`, step 20). */
  national: (...roles: NationalRole[]): Express =>
    probeApp([requireAuth, requireNationalRole(...roles)]),
  /** A patient or guest acting on their own booking. */
  owner: (): Express => probeApp([requireAuth, requireOwner()]),
  /** A tracking link, scoped to one booking (FR-GST-05). */
  bookingScoped: (): Express => probeApp([requireAuth, requireBookingScope()]),
};
