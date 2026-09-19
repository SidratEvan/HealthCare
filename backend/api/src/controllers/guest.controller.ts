/**
 * Guest controllers (BACKEND.md §3, §7.1).
 *
 * One endpoint in this version. The rest of §7.1 — `/guest/start`,
 * `/guest/verify`, `/guest/claim` — is deferred with the rest of authentication
 * (CLAUDE.md §4.1); the tracking link is kept because it is a capability the
 * demo runs on rather than a login (`FR-GST-05`).
 */

import { trackingLinkParams } from '@platform/domain';

import * as guest from '../services/guest.service.js';

import type { Request, Response } from 'express';

/** `GET /guest/link/:token` — opens `S-A-08` from an SMS, with no login. */
export async function openTrackingLink(req: Request, res: Response): Promise<void> {
  const { token } = trackingLinkParams.parse(req.params);
  res.json({ ok: true, data: await guest.openTrackingLink(token) });
}
