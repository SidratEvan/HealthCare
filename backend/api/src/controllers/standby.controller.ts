/**
 * The patient's standby routes (`FR-PAT-25`…`27`). A few lines each: read the
 * request, call `standby.service`, answer in the envelope (BACKEND.md §7).
 */

import type { AcceptStandbyOfferBody, JoinStandbyBody } from '@platform/domain';

import { notFound } from '../errors/AppError.js';
import * as standby from '../services/standby.service.js';

import type { Request, Response } from 'express';

/** `POST /sessions/:id/standby` — 201 for a new place, 200 for a replay. */
export async function join(req: Request, res: Response): Promise<void> {
  const body = req.body as JoinStandbyBody;
  const joined = await standby.join({
    sessionId: param(req, 'id'),
    guest: body.guest,
    prepay: body.prepay,
    clientEventId: body.clientEventId ?? req.idempotencyKey ?? null,
  });

  res.status(joined.duplicate ? 200 : 201).json({ ok: true, data: joined });
}

/** `GET /standby/:token` — the token is the credential. */
export async function status(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await standby.status(param(req, 'token')) });
}

/** `POST /standby/:token/accept`. */
export async function accept(req: Request, res: Response): Promise<void> {
  const body = req.body as AcceptStandbyOfferBody;
  const accepted = await standby.accept(param(req, 'token'), {
    method: body.method,
    clientEventId: body.clientEventId ?? null,
  });
  res.json({ ok: true, data: accepted });
}

/** `POST /standby/:token/decline`. */
export async function decline(req: Request, res: Response): Promise<void> {
  await standby.decline(param(req, 'token'));
  res.json({ ok: true, data: { declined: true } });
}

/** `POST /standby/:token/leave`. */
export async function leave(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await standby.leave(param(req, 'token')) });
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}
