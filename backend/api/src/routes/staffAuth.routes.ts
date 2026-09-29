/**
 * `/staff/*` — staff sign-in (pilot step 21, BACKEND.md §7.1, `S-B-00`).
 *
 * `login` and `refresh` are public: the credential is in the body. The
 * per-account lockout is what stops a password being guessed; the per-address
 * limits here only stop one machine walking a list of accounts. They are
 * generous on purpose: every counter in a hospital usually reaches the server
 * from one public address, and a shift change is a hundred sign-ins at once.
 * Everything else needs the access token.
 *
 * The second factor (pilot step 28, FR-SEC-10): `POST /staff/2fa` is public
 * like `login` — its credential is the challenge `login` handed back, in the
 * body — and shares its limit. Setting one up needs the access token, which
 * for an administrator without one opens only these two (`attachPrincipal`).
 */

import { Router } from 'express';

import {
  staffLoginBody,
  staffPasswordBody,
  staffRefreshBody,
  staffTwoFactorBody,
  staffTwoFactorEnableBody,
} from '@platform/domain';

import * as staffAuth from '../controllers/staffAuth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { byIp, rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const staffAuthRoutes: Router = Router();

const signInLimit = rateLimit({ limit: 300, windowSeconds: 600, keyFor: byIp });
const refreshLimit = rateLimit({ limit: 2_000, windowSeconds: 600, keyFor: byIp });

staffAuthRoutes.post(
  '/staff/login',
  signInLimit,
  validate({ body: staffLoginBody }),
  staffAuth.login,
);
staffAuthRoutes.post(
  '/staff/refresh',
  refreshLimit,
  validate({ body: staffRefreshBody }),
  staffAuth.refresh,
);
staffAuthRoutes.post('/staff/logout', validate({ body: staffRefreshBody }), staffAuth.logout);
staffAuthRoutes.get('/staff/me', requireAuth, staffAuth.me);
staffAuthRoutes.post(
  '/staff/password',
  requireAuth,
  signInLimit,
  validate({ body: staffPasswordBody }),
  staffAuth.changePassword,
);
staffAuthRoutes.post(
  '/staff/2fa',
  signInLimit,
  validate({ body: staffTwoFactorBody }),
  staffAuth.secondFactor,
);
staffAuthRoutes.post('/staff/2fa/setup', requireAuth, signInLimit, staffAuth.twoFactorSetup);
staffAuthRoutes.post(
  '/staff/2fa/enable',
  requireAuth,
  signInLimit,
  validate({ body: staffTwoFactorEnableBody }),
  staffAuth.twoFactorEnable,
);
staffAuthRoutes.get('/staff/chambers', requireAuth, staffAuth.chambers);
