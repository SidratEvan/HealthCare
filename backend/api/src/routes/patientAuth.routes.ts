/**
 * A patient's phone sign-in (pilot step 25, BACKEND.md §7.1, `FR-PAT-01`,
 * `FR-SEC-05`), their profiles, and claiming what their number holds
 * (`FR-GST-09`).
 *
 * The code routes are public — the phone is the credential being proved —
 * and limited per address on top of the per-number limits in the service: a
 * number is protected from being flooded, and an address from walking a list
 * of numbers.
 */

import { Router } from 'express';

import {
  claimBody,
  guestStartBody,
  guestVerifyBody,
  otpRequestBody,
  otpVerifyBody,
  patientRefreshBody,
} from '@platform/domain';

import * as patientAuth from '../controllers/patientAuth.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { byIp, rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const patientAuthRoutes: Router = Router();

const sendLimit = rateLimit({
  limit: 30,
  windowSeconds: 600,
  keyFor: byIp,
  code: 'AUTH_OTP_RATE_LIMIT',
});
const verifyLimit = rateLimit({
  limit: 60,
  windowSeconds: 600,
  keyFor: byIp,
  code: 'AUTH_OTP_RATE_LIMIT',
});
const refreshLimit = rateLimit({ limit: 2_000, windowSeconds: 600, keyFor: byIp });

patientAuthRoutes.post(
  '/auth/otp',
  sendLimit,
  validate({ body: otpRequestBody }),
  patientAuth.requestCode,
);
patientAuthRoutes.post(
  '/auth/verify',
  verifyLimit,
  validate({ body: otpVerifyBody }),
  patientAuth.verify,
);
patientAuthRoutes.post(
  '/auth/refresh',
  refreshLimit,
  validate({ body: patientRefreshBody }),
  patientAuth.refresh,
);
patientAuthRoutes.post('/auth/logout', validate({ body: patientRefreshBody }), patientAuth.logout);

// A guest's one phone check before a booking (FR-GST-03, FR-GST-12).
patientAuthRoutes.post(
  '/guest/start',
  sendLimit,
  validate({ body: guestStartBody }),
  patientAuth.startGuest,
);
patientAuthRoutes.post(
  '/guest/verify',
  verifyLimit,
  validate({ body: guestVerifyBody }),
  patientAuth.verifyGuest,
);

patientAuthRoutes.get('/me/profiles', requireAuth, patientAuth.profiles);
patientAuthRoutes.post(
  '/guest/claim',
  requireAuth,
  idempotency({ required: true }),
  validate({ body: claimBody }),
  patientAuth.claim,
);
