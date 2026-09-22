/**
 * Consent controllers (BACKEND.md §3, §7.6).
 *
 * Thin, like every controller here. Who may speak for a patient — including
 * the demo-only guest branch — is decided once, in `consent.service`, so the
 * offer, the access log and a revocation cannot drift apart.
 */

import { createConsentBody, idParams, redeemConsentBody } from '@platform/domain';

import { authRequired } from '../errors/AppError.js';
import * as consent from '../services/consent.service.js';

import type { Request, Response } from 'express';

/** `POST /patients/:id/consent-offer` — `BTN-A12-QR`. */
export async function offerConsent(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  res.json({ ok: true, data: await consent.offerConsent({ principal, patientId: id }) });
}

/** `POST /consents/qr` — `BTN-B05-SCAN`, the doctor's side. */
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
