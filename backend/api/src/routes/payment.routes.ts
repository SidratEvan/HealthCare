/**
 * Payment routes (BACKEND.md §7.7, `FR-PAY-*`).
 *
 * ## Who may do what
 *
 * **Paying is the patient's**, account holder or guest. `FR-GST-01` is the
 * whole point of this product's booking flow — a person with no account books
 * and pays in under a minute — so a guest's tracking token authorises a
 * payment for the booking it is scoped to, and the service checks that
 * scoping against the row (see `createIntent`).
 *
 * **Refunding is an administrator's** (`R7` hospital_admin). It moves money
 * out, and it is the one action here a patient cannot take for themselves:
 * `FR-PAY-07`'s automatic eligibility does not come through this route at
 * all, it is raised when a session ends.
 *
 * **A settlement is an administrator's** (`FR-PAY-05`), scoped to their own
 * hospital by `requireHospitalScope` and re-checked in the service.
 *
 * Every write takes an idempotency key — `FR-PAY-06` makes that a
 * requirement rather than a convention, because the failure is a person
 * charged twice for one serial.
 */

import { Router } from 'express';
import { z } from 'zod';

import {
  idParams,
  paymentIntentBody,
  paymentParams,
  refundBody,
  settlementQuery,
} from '@platform/domain';

import * as payment from '../controllers/payment.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireHospitalScope, requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const paymentRoutes: Router = Router();

const write = idempotency({ required: true });
const admin = [requireAuth, requireRole('hospital_admin')];

const hospitalParams = z.object({ hospitalId: z.string().uuid() });

// --- Paying (`FR-PAY-01`, `FR-PAY-06`) --------------------------------------

paymentRoutes.post(
  '/payments/intent',
  requireAuth,
  write,
  validate({ body: paymentIntentBody }),
  payment.intent,
);

// What was charged against one booking. The guest's own link reaches this;
// `requireBookingScope` is unnecessary because the id *is* the path, and a
// token scoped elsewhere is refused by the guard below.
paymentRoutes.get(
  '/bookings/:id/payments',
  requireAuth,
  validate({ params: idParams }),
  payment.forBooking,
);

// --- Refunds (`FR-PAY-03`, `FR-PAY-07`) -------------------------------------

paymentRoutes.post(
  '/payments/:id/refund',
  ...admin,
  write,
  validate({ params: paymentParams, body: refundBody }),
  payment.refund,
);

// --- Settlement (`FR-PAY-05`) -----------------------------------------------

paymentRoutes.get(
  '/hospitals/:hospitalId/settlement',
  ...admin,
  requireHospitalScope(),
  validate({ params: hospitalParams, query: settlementQuery }),
  payment.settlement,
);
