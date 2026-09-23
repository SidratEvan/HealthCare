/**
 * Lab and pharmacy endpoints (BACKEND.md §7.6, `FR-LAB-*`, `FR-PHR-02`).
 *
 * Thin by rule: read what the route validated, name the actor, call the
 * service, shape the response.
 */

import type {
  CreateTestOrdersBody,
  LabQueueQuery,
  MedicineSearchQuery,
  StockFlagsBody,
  TestOrderStateBody,
  UploadReportBody,
} from '@platform/domain';

import { forbiddenScope, notFound } from '../errors/AppError.js';
import * as lab from '../services/lab.service.js';
import * as pharmacy from '../services/pharmacy.service.js';

import type { LabActor } from '../services/lab.service.js';
import type { Request, Response } from 'express';

/** `POST /test-orders` — `BTN-B05-TEST` (`FR-DOC-06`, `FR-LAB-01`). */
export async function order(req: Request, res: Response): Promise<void> {
  const body = req.body as CreateTestOrdersBody;
  const result = await lab.order(
    {
      bookingId: body.bookingId,
      tests: body.tests,
      // A console's offline order carries its own id; a browser the header.
      // Either makes a second send the same set of orders.
      idempotencyKey: body.clientEventId ?? body.idempotencyKey,
    },
    actorOf(req),
  );
  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `PATCH /test-orders/:id/state` — the lab's state buttons (`FR-LAB-02`). */
export async function advance(req: Request, res: Response): Promise<void> {
  const body = req.body as TestOrderStateBody;
  res.json({
    ok: true,
    data: await lab.advance({ orderId: param(req), action: body.action }, actorOf(req)),
  });
}

/** `POST /test-orders/:id/report` — upload, then auto-deliver (`FR-LAB-03`). */
export async function uploadReport(req: Request, res: Response): Promise<void> {
  const body = req.body as UploadReportBody;
  const result = await lab.uploadReport(
    {
      orderId: param(req),
      fileType: body.fileType,
      content: body.content,
      idempotencyKey: body.clientEventId ?? body.idempotencyKey,
    },
    actorOf(req),
  );
  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `GET /hospitals/:hospitalId/test-orders` — the lab queue (`S-B-08`). */
export async function queue(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as LabQueueQuery;
  res.json({
    ok: true,
    data: await lab.queue(
      { hospitalId: hospitalParam(req), state: query.state, days: query.days },
      actorOf(req),
    ),
  });
}

/** `GET /test-orders/:id/patient` — the name a bench calls somebody by. */
export async function patientLabel(req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    data: { label: await lab.patientLabel(param(req), actorOf(req)) },
  });
}

/** `GET /lab/catalogue` — the chips `BTN-B05-TEST` renders. */
export function catalogue(_req: Request, res: Response): void {
  res.json({ ok: true, data: { tests: lab.testCatalogue() } });
}

// ---------------------------------------------------------------------------
// Pharmacy (`FR-PHR-02`)
// ---------------------------------------------------------------------------

/** `GET /hospitals/:hospitalId/pharmacy-stock` — `S-B-09`'s shelf. */
export async function shelf(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await pharmacy.shelf(hospitalParam(req), actorOf(req)) });
}

/** `PUT /hospitals/:hospitalId/pharmacy-stock` — the flags confirmed. */
export async function setFlags(req: Request, res: Response): Promise<void> {
  const body = req.body as StockFlagsBody;
  res.json({
    ok: true,
    data: await pharmacy.setFlags(
      { hospitalId: hospitalParam(req), flags: body.flags },
      actorOf(req),
    ),
  });
}

/** `GET /medicines?q=&lat=&lng=` — the patient's availability search. Public. */
export async function searchMedicines(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as MedicineSearchQuery;
  res.json({
    ok: true,
    data: await pharmacy.searchMedicines({
      q: query.q,
      lat: query.lat ?? null,
      lng: query.lng ?? null,
      limit: query.limit,
    }),
  });
}

/**
 * `GET /files/:key` — an object the mock store holds, behind its signature.
 *
 * A bad or expired signature is a 404 rather than a 403: the two are
 * deliberately indistinguishable from outside, for the reason
 * `GUEST_LINK_EXPIRED` gives — telling an unknown caller that a key *exists*
 * is how a guessing attack learns it is getting warmer, and this key names a
 * patient's report.
 */
export async function serveFile(req: Request, res: Response): Promise<void> {
  const key = req.params['key'];
  const expires = Number(req.query['expires']);
  const signature = req.query['sig'];

  if (typeof key !== 'string' || key === '' || typeof signature !== 'string') {
    throw notFound('file');
  }

  const file = await lab.openSignedFile({ key, expires, signature });
  if (file === null) throw notFound('file');

  res.setHeader('Content-Type', file.contentType);
  // A report is one patient's. Nothing between here and them may keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.bytes);
}

function param(req: Request): string {
  const value = req.params['id'];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

function hospitalParam(req: Request): string {
  const value = req.params['hospitalId'];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

/** The staff member acting. The route has already required the role. */
function actorOf(req: Request): LabActor {
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });
  return { staffUserId: principal.id, hospitalId: principal.hospitalId };
}
