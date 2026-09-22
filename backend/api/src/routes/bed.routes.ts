/**
 * Bed routes (BACKEND.md §7.5).
 *
 * BACKEND.md §7.5 lists `admit`, `discharge`, `transfer`, `reserve` and `oos`.
 * The board needs four more to complete the state machine in
 * `shared/domain/src/beds/board.ts` — `release`, `restore`, `clean-start` and
 * `clean-done` — and one for `SEL-B06-EXPDIS`. Without `clean-done` a
 * discharged bed could never become free again, and without `restore` a bed
 * back from repair could never return to service. §7.5 is updated to list
 * them.
 *
 * ## Who may do what
 *
 * Reading the board is any staff role at the hospital: it names no patient,
 * and the ER coordinator reads bed counters from it (`APP_FLOW.md` B4: "read
 * from the bed board, not typed twice"). Changing a bed is the ward's job and
 * is recorded against the ward (`R5`, `FR-ROLE-01`). The bed panel and the
 * pending list name patients, so they are the ward's too, and audited.
 *
 * Every write takes an idempotency key: a ward console replays what it queued
 * offline (`FR-OFF-01`), and `bed_events.client_event_id` is what makes an
 * admit sent twice a patient admitted once.
 */

import { Router } from 'express';

import {
  admitBedBody,
  bedParams,
  bedRequestTokenParams,
  cleanDoneBody,
  cleanStartBody,
  createBedRequestBody,
  dischargeBedBody,
  expectedDischargeBody,
  hospitalBedsParams,
  outOfServiceBody,
  releaseBedBody,
  reserveBedBody,
  respondBedRequestBody,
  restoreBedBody,
  transferBedBody,
} from '@platform/domain';

import * as bed from '../controllers/bed.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireHospitalScope, requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const bedRoutes: Router = Router();

const write = idempotency({ required: true });
const ward = [requireAuth, requireRole('ward')];

// --- Reading ----------------------------------------------------------------

bedRoutes.get(
  '/hospitals/:id/beds',
  requireAuth,
  requireRole('ward', 'emergency', 'receptionist', 'doctor', 'hospital_admin'),
  requireHospitalScope('id'),
  validate({ params: hospitalBedsParams }),
  bed.getBoard,
);

bedRoutes.get('/beds/:id', ...ward, validate({ params: bedParams }), bed.getBed);

bedRoutes.get(
  '/hospitals/:id/bed-requests',
  ...ward,
  requireHospitalScope('id'),
  validate({ params: hospitalBedsParams }),
  bed.pendingRequests,
);

// --- Changing a bed ---------------------------------------------------------

bedRoutes.post(
  '/beds/:id/admit',
  ...ward,
  write,
  validate({ params: bedParams, body: admitBedBody }),
  bed.admit,
);
bedRoutes.post(
  '/beds/:id/discharge',
  ...ward,
  write,
  validate({ params: bedParams, body: dischargeBedBody }),
  bed.discharge,
);
bedRoutes.post(
  '/beds/:id/transfer',
  ...ward,
  write,
  validate({ params: bedParams, body: transferBedBody }),
  bed.transfer,
);
bedRoutes.post(
  '/beds/:id/reserve',
  ...ward,
  write,
  validate({ params: bedParams, body: reserveBedBody }),
  bed.reserve,
);
bedRoutes.post(
  '/beds/:id/release',
  ...ward,
  write,
  validate({ params: bedParams, body: releaseBedBody }),
  bed.release,
);
bedRoutes.post(
  '/beds/:id/clean-start',
  ...ward,
  write,
  validate({ params: bedParams, body: cleanStartBody }),
  bed.cleanStart,
);
bedRoutes.post(
  '/beds/:id/clean-done',
  ...ward,
  write,
  validate({ params: bedParams, body: cleanDoneBody }),
  bed.cleanDone,
);
bedRoutes.post(
  '/beds/:id/oos',
  ...ward,
  write,
  validate({ params: bedParams, body: outOfServiceBody }),
  bed.outOfService,
);
bedRoutes.post(
  '/beds/:id/restore',
  ...ward,
  write,
  validate({ params: bedParams, body: restoreBedBody }),
  bed.restore,
);
bedRoutes.post(
  '/beds/:id/expected-discharge',
  ...ward,
  write,
  validate({ params: bedParams, body: expectedDischargeBody }),
  bed.forecastDischarge,
);

// --- Bed requests (FR-PAT-52) -----------------------------------------------

/** Public: a family asks for a bed with name and phone, as a guest books. */
bedRoutes.post('/bed-requests', write, validate({ body: createBedRequestBody }), bed.createRequest);

/** Public: the signed token in the path is the credential. */
bedRoutes.get(
  '/bed-requests/track/:token',
  validate({ params: bedRequestTokenParams }),
  bed.trackRequest,
);

bedRoutes.post(
  '/bed-requests/:id/respond',
  ...ward,
  write,
  validate({ params: bedParams, body: respondBedRequestBody }),
  bed.respond,
);
