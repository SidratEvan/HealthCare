/**
 * Bed endpoints (BACKEND.md §7.5).
 *
 * Thin by rule: read what the route validated, name the actor, call
 * `bed.service`, shape the response. The one decision here is *who* is being
 * admitted, and that is a reading of the body rather than a judgement about it.
 */

import type {
  AdmitBedBody,
  CreateBedRequestBody,
  ExpectedDischargeBody,
  GuestDetails,
  OutOfServiceBody,
  ReserveBedBody,
  RespondBedRequestBody,
  TransferBedBody,
} from '@platform/domain';

import { forbiddenScope, notFound } from '../errors/AppError.js';
import * as beds from '../services/bed.service.js';

import type { WardActor } from '../services/bed.service.js';
import type { Request, Response } from 'express';

/** `GET /hospitals/:id/beds` — the board. No patient identity in it. */
export async function getBoard(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await beds.board(param(req, 'id')) });
}

/** `GET /beds/:id` — the bed panel. Names the occupant, and audits the read. */
export async function getBed(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await beds.panel(param(req, 'id'), actorOf(req)) });
}

/** `POST /beds/:id/admit` (`BTN-B06-ADMIT`). */
export async function admit(req: Request, res: Response): Promise<void> {
  const body = req.body as AdmitBedBody;

  const who: beds.AdmitWho =
    body.bedRequestId !== null
      ? { kind: 'request', bedRequestId: body.bedRequestId }
      : { kind: 'patient', ...requiredPatient(body.patient) };

  send(
    res,
    await beds.admit(
      {
        bedId: param(req, 'id'),
        who,
        expectedDischargeDate: body.expectedDischargeDate,
        ...envelope(body),
      },
      actorOf(req),
    ),
  );
}

export async function discharge(req: Request, res: Response): Promise<void> {
  send(res, await beds.discharge({ bedId: param(req, 'id'), ...envelope(req.body) }, actorOf(req)));
}

export async function transfer(req: Request, res: Response): Promise<void> {
  const body = req.body as TransferBedBody;
  send(
    res,
    await beds.transfer(
      { bedId: param(req, 'id'), toBedId: body.toBedId, ...envelope(body) },
      actorOf(req),
    ),
  );
}

export async function reserve(req: Request, res: Response): Promise<void> {
  const body = req.body as ReserveBedBody;
  send(
    res,
    await beds.reserve(
      { bedId: param(req, 'id'), minutes: body.minutes, ...envelope(body) },
      actorOf(req),
    ),
  );
}

export async function release(req: Request, res: Response): Promise<void> {
  send(res, await beds.release({ bedId: param(req, 'id'), ...envelope(req.body) }, actorOf(req)));
}

export async function cleanStart(req: Request, res: Response): Promise<void> {
  send(
    res,
    await beds.cleanStart({ bedId: param(req, 'id'), ...envelope(req.body) }, actorOf(req)),
  );
}

export async function cleanDone(req: Request, res: Response): Promise<void> {
  send(res, await beds.cleanDone({ bedId: param(req, 'id'), ...envelope(req.body) }, actorOf(req)));
}

export async function outOfService(req: Request, res: Response): Promise<void> {
  const body = req.body as OutOfServiceBody;
  send(
    res,
    await beds.outOfService(
      { bedId: param(req, 'id'), reason: body.reason, ...envelope(body) },
      actorOf(req),
    ),
  );
}

export async function restore(req: Request, res: Response): Promise<void> {
  send(res, await beds.restore({ bedId: param(req, 'id'), ...envelope(req.body) }, actorOf(req)));
}

export async function forecastDischarge(req: Request, res: Response): Promise<void> {
  const body = req.body as ExpectedDischargeBody;
  send(
    res,
    await beds.forecastDischarge(
      { bedId: param(req, 'id'), date: body.date, ...envelope(body) },
      actorOf(req),
    ),
  );
}

// --- Bed requests -----------------------------------------------------------

/** `POST /bed-requests` — public, like a guest booking (`FR-GST-01`). */
export async function createRequest(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateBedRequestBody;
  const created = await beds.createRequest({
    hospitalId: body.hospitalId,
    bedKind: body.bedKind,
    patient: body.patient,
    note: body.note,
    expectedArrivalAt: body.expectedArrivalAt,
    idempotencyKey: req.idempotencyKey ?? null,
  });

  res.status(created.duplicate ? 200 : 201).json({ ok: true, data: created });
}

/** `GET /bed-requests/track/:token` — the token is the credential. */
export async function trackRequest(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await beds.trackRequest(param(req, 'token')) });
}

/** `GET /hospitals/:id/bed-requests` — `LIST-B06-PENDING`. Audited. */
export async function pendingRequests(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await beds.pending(param(req, 'id'), actorOf(req)) });
}

/** `POST /bed-requests/:id/respond`. */
export async function respond(req: Request, res: Response): Promise<void> {
  const body = req.body as RespondBedRequestBody;
  const common = envelope(body);

  const input: beds.RespondInput =
    body.action === 'hold'
      ? { action: 'hold', bedId: body.bedId, minutes: body.minutes, ...common }
      : body.action === 'confirm'
        ? { action: 'confirm', bedId: body.bedId, ...common }
        : { action: 'decline', ...common };

  const result = await beds.respond(param(req, 'id'), input, actorOf(req));
  res.json({ ok: true, data: result });
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

function send(res: Response, result: beds.BedActionResult): void {
  res.json({ ok: true, data: result });
}

function envelope(body: unknown): beds.Envelope {
  const fields = (body ?? {}) as { clientEventId?: string; clientTs?: string };
  return { clientEventId: fields.clientEventId ?? null, clientTs: fields.clientTs ?? null };
}

/** The ward staff member acting (`FR-ROLE-01`). The route has already required the role. */
function actorOf(req: Request): WardActor {
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  return { staffUserId: principal.id, hospitalId: principal.hospitalId };
}

function requiredPatient(patient: AdmitBedBody['patient']): GuestDetails {
  // The schema's refinement guarantees exactly one of the two; this is the
  // compiler being told what zod already checked.
  if (patient === null) throw notFound('patient');
  return patient;
}
