/**
 * `S-B-03` counter registration (pilot step 23, BACKEND.md §7.3). Thin: the
 * facility and the actor come off the principal, never the request.
 */

import { registerPatientBody, registrationLookupQuery } from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as registration from '../services/registration.service.js';

import type { Request, Response } from 'express';

function actorOf(req: Request): registration.CounterActor {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  if (principal.kind !== 'staff') throw forbiddenScope({ reason: 'not_hospital_staff' });
  return {
    staffId: principal.id,
    hospitalId: principal.hospitalId,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export async function lookup(req: Request, res: Response): Promise<void> {
  const { phone } = registrationLookupQuery.parse(req.query);
  res.json({ ok: true, data: await registration.lookup(actorOf(req), phone) });
}

export async function register(req: Request, res: Response): Promise<void> {
  actorOf(req);
  res.json({ ok: true, data: await registration.register(registerPatientBody.parse(req.body)) });
}
