/**
 * Clinical controllers (BACKEND.md §3, §7.6).
 *
 * Thin, like every controller here: parse what the route validated, call a
 * service, shape a response. The permission rule that makes these endpoints
 * different from the rest of the API lives in `clinical.service`, because
 * `FR-DOC-10` needs two database reads to decide and a controller has no
 * business asking the database anything.
 */

import {
  createVisitBody,
  documentIdParams,
  documentsQuery,
  documentUrlParams,
  formularyQuery,
  idParams,
  recordsQuery,
  uploadDocumentBody,
} from '@platform/domain';

import { authRequired } from '../errors/AppError.js';
import * as clinical from '../services/clinical.service.js';

import { actorOf } from './queue.controller.js';

import type { Request, Response } from 'express';

/**
 * `GET /patients/:id/records` — the wallet (`S-A-12`) and the doctor's patient
 * panel (`S-B-05`, `FR-DOC-03`).
 *
 * One endpoint for both, because it is one question: what is on the record for
 * this person. Who is asking changes what they are allowed to see, not what the
 * thing is called.
 */
export async function getRecords(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const query = recordsQuery.parse(req.query);
  const principal = req.principal;

  // `requireAuth` runs ahead of this, so a missing principal is a wiring
  // mistake rather than an anonymous caller. Saying so beats a cast.
  if (principal === undefined) throw authRequired();

  res.json({
    ok: true,
    data: await clinical.patientRecords({
      principal,
      patientId: id,
      bookingId: query.booking,
    }),
  });
}

/**
 * `POST /visits` — `BTN-B05-DRAFT` and `BTN-B05-SIGN`.
 *
 * Signing advances the queue (`FR-DOC-08`), so the response carries the queue
 * result the console would otherwise have to fetch: the doctor's screen needs
 * the next patient the instant the record is saved, and on a 3G connection a
 * second round trip is the difference between a screen that feels immediate and
 * one that does not.
 */
export async function createVisit(req: Request, res: Response): Promise<void> {
  const body = createVisitBody.parse(req.body);
  const principal = req.principal;
  if (principal === undefined) throw authRequired();

  const result = await clinical.saveVisit({
    principal,
    actor: actorOf(req),
    body,
  });

  // 201 for a record that now exists, whether it was signed or left as a draft:
  // both created something the doctor can come back to.
  res.status(201).json({ ok: true, data: result });
}

/** `GET /formulary?q=` — `TBL-B05-RX`'s suggestions as a doctor types (`FR-DOC-05`). */
export async function searchFormulary(req: Request, res: Response): Promise<void> {
  const { q } = formularyQuery.parse(req.query);
  res.json({ ok: true, data: { medicines: await clinical.formulary(q) } });
}

// ---------------------------------------------------------------------------
// A patient's own old papers (`FR-PAT-62`; plan R3)
// ---------------------------------------------------------------------------

function principalOf(req: Request): NonNullable<Request['principal']> {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  return principal;
}

/** `POST /me/documents`. */
export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const body = uploadDocumentBody.parse(req.body);
  res.status(201).json({
    ok: true,
    data: { document: await clinical.uploadDocument(principalOf(req), body) },
  });
}

/** `GET /me/documents?patient=`. */
export async function listDocuments(req: Request, res: Response): Promise<void> {
  const { patient } = documentsQuery.parse(req.query);
  res.json({
    ok: true,
    data: { documents: await clinical.listOwnDocuments(principalOf(req), patient) },
  });
}

/** `DELETE /me/documents/:id`. */
export async function removeDocument(req: Request, res: Response): Promise<void> {
  const { id } = documentIdParams.parse(req.params);
  await clinical.removeOwnDocument(principalOf(req), id);
  res.json({ ok: true, data: { removed: true } });
}

/** `GET /patients/:id/documents/:docId/url`. */
export async function documentUrl(req: Request, res: Response): Promise<void> {
  const { id, docId } = documentUrlParams.parse(req.params);
  res.json({
    ok: true,
    data: {
      url: await clinical.documentUrl({
        principal: principalOf(req),
        patientId: id,
        documentId: docId,
      }),
    },
  });
}
