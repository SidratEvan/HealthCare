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
 * Capabilities are not here: `PUT /hospitals/:id/capabilities` already
 * admits a hospital administrator (§7.5), and `S-B-11` calls it.
 */

import { Router } from 'express';

import {
  bedPatchBody,
  bedsBody,
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

hospitalSettingsRoutes.patch(
  '/hospital/profile',
  ...admin,
  write,
  validate({ body: profileBody }),
  settings.patchProfile,
);
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
  '/hospital/go-live',
  ...admin,
  write,
  validate({ body: emptyBody }),
  settings.postGoLive,
);
