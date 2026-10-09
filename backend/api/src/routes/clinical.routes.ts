/**
 * Clinical routes (BACKEND.md §7.6).
 *
 * Two of that table's rows: `POST /visits` and `GET /patients/:id/records`. The
 * others — consents, documents, test orders, dispensing — belong to steps 13,
 * 17 and 18 and arrive with the screens that use them.
 *
 * ## Why `requireRole` is not the guard that matters on the read
 *
 * Everywhere else in this API a role is enough: a receptionist may call the next
 * patient, full stop. Reading a record is different. `FR-DOC-10` limits a
 * doctor to patients *in their own sessions*, which no role can express — and
 * the same endpoint must also serve a patient reading their own wallet, who has
 * no role at all.
 *
 * So the read requires only that somebody is authenticated, and
 * `clinical.service` decides. That is deliberate and is the one place in this
 * API where the permission is not visible in the route table; the service's
 * header says so too, and `clinical.routes.test.ts` covers the matrix that a
 * `requireRole` line would otherwise have documented.
 *
 * Writing a record has no such reason, so `POST /visits` does carry the role.
 */

import { Router } from 'express';

import { createVisitBody, formularyQuery, idParams, recordsQuery } from '@platform/domain';

import * as clinical from '../controllers/clinical.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';

export const clinicalRoutes: Router = Router();

/**
 * `GET /patients/:id/records` — the wallet and the doctor's patient panel.
 *
 * `?booking=` brings that booking's pre-visit answers back with the history, so
 * `S-B-05` opens in one request (`FR-DOC-03`, `NFR-04`).
 */
clinicalRoutes.get(
  '/patients/:id/records',
  requireAuth,
  validate({ params: idParams, query: recordsQuery }),
  clinical.getRecords,
);

/**
 * `POST /visits` — save a draft, or sign and finish (`FR-DOC-08`).
 *
 * Doctors only (`BACKEND.md` §7.6). Unlike the read above, writing a record is
 * a role: nobody but a doctor has a patient or a relationship to write it for,
 * and without this line a receptionist could sign a diagnosis that the wallet
 * shows under the doctor's name.
 *
 * Replay-safe or refused, like every write in this API. Signing calls the next
 * patient, and a request applied twice would call two — which is the failure a
 * waiting room notices immediately.
 */
clinicalRoutes.post(
  '/visits',
  requireAuth,
  requireRole('doctor'),
  idempotency({ required: true }),
  validate({ body: createVisitBody }),
  clinical.createVisit,
);

/**
 * `GET /formulary?q=` — the formulary, by the start of a name (`FR-DOC-05`,
 * plan R2). Doctors only: it is the prescribing screen's, and the public
 * question "where is this medicine in stock" is `GET /medicines`.
 */
clinicalRoutes.get(
  '/formulary',
  requireAuth,
  requireRole('doctor'),
  validate({ query: formularyQuery }),
  clinical.searchFormulary,
);
