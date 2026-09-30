/**
 * A patient's phone sign-in, profiles and claim (pilot step 25, BACKEND.md
 * §7.1). Thin: parse, call the service, send.
 */

import {
  claimBody,
  guestStartBody,
  guestVerifyBody,
  otpRequestBody,
  otpVerifyBody,
  patientRefreshBody,
} from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as patientAuth from '../services/patientAuth.service.js';

import type { Request, Response } from 'express';

function client(req: Request): patientAuth.Client {
  return { ip: req.ip ?? null, device: req.get('user-agent') ?? null };
}

/** The signed-in account holder's id. A guest or staff token is not one. */
function userIdOf(req: Request): string {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  if (principal.kind !== 'patient') throw forbiddenScope({ reason: 'account_only' });
  return principal.id;
}

export async function requestCode(req: Request, res: Response): Promise<void> {
  const { phone } = otpRequestBody.parse(req.body);
  res.json({ ok: true, data: await patientAuth.requestCode(phone, client(req)) });
}

export async function verify(req: Request, res: Response): Promise<void> {
  const { phone, code } = otpVerifyBody.parse(req.body);
  res.json({ ok: true, data: await patientAuth.verify(phone, code, client(req)) });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refresh: token } = patientRefreshBody.parse(req.body);
  res.json({ ok: true, data: await patientAuth.refresh(token, client(req)) });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refresh: token } = patientRefreshBody.parse(req.body);
  await patientAuth.logout(token);
  res.json({ ok: true, data: { signedOut: true } });
}

export async function profiles(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: { profiles: await patientAuth.profiles(userIdOf(req)) } });
}

export async function claim(req: Request, res: Response): Promise<void> {
  const { confirm } = claimBody.parse(req.body);
  res.json({ ok: true, data: await patientAuth.claim(userIdOf(req), confirm) });
}

export async function startGuest(req: Request, res: Response): Promise<void> {
  const { phone, name, deviceProof } = guestStartBody.parse(req.body);
  res.json({
    ok: true,
    data: await patientAuth.startGuest(phone, name, client(req), deviceProof),
  });
}

export async function verifyGuest(req: Request, res: Response): Promise<void> {
  const { phone, name, code } = guestVerifyBody.parse(req.body);
  res.json({ ok: true, data: await patientAuth.verifyGuest(phone, code, name, client(req)) });
}
