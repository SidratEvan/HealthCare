/**
 * `S-B-14` imports (pilot step 24, BACKEND.md §7.7). Thin: the facility is the
 * administrator's own, from the principal, never the request (`FR-ROLE-01`).
 */

import {
  importAnalyseBody,
  importMappedBody,
  importParams,
  importSetParams,
  importUploadBody,
} from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as imports from '../services/import.service.js';
import * as mapping from '../services/importMapping.service.js';

import type { Request, Response } from 'express';

function actorOf(req: Request): imports.ImportActor {
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

/** The template as a file to save, not an envelope: it is opened in a spreadsheet. */
export function getTemplate(req: Request, res: Response): void {
  actorOf(req);
  const { set } = importSetParams.parse(req.params);
  // A byte order mark, so a spreadsheet reads the Bangla as UTF-8 on open.
  res
    .type('text/csv; charset=utf-8')
    .attachment(`medlivebd-${set}-template.csv`)
    .send('\uFEFF' + imports.template(set));
}

export async function list(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: { batches: await imports.list(actorOf(req).hospitalId) } });
}

export async function getOne(req: Request, res: Response): Promise<void> {
  const { id } = importParams.parse(req.params);
  res.json({ ok: true, data: await imports.view(actorOf(req).hospitalId, id) });
}

export async function check(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await imports.check(actorOf(req), importUploadBody.parse(req.body)) });
}

/** `POST /hospital/imports/analyse` — reads a file and proposes; writes nothing. */
export async function analyse(req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    data: await mapping.analyse(actorOf(req), importAnalyseBody.parse(req.body)),
  });
}

/** `POST /hospital/imports/mapped` — a confirmed mapping, handed to the check. */
export async function checkMapped(req: Request, res: Response): Promise<void> {
  res.json({
    ok: true,
    data: await mapping.confirm(actorOf(req), importMappedBody.parse(req.body)),
  });
}

export async function commit(req: Request, res: Response): Promise<void> {
  const { id } = importParams.parse(req.params);
  res.json({ ok: true, data: await imports.commit(actorOf(req), id) });
}

export async function undo(req: Request, res: Response): Promise<void> {
  const { id } = importParams.parse(req.params);
  res.json({ ok: true, data: await imports.undo(actorOf(req), id) });
}

export async function discard(req: Request, res: Response): Promise<void> {
  const { id } = importParams.parse(req.params);
  res.json({ ok: true, data: await imports.discard(actorOf(req), id) });
}
