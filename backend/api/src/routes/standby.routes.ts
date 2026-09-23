/**
 * The patient's half of the standby list (`FR-PAT-25`, `FR-PAT-26`,
 * `FR-PAT-27`; `BTN-A06D-STANDBY`, `S-A-08s`).
 *
 * All public, as a guest booking is: joining needs a name and a phone, and
 * everything after it is answered by the signed status token in the path —
 * one place on one list, useless for anything else. Reception's half
 * (`GET /sessions/:id/standby`, `POST /bookings/:id/offer-slot`,
 * `POST /offers/:id/accept`) stays in `queue.routes.ts` behind a staff role.
 */

import { Router } from 'express';

import {
  acceptStandbyOfferBody,
  joinStandbyBody,
  sessionParams,
  standbyAnswerBody,
  standbyTokenParams,
} from '@platform/domain';

import * as standby from '../controllers/standby.controller.js';
import { idempotency } from '../middleware/idempotency.js';
import { byIp, rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';

export const standbyRoutes: Router = Router();

const write = idempotency({ required: true });

/**
 * Ten joins per address per ten minutes. A family putting two relatives on
 * two lists uses two; a script filling a chamber's list with strangers is
 * stopped at the eleventh. A number nobody has measured, like the ER alert's.
 */
const joinLimit = rateLimit({ limit: 10, windowSeconds: 600, keyFor: byIp });

standbyRoutes.post(
  '/sessions/:id/standby',
  joinLimit,
  write,
  validate({ params: sessionParams, body: joinStandbyBody }),
  standby.join,
);

standbyRoutes.get('/standby/:token', validate({ params: standbyTokenParams }), standby.status);

standbyRoutes.post(
  '/standby/:token/accept',
  write,
  validate({ params: standbyTokenParams, body: acceptStandbyOfferBody }),
  standby.accept,
);

standbyRoutes.post(
  '/standby/:token/decline',
  write,
  validate({ params: standbyTokenParams, body: standbyAnswerBody }),
  standby.decline,
);

standbyRoutes.post(
  '/standby/:token/leave',
  write,
  validate({ params: standbyTokenParams, body: standbyAnswerBody }),
  standby.leave,
);
