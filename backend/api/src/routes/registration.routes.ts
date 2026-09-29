/**
 * `/registration/*` — finding and registering a patient at the counter
 * (pilot step 23, `S-B-03`, `MOD-B02-WALKIN`, `FR-REC-20`, `FR-GST-13`).
 *
 * The receptionist's. Adding the registered patient to a chamber is the
 * queue's own `POST /sessions/:id/walkin` (`FR-REC-14`), so the serial is
 * issued under the session lock like every other.
 */

import { Router } from 'express';

import { registerPatientBody, registrationLookupQuery } from '@platform/domain';

import * as registration from '../controllers/registration.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const registrationRoutes: Router = Router();

const reception = [requireAuth, requireRole('receptionist')];

registrationRoutes.get(
  '/registration/patients',
  ...reception,
  validate({ query: registrationLookupQuery }),
  registration.lookup,
);

registrationRoutes.post(
  '/registration/patients',
  ...reception,
  idempotency({ required: true }),
  validate({ body: registerPatientBody }),
  registration.register,
);
