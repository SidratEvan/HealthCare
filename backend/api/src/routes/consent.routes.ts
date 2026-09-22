/**
 * Consent routes (BACKEND.md §7.6, `FR-PAT-63`, `FR-PAT-64`).
 *
 * Like `clinical.routes`, these require authentication and let the service
 * decide the rest — but for a different reason. There the rule is a
 * relationship; here it is ownership, and a role cannot express "this is my own
 * record" either.
 *
 * `POST /consents/qr` is the one exception in spirit: it is doctors only,
 * and the service says so first thing. It is not a `requireRole` line because
 * the refusal has to sit beside the code verification — a caller learning that
 * their *role* was wrong before their *code* was checked would learn something
 * about the code.
 */

import { Router } from 'express';

import { createConsentBody, idParams, redeemConsentBody } from '@platform/domain';

import * as consent from '../controllers/consent.controller.js';
import { requireAuth } from '../middleware/auth.js';
import { idempotency } from '../middleware/idempotency.js';
import { validate } from '../middleware/validate.js';

export const consentRoutes: Router = Router();

/** Every write is replay-safe or refused (CLAUDE.md §7). */
const write = idempotency({ required: true });

/**
 * `BTN-A12-QR` — the patient asks for something to show.
 *
 * A write rather than a read, because it mints a credential: nothing is
 * returned that the caller already had, and a GET that mints is a GET that a
 * prefetch or a browser's address bar can fire by accident.
 */
consentRoutes.post(
  '/patients/:id/consent-offer',
  requireAuth,
  write,
  validate({ params: idParams }),
  consent.offerConsent,
);

/** `BTN-B05-SCAN` — the doctor turns the patient's code into access. */
consentRoutes.post(
  '/consents/qr',
  requireAuth,
  write,
  validate({ body: redeemConsentBody }),
  consent.redeemConsent,
);

/** Granted from the app, with no chamber in between. */
consentRoutes.post(
  '/consents',
  requireAuth,
  write,
  validate({ body: createConsentBody }),
  consent.createConsent,
);

consentRoutes.post(
  '/consents/:id/revoke',
  requireAuth,
  write,
  validate({ params: idParams }),
  consent.revokeConsent,
);

/** `BTN-A12-ACCESS` — the grants made, and every staff read of the record. */
consentRoutes.get(
  '/patients/:id/access',
  requireAuth,
  validate({ params: idParams }),
  consent.getAccess,
);
