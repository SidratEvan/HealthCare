/**
 * `/hospital/imports` — a hospital's own data, set by set (pilot step 24,
 * BACKEND.md §7.7, `PRD.md` §14b, `S-B-14`).
 *
 * The hospital administrator's, on their own facility. Checking a file writes
 * only the batch; committing, undoing and discarding each take an
 * idempotency key and are audited (`FR-IMP-08`). The check route parses its
 * own body, up to six megabytes (five of CSV and the JSON around it), and the
 * global parser steps aside for it (`app.ts`).
 */

import { Router, json } from 'express';

import {
  emptyBody,
  importAnalyseBody,
  importMappedBody,
  importParams,
  importSetParams,
  importUploadBody,
} from '@platform/domain';

import * as imports from '../controllers/import.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const importRoutes: Router = Router();

const admin = [requireAuth, requireRole('hospital_admin')];
const write = idempotency({ required: true });

importRoutes.get(
  '/hospital/imports/templates/:set',
  ...admin,
  validate({ params: importSetParams }),
  imports.getTemplate,
);

importRoutes.get('/hospital/imports', ...admin, imports.list);
importRoutes.get(
  '/hospital/imports/:id',
  ...admin,
  validate({ params: importParams }),
  imports.getOne,
);

importRoutes.post(
  '/hospital/imports',
  json({ limit: '6mb' }),
  ...admin,
  write,
  validate({ body: importUploadBody }),
  imports.check,
);

// A hospital's own export, mapped onto the template (`FR-IMP-13`–`20`).
//
// `analyse` reads and proposes and writes nothing, so it carries no
// idempotency key: asking twice is asking twice. `mapped` is the upload
// itself, by another door, and is keyed like the one above.
importRoutes.post(
  '/hospital/imports/analyse',
  json({ limit: '6mb' }),
  ...admin,
  validate({ body: importAnalyseBody }),
  imports.analyse,
);
importRoutes.post(
  '/hospital/imports/mapped',
  json({ limit: '6mb' }),
  ...admin,
  write,
  validate({ body: importMappedBody }),
  imports.checkMapped,
);

for (const [path, handler] of [
  ['commit', imports.commit],
  ['undo', imports.undo],
  ['discard', imports.discard],
] as const) {
  importRoutes.post(
    `/hospital/imports/:id/${path}`,
    ...admin,
    write,
    validate({ params: importParams, body: emptyBody }),
    handler,
  );
}
