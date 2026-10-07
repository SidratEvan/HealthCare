/**
 * `/hospital/*` — a facility's own setup (pilot step 22, BACKEND.md §7.7,
 * `S-B-11`, `FR-SUP-01`, `FR-ADM-11`).
 *
 * Every route is the hospital administrator's, and every one acts on the
 * administrator's own facility — there is no hospital id in any path to
 * tamper with (`FR-ROLE-01`). Every write takes an idempotency key; the
 * guarantee against a doubled create is the schema's own unique indexes
 * (a department's code, a doctor's BMDC number, a bed's label, an email),
 * which answer a replay with `SETTINGS_DUPLICATE`.
 *
 * Capabilities come in two halves. Which kinds this facility offers is set
 * here (`PUT /hospital/capabilities`); whether each is available right now
 * is the ER's `PUT /hospitals/:id/capabilities` (§7.5), which refuses a kind
 * the facility never declared.
 */

import { json, Router } from 'express';

import {
  bedPatchBody,
  bedsBody,
  brandBody,
  logoBody,
  publishingBody,
  declaredCapabilitiesBody,
  departmentBody,
  departmentPatchBody,
  doctorBody,
  doctorPatchBody,
  emptyBody,
  profileBody,
  rulesBody,
  settingsIdParams,
  staffBody,
  staffPatchBody,
  templateBody,
  wardBody,
  wardPatchBody,
} from '@platform/domain';

import * as settings from '../controllers/hospitalSettings.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const hospitalSettingsRoutes: Router = Router();

const admin = [requireAuth, requireRole('hospital_admin')];
const write = idempotency({ required: true });
const byId = { params: settingsIdParams };

hospitalSettingsRoutes.get('/hospital/setup', ...admin, settings.getSetup);

// `FR-NOT-06`: this month's SMS by what became of them, beside the cap the
// same screen sets. Counts of the hospital's own messages; no message's words
// and nobody's number.
hospitalSettingsRoutes.get('/hospital/messages', ...admin, settings.getMessages);

hospitalSettingsRoutes.patch(
  '/hospital/profile',
  ...admin,
  write,
  validate({ body: profileBody }),
  settings.patchProfile,
);
// Its public face (`FR-BRD-06`): colours, and a logo. The logo's body is an
// image in base64, larger than the API's ordinary limit, so it brings its own
// parser (`app.ts` `OWN_BODY_LIMIT`), as a lab report does.
hospitalSettingsRoutes.put(
  '/hospital/brand',
  ...admin,
  write,
  validate({ body: brandBody }),
  settings.putBrand,
);
hospitalSettingsRoutes.get('/hospital/logo', ...admin, settings.getOwnLogo);
// Which live figures it shares with the network (`FR-NET-04`): its own to decide.
hospitalSettingsRoutes.put(
  '/hospital/publishing',
  ...admin,
  write,
  validate({ body: publishingBody }),
  settings.putPublishing,
);
hospitalSettingsRoutes.put(
  '/hospital/logo',
  json({ limit: '512kb' }),
  ...admin,
  write,
  validate({ body: logoBody }),
  settings.putLogo,
);
hospitalSettingsRoutes.delete('/hospital/logo', ...admin, write, settings.deleteLogo);

hospitalSettingsRoutes.patch(
  '/hospital/rules',
  ...admin,
  write,
  validate({ body: rulesBody }),
  settings.patchRules,
);

hospitalSettingsRoutes.post(
  '/hospital/departments',
  ...admin,
  write,
  validate({ body: departmentBody }),
  settings.postDepartment,
);
hospitalSettingsRoutes.patch(
  '/hospital/departments/:id',
  ...admin,
  write,
  validate({ ...byId, body: departmentPatchBody }),
  settings.patchDepartment,
);
// Plan D2: what was added by mistake can be taken away, while nothing stands
// on it. A department nobody sits in; further down, a ward with no bed and a
// bed the ward never brought into service.
hospitalSettingsRoutes.delete(
  '/hospital/departments/:id',
  ...admin,
  write,
  validate(byId),
  settings.deleteDepartment,
);

hospitalSettingsRoutes.post(
  '/hospital/doctors',
  ...admin,
  write,
  validate({ body: doctorBody }),
  settings.postDoctor,
);
hospitalSettingsRoutes.patch(
  '/hospital/doctors/:id',
  ...admin,
  write,
  validate({ ...byId, body: doctorPatchBody }),
  settings.patchDoctor,
);

hospitalSettingsRoutes.post(
  '/hospital/templates',
  ...admin,
  write,
  validate({ body: templateBody }),
  settings.postTemplate,
);
hospitalSettingsRoutes.delete(
  '/hospital/templates/:id',
  ...admin,
  write,
  validate(byId),
  settings.deleteTemplate,
);

hospitalSettingsRoutes.post(
  '/hospital/wards',
  ...admin,
  write,
  validate({ body: wardBody }),
  settings.postWard,
);
hospitalSettingsRoutes.post(
  '/hospital/beds',
  ...admin,
  write,
  validate({ body: bedsBody }),
  settings.postBeds,
);
hospitalSettingsRoutes.patch(
  '/hospital/beds/:id',
  ...admin,
  write,
  validate({ ...byId, body: bedPatchBody }),
  settings.patchBed,
);
hospitalSettingsRoutes.delete(
  '/hospital/beds/:id',
  ...admin,
  write,
  validate(byId),
  settings.deleteBed,
);
hospitalSettingsRoutes.patch(
  '/hospital/wards/:id',
  ...admin,
  write,
  validate({ ...byId, body: wardPatchBody }),
  settings.patchWard,
);
hospitalSettingsRoutes.delete(
  '/hospital/wards/:id',
  ...admin,
  write,
  validate(byId),
  settings.deleteWard,
);

hospitalSettingsRoutes.post(
  '/hospital/staff',
  ...admin,
  write,
  validate({ body: staffBody }),
  settings.postStaff,
);
hospitalSettingsRoutes.patch(
  '/hospital/staff/:id',
  ...admin,
  write,
  validate({ ...byId, body: staffPatchBody }),
  settings.patchStaff,
);
hospitalSettingsRoutes.post(
  '/hospital/staff/:id/reset-password',
  ...admin,
  write,
  validate({ ...byId, body: emptyBody }),
  settings.postResetPassword,
);
hospitalSettingsRoutes.post(
  '/hospital/staff/:id/reset-2fa',
  ...admin,
  write,
  validate({ ...byId, body: emptyBody }),
  settings.postResetTwoFactor,
);

hospitalSettingsRoutes.put(
  '/hospital/capabilities',
  ...admin,
  write,
  validate({ body: declaredCapabilitiesBody }),
  settings.putCapabilities,
);

// `FR-ONB-04`: the hospital asks, the platform answers
// (`POST /platform/hospitals/:id/approve`). There is no route by which a
// hospital publishes itself.
hospitalSettingsRoutes.post(
  '/hospital/request-review',
  ...admin,
  write,
  validate({ body: emptyBody }),
  settings.postRequestReview,
);
