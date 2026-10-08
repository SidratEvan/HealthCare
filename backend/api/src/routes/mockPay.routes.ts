/**
 * The simulated provider's page (plan H3; BACKEND.md §8).
 *
 * Under `PAYMENT_PROVIDER=mock` with `MOCK_PAYMENT_FLOW=redirect` a charge
 * sends the patient here instead of to bKash or Nagad: a page that says, in
 * both languages, that it is a simulation, and offers pay, fail and cancel.
 * Each is a link (the API's policy allows no form) that records the outcome
 * and sends the browser back to the patient app's return page, which then
 * asks the server, as it would after a real provider (`FR-PAY-09`).
 *
 * Not mounted at all unless the mock is the provider; the mock itself is
 * refused in production (`env.ts`).
 */

import { Router } from 'express';
import { z } from 'zod';

import * as mockPay from '../controllers/mockPay.controller.js';
import { validate } from '../middleware/validate.js';

export const mockPayRoutes: Router = Router();

const params = z.object({ checkoutId: z.string().regex(/^mock_[0-9a-f-]{36}$/) });
const outcomeParams = params.extend({ outcome: z.enum(['paid', 'failed', 'cancelled']) });

mockPayRoutes.get('/mock-pay/:checkoutId', validate({ params }), mockPay.page);
mockPayRoutes.get(
  '/mock-pay/:checkoutId/:outcome',
  validate({ params: outcomeParams }),
  mockPay.settle,
);
