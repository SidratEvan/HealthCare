/**
 * Emergency routes (BACKEND.md §7.5).
 *
 * ## Who may do what
 *
 * **Search and "I'm on my way" need nobody** (`GR-08`, `FR-GST-03`,
 * `APP_FLOW.md` D3: "not even a phone number"). They are public, and the alert
 * is rate-limited per address instead — an anonymous route that rings a
 * hospital's ER is one somebody will try to ring a hundred times.
 *
 * **The family's status page** is the signed case token in the path, as the
 * SMS tracking link is (`FR-GST-05`).
 *
 * **The ER console is the emergency coordinator's** (`R6`, `FR-ROLE-01`). A
 * hospital administrator may also read the board and set capabilities —
 * BACKEND.md §7.5 gives `PUT /hospitals/:id/capabilities` to "emergency,
 * admin" — but acting on a case is the ER's.
 *
 * Every console write takes an idempotency key: the console replays what it
 * queued offline (`FR-OFF-01`).
 */

import { Router } from 'express';

import {
  acknowledgeBody,
  capabilitiesBody,
  caseCommandBody,
  emergencyCaseParams,
  emergencySearchQuery,
  emergencyTokenParams,
  hospitalEmergencyParams,
  inboundBody,
  walkInBody,
} from '@platform/domain';

import * as emergency from '../controllers/emergency.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { byIp, rateLimit } from '../middleware/rateLimit.js';
import { requireHospitalScope, requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const emergencyRoutes: Router = Router();

const write = idempotency({ required: true });
const er = [requireAuth, requireRole('emergency')];

/**
 * Ten alerts per address per ten minutes. A family that sends one, cancels,
 * and sends to the next hospital uses two; a script ringing ERs is stopped
 * at the eleventh. Recorded in `docs/STATUS.md` as a number nobody has
 * measured.
 */
const alertLimit = rateLimit({ limit: 10, windowSeconds: 600, keyFor: byIp });

// --- Public (`S-A-10`, `S-A-10b`, `S-A-10c`) --------------------------------

emergencyRoutes.get(
  '/emergency/search',
  validate({ query: emergencySearchQuery }),
  emergency.search,
);

emergencyRoutes.post(
  '/emergency/inbound',
  alertLimit,
  write,
  validate({ body: inboundBody }),
  emergency.inbound,
);

emergencyRoutes.get(
  '/emergency/track/:token',
  validate({ params: emergencyTokenParams }),
  emergency.track,
);

emergencyRoutes.post(
  '/emergency/track/:token/cancel',
  validate({ params: emergencyTokenParams }),
  emergency.cancel,
);

// --- The ER console (`S-B-07`) ------------------------------------------------

emergencyRoutes.get(
  '/hospitals/:id/emergency',
  requireAuth,
  requireRole('emergency', 'hospital_admin'),
  requireHospitalScope('id'),
  validate({ params: hospitalEmergencyParams }),
  emergency.board,
);

emergencyRoutes.get(
  '/emergency/cases/:id/contact',
  ...er,
  validate({ params: emergencyCaseParams }),
  emergency.contact,
);

emergencyRoutes.post(
  '/emergency/cases',
  ...er,
  write,
  validate({ body: walkInBody }),
  emergency.walkIn,
);

emergencyRoutes.post(
  '/emergency/cases/:id/acknowledge',
  ...er,
  write,
  validate({ params: emergencyCaseParams, body: acknowledgeBody }),
  emergency.acknowledge,
);

emergencyRoutes.patch(
  '/emergency/cases/:id',
  ...er,
  write,
  validate({ params: emergencyCaseParams, body: caseCommandBody }),
  emergency.update,
);

emergencyRoutes.put(
  '/hospitals/:id/capabilities',
  requireAuth,
  requireRole('emergency', 'hospital_admin'),
  requireHospitalScope('id'),
  write,
  validate({ params: hospitalEmergencyParams, body: capabilitiesBody }),
  emergency.capabilities,
);
