/**
 * The platform's side of onboarding (`S-B-12`, `PRD.md` §14c `FR-ONB-*`).
 *
 * ## `requireNationalRole('platform_admin')` on every route
 *
 * A platform administrator belongs to no hospital (`FR-ROLE-01`), so the token
 * is a `national` principal and every hospital route already refuses it. This
 * is the other half: no hospital's staff, an administrator included, reaches
 * anything here. A hospital cannot approve itself, and cannot see who else is
 * on the platform.
 *
 * A government viewer is national too and is refused as well: reading
 * aggregates and deciding which hospitals are listed are different jobs.
 *
 * Nothing under this prefix returns a patient, a booking or a record
 * (`FR-ONB-08`).
 */

import { Router } from 'express';

import {
  agreementBody,
  applicationBody,
  emptyBody,
  lifecycleNoteBody,
  modulesBody,
  platformDoctorParams,
  portalDomainBody,
  settingsIdParams,
  workspaceBody,
} from '@platform/domain';

import * as platform from '../controllers/platform.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { byIp, rateLimit } from '../middleware/rateLimit.js';
import { requireNationalRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const platformRoutes: Router = Router();

const admin = [requireAuth, requireNationalRole('platform_admin')];
const write = idempotency({ required: true });

/**
 * `POST /hospital-applications` — a hospital applies by itself (`FR-ONB-09`).
 *
 * The one route here that is nobody's: no account exists yet. It makes a
 * workspace that is setting up and its first administrator, and nothing
 * public. Limited by address, a handful an hour: a hospital applies once.
 */
const applicationLimit = rateLimit({ limit: 5, windowSeconds: 3_600, keyFor: byIp });

platformRoutes.post(
  '/hospital-applications',
  applicationLimit,
  write,
  validate({ body: applicationBody }),
  platform.postApplication,
);
const byId = { params: settingsIdParams };

platformRoutes.get('/platform/hospitals', ...admin, platform.listWorkspaces);
platformRoutes.get('/platform/hospitals/:id', ...admin, validate(byId), platform.getWorkspace);

platformRoutes.post(
  '/platform/hospitals',
  ...admin,
  write,
  validate({ body: workspaceBody }),
  platform.postWorkspace,
);

// Going live is asked for by the hospital (`POST /hospital/request-review`)
// and answered here (`FR-ONB-04`).
platformRoutes.post(
  '/platform/hospitals/:id/approve',
  ...admin,
  write,
  validate({ ...byId, body: lifecycleNoteBody }),
  platform.postAct('approve'),
);
platformRoutes.post(
  '/platform/hospitals/:id/send-back',
  ...admin,
  write,
  validate({ ...byId, body: lifecycleNoteBody }),
  platform.postAct('send_back'),
);

// `FR-ONB-06`: out of every public surface at once, and back.
platformRoutes.post(
  '/platform/hospitals/:id/suspend',
  ...admin,
  write,
  validate({ ...byId, body: lifecycleNoteBody }),
  platform.postAct('suspend'),
);
platformRoutes.post(
  '/platform/hospitals/:id/reinstate',
  ...admin,
  write,
  validate({ ...byId, body: lifecycleNoteBody }),
  platform.postAct('reinstate'),
);
platformRoutes.post(
  '/platform/hospitals/:id/close',
  ...admin,
  write,
  validate({ ...byId, body: lifecycleNoteBody }),
  platform.postAct('close'),
);

// `FR-ONB-05`, `FR-SUP-02`: the register has been checked.
platformRoutes.post(
  '/platform/hospitals/:id/doctors/:doctorId/verify',
  ...admin,
  write,
  validate({ params: platformDoctorParams, body: emptyBody }),
  platform.postVerifyDoctor,
);

// A domain the hospital owns, recorded as its portal's address (`FR-BRD-07`).
// The platform's to record: the whole deployment answers for it from then on.
platformRoutes.post(
  '/platform/hospitals/:id/domain',
  ...admin,
  write,
  validate({ ...byId, body: portalDomainBody }),
  platform.postPortalDomain,
);

// The modules a hospital runs (`FR-BRD-11`, `FR-SUP-03`): the whole list of
// what is off. The platform's to switch, since it follows what was agreed.
platformRoutes.put(
  '/platform/hospitals/:id/modules',
  ...admin,
  write,
  validate({ ...byId, body: modulesBody }),
  platform.putModules,
);

// Where a hospital's agreement stands (`FR-SUP-04`, the state half): trial,
// active, overdue or ended, and a note. A record: no plan, no amount, and
// nothing is switched by it.
platformRoutes.put(
  '/platform/hospitals/:id/agreement',
  ...admin,
  write,
  validate({ ...byId, body: agreementBody }),
  platform.putAgreement,
);
