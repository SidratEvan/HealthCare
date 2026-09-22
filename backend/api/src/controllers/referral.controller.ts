/**
 * Referral endpoints (BACKEND.md §7.5, `FR-EMG-07..09`).
 *
 * Thin by rule: read what the route validated, name the actor, call
 * `referral.service`, shape the response.
 */

import type { ReferralDeclineBody, ReferralSendBody } from '@platform/domain';

import { forbiddenScope, notFound } from '../errors/AppError.js';
import * as referrals from '../services/referral.service.js';

import type { ErActor } from '../services/emergency.service.js';
import type { Request, Response } from 'express';

/** `POST /referrals` — `BTN-B07-REFER-SEND-<hospitalId>`. */
export async function send(req: Request, res: Response): Promise<void> {
  const body = req.body as ReferralSendBody;
  const result = await referrals.send(
    {
      emergencyCaseId: body.emergencyCaseId,
      toHospitalId: body.toHospitalId,
      requiredCapability: body.requiredCapability,
      requiredBedKind: body.requiredBedKind,
      note: body.note,
      // A console's offline send carries its own id; a browser the header.
      // Either makes a second send the same referral.
      idempotencyKey: body.clientEventId ?? req.idempotencyKey ?? null,
    },
    actorOf(req),
  );
  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `POST /referrals/:id/seen` — somebody at the receiving ER looked. */
export async function seen(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await referrals.seen(param(req), actorOf(req)) });
}

/** `POST /referrals/:id/accept`. */
export async function accept(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await referrals.accept(param(req), actorOf(req)) });
}

/** `POST /referrals/:id/decline` — reason required. */
export async function decline(req: Request, res: Response): Promise<void> {
  const body = req.body as ReferralDeclineBody;
  res.json({ ok: true, data: await referrals.decline(param(req), body.reason, actorOf(req)) });
}

/** `POST /referrals/:id/cancel` — the sending ER withdraws. */
export async function cancel(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await referrals.cancel(param(req), actorOf(req)) });
}

/** `POST /referrals/:id/arrive` — the handover. */
export async function arrive(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await referrals.arrive(param(req), actorOf(req)) });
}

function param(req: Request): string {
  const value = req.params['id'];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

/** The coordinator acting (`FR-ROLE-01`). The route has already required the role. */
function actorOf(req: Request): ErActor {
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  return { staffUserId: principal.id, hospitalId: principal.hospitalId };
}
