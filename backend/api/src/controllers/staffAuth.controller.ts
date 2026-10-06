/**
 * Staff sign-in (pilot step 21, BACKEND.md §7.1). Thin, like every controller
 * here: parse, call the service, send.
 */

import {
  staffLoginBody,
  staffPasswordBody,
  staffRefreshBody,
  staffTwoFactorBody,
  staffTwoFactorEnableBody,
} from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as modules from '../services/modules.service.js';
import * as staffAuth from '../services/staffAuth.service.js';

import type { Request, Response } from 'express';

function client(req: Request): { ip: string | null; userAgent: string | null } {
  return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
}

/** The signed-in account's id — a facility's staff or a national account. */
function staffIdOf(req: Request): string {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  if (principal.kind !== 'staff' && principal.kind !== 'national') {
    throw forbiddenScope({ reason: 'staff_only' });
  }
  return principal.id;
}

export async function login(req: Request, res: Response): Promise<void> {
  const body = staffLoginBody.parse(req.body);
  res.json({ ok: true, data: await staffAuth.login(body, client(req)) });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const body = staffRefreshBody.parse(req.body);
  res.json({ ok: true, data: await staffAuth.refresh(body.refresh, client(req)) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const body = staffRefreshBody.parse(req.body);
  await staffAuth.logout(body.refresh);
  res.json({ ok: true, data: { signedOut: true } });
}

export async function me(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await staffAuth.me(staffIdOf(req)) });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const body = staffPasswordBody.parse(req.body);
  res.json({ ok: true, data: await staffAuth.changePassword(staffIdOf(req), body, client(req)) });
}

/** `POST /staff/2fa` — the challenge from the login and a code (pilot step 28). */
export async function secondFactor(req: Request, res: Response): Promise<void> {
  const body = staffTwoFactorBody.parse(req.body);
  res.json({ ok: true, data: await staffAuth.verifySecondFactor(body, client(req)) });
}

/** `POST /staff/2fa/setup` — a new secret for the person's app, shown once. */
export async function twoFactorSetup(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await staffAuth.startTwoFactorSetup(staffIdOf(req)) });
}

/** `POST /staff/2fa/enable` — a code from the app turns it on. */
export async function twoFactorEnable(req: Request, res: Response): Promise<void> {
  const body = staffTwoFactorEnableBody.parse(req.body);
  res.json({
    ok: true,
    data: await staffAuth.enableTwoFactor(staffIdOf(req), body.code, client(req)),
  });
}

export async function chambers(req: Request, res: Response): Promise<void> {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  if (principal.kind !== 'staff') throw forbiddenScope({ reason: 'no_facility' });
  res.json({
    ok: true,
    data: {
      chambers: await staffAuth.chambers(principal.hospitalId),
      // What this hospital does not run (`FR-BRD-11`), so the picker offers
      // no console that would be refused.
      modulesOff: await modules.modulesOff(principal.hospitalId),
    },
  });
}
