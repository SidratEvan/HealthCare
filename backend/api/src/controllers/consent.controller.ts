/**
 * Consent controllers (BACKEND.md §3, §7.6).
 *
 * Thin, like every controller here. The one thing worth noticing is that
 * `offerConsent` takes the patient from `req.principal` and never from the
 * body: an endpoint that minted an offer for a patient id supplied by the
 * caller would be a way to grant yourself access to a stranger's record.
 */

import { createConsentBody, idParams, redeemConsentBody } from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as consent from '../services/consent.service.js';

import type { Request, Response } from 'express';

/** `POST /patients/:id/consent-offer` — `BTN-A12-QR`. */
export async function offerConsent(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  // Only the patient themselves. Checked here rather than in the service
  // because there is nothing else to decide: the offer names its subject.
  if (principal.kind !== 'patient') throw forbiddenScope({ reason: 'patient_only' });

  res.json({ ok: true, data: await consent.offerConsent(id, principal.id) });
}

/** `POST /consents/redeem` — `BTN-B05-SCAN`, the doctor's side. */
export async function redeemConsent(req: Request, res: Response): Promise<void> {
  const body = redeemConsentBody.parse(req.body);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  res.status(201).json({
    ok: true,
    data: await consent.redeemConsent({ principal, code: body.code }),
  });
}

/** `POST /consents` — granted directly, without a chamber in between. */
export async function createConsent(req: Request, res: Response): Promise<void> {
  const body = createConsentBody.parse(req.body);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  res.status(201).json({
    ok: true,
    data: await consent.grantDirect({
      principal,
      hospitalId: body.hospitalId,
      scope: body.scope,
    }),
  });
}

/** `POST /consents/:id/revoke` — `FR-PAT-64`. */
export async function revokeConsent(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  await consent.revokeConsent({ principal, consentId: id });

  res.json({ ok: true, data: { revoked: true } });
}

/** `GET /patients/:id/access` — `BTN-A12-ACCESS`: grants, and who looked. */
export async function getAccess(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  const [consents, views] = await Promise.all([
    consent.listConsents({ principal, patientId: id }),
    consent.accessLog({ principal, patientId: id }),
  ]);

  res.json({ ok: true, data: { consents, views } });
}
