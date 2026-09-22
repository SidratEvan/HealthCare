/**
 * Emergency endpoints (BACKEND.md §7.5).
 *
 * Thin by rule: read what the route validated, name the actor, call
 * `emergency.service`, shape the response.
 */

import type {
  CapabilitiesBody,
  CaseCommandBody,
  EmergencySearchQuery,
  InboundBody,
  WalkInBody,
} from '@platform/domain';

import { forbiddenScope, notFound } from '../errors/AppError.js';
import * as emergency from '../services/emergency.service.js';

import type { ErActor, Envelope } from '../services/emergency.service.js';
import type { Request, Response } from 'express';

/** `GET /emergency/search` — public, ranked (`FR-PAT-43`). */
export async function search(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as EmergencySearchQuery;
  res.json({ ok: true, data: await emergency.search(query) });
}

/** `POST /emergency/inbound` — "I'm on my way", from anybody (`FR-GST-03`). */
export async function inbound(req: Request, res: Response): Promise<void> {
  const body = req.body as InboundBody;
  const result = await emergency.inbound({ ...body, idempotencyKey: req.idempotencyKey ?? null });
  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `GET /emergency/track/:token` — the token is the credential. */
export async function track(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await emergency.track(param(req, 'token')) });
}

/** `POST /emergency/track/:token/cancel` — `BTN-A10C-CANCEL`. */
export async function cancel(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await emergency.cancelByFamily(param(req, 'token')) });
}

/** `GET /hospitals/:id/emergency` — `S-B-07`. Names nobody. */
export async function board(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await emergency.board(param(req, 'id')) });
}

/** `GET /emergency/cases/:id/contact` — the number, audited (`DB-P7`). */
export async function contact(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await emergency.contact(param(req, 'id'), actorOf(req)) });
}

/** `POST /emergency/cases` — a walk-in. */
export async function walkIn(req: Request, res: Response): Promise<void> {
  const body = req.body as WalkInBody;
  const result = await emergency.walkIn(
    {
      problem: body.problem,
      triage: body.triage,
      phone: body.phone,
      ageYears: body.ageYears,
      sex: body.sex,
      // A console's offline registration carries its own id; a browser form
      // the header. Either makes a second send the same person.
      idempotencyKey: body.clientEventId ?? req.idempotencyKey ?? null,
    },
    actorOf(req),
  );
  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `POST /emergency/cases/:id/acknowledge` — `BTN-B07-PREPARE`. */
export async function acknowledge(req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    data: await emergency.acknowledge(param(req, 'id'), envelope(req.body), actorOf(req)),
  });
}

/** `PATCH /emergency/cases/:id` — accept, decline, triage, hand off, discharge. */
export async function update(req: Request, res: Response): Promise<void> {
  const body = req.body as CaseCommandBody;

  const commandFor = (): emergency.CaseCommand => {
    switch (body.action) {
      case 'accept':
        return { action: 'accept' };
      case 'decline':
        return { action: 'decline', reason: body.reason };
      case 'triage':
        return { action: 'triage', triage: body.triage };
      case 'handoff':
        return { action: 'handoff', bedKind: body.bedKind };
      case 'discharge':
        return { action: 'discharge' };
    }
  };

  res.json({
    ok: true,
    data: await emergency.command(param(req, 'id'), commandFor(), envelope(body), actorOf(req)),
  });
}

/** `PUT /hospitals/:id/capabilities` — `SW-B07-<capability>` (`FR-EMG-05`). */
export async function capabilities(req: Request, res: Response): Promise<void> {
  const body = req.body as CapabilitiesBody;
  res.json({
    ok: true,
    data: await emergency.confirmCapabilities(param(req, 'id'), body.capabilities, actorOf(req)),
  });
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

function envelope(body: unknown): Envelope {
  const fields = (body ?? {}) as { clientEventId?: string; clientTs?: string };
  return { clientEventId: fields.clientEventId ?? null, clientTs: fields.clientTs ?? null };
}

/** The staff member acting (`FR-ROLE-01`). The route has already required the role. */
function actorOf(req: Request): ErActor {
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  return { staffUserId: principal.id, hospitalId: principal.hospitalId };
}
