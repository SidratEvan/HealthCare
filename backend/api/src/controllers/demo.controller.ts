/**
 * Demo sign-in controllers (CLAUDE.md §4.1).
 *
 * Thin, like every controller here. The refusal when `DEMO_MODE` is off lives
 * in the service, so it applies however this is called.
 */

import { demoTokenBody } from '@platform/domain';

import * as demo from '../services/demo.service.js';

import type { Request, Response } from 'express';

/** `GET /demo/consoles` — the hospitals and chambers `S-B-01` offers. */
export async function listConsoles(_req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: { consoles: await demo.listConsoles() } });
}

/** `POST /demo/token` — a signed staff principal, without a password. */
export async function mintToken(req: Request, res: Response): Promise<void> {
  const body = demoTokenBody.parse(req.body);

  res.json({
    ok: true,
    data: await demo.mintPrincipal({ hospitalId: body.hospitalId, role: body.role }),
  });
}
