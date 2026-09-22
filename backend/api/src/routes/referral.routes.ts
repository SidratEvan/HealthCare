/**
 * Referral routes (BACKEND.md §7.5, `FR-EMG-07..09`).
 *
 * ## Who may do what
 *
 * **Only an ER coordinator** (`R6`: "refer out"; `FR-ROLE-01`), and only for a
 * referral their own hospital is a party to. Which side a coordinator is on
 * decides which steps are theirs — the receiving ER sees, answers and records
 * the arrival, the sending ER withdraws — and that is the service's guard
 * (`canActOnReferral`), because it depends on the row.
 *
 * Every write takes an idempotency key: both consoles replay what they queued
 * offline (`FR-OFF-01`). A send's key is stored on the referral; every other
 * step is replay-safe by the referral's own state.
 */

import { Router } from 'express';

import {
  referralActionBody,
  referralDeclineBody,
  referralParams,
  referralSendBody,
} from '@platform/domain';

import * as referral from '../controllers/referral.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const referralRoutes: Router = Router();

const write = idempotency({ required: true });
const er = [requireAuth, requireRole('emergency')];
const step = [...er, write, validate({ params: referralParams, body: referralActionBody })];

referralRoutes.post(
  '/referrals',
  ...er,
  write,
  validate({ body: referralSendBody }),
  referral.send,
);

referralRoutes.post('/referrals/:id/seen', ...step, referral.seen);
referralRoutes.post('/referrals/:id/accept', ...step, referral.accept);
referralRoutes.post(
  '/referrals/:id/decline',
  ...er,
  write,
  validate({ params: referralParams, body: referralDeclineBody }),
  referral.decline,
);
referralRoutes.post('/referrals/:id/cancel', ...step, referral.cancel);
referralRoutes.post('/referrals/:id/arrive', ...step, referral.arrive);
