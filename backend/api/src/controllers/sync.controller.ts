/**
 * Sync controllers (BACKEND.md §3, §5).
 *
 * Thin, like every controller here: read the validated input, check the caller
 * is scoped to the session, call a service, shape a response. The protocol
 * decisions all live in `sync.service`.
 *
 * ## Why the scope check is here and not in the route
 *
 * Which hospital a session belongs to is a row, not a claim, so it cannot be
 * decided by middleware reading a token. `requireRole` upstream has already
 * established *what kind of person* this is; this establishes that the session
 * they named is one of theirs (`FR-ROLE-01`).
 */

import { syncBatchBody, syncParams, syncPullQuery } from '@platform/domain';

import { forbiddenScope } from '../errors/AppError.js';
import * as queueService from '../services/queue.service.js';
import * as syncService from '../services/sync.service.js';

import { actorOf } from './queue.controller.js';

import type { Request, Response } from 'express';

/** `POST /sync/events` — replay a console's offline batch (`SY-05`). */
export async function pushEvents(req: Request, res: Response): Promise<void> {
  const body = syncBatchBody.parse(req.body);
  requireStaffScope(req, await hospitalOf(body.sessionId));

  const result = await syncService.pushBatch({
    sessionId: body.sessionId,
    actor: actorOf(req),
    entries: body.events.map((entry) => ({
      clientEventId: entry.clientEventId,
      type: entry.type,
      payload: entry.payload,
      clientTs: entry.clientTs,
    })),
  });

  res.status(200).json({ ok: true, data: result });
}

/** `GET /sync/session/:id` — the events a device missed (`SY-04`, `SY-06`). */
export async function pullSession(req: Request, res: Response): Promise<void> {
  const { id } = syncParams.parse(req.params);
  const query = syncPullQuery.parse(req.query);

  requireStaffScope(req, await hospitalOf(id));

  const result = await syncService.pullSince({
    sessionId: id,
    sinceSeq: query.sinceSeq,
    lastSyncedAt: query.lastSyncedAt ?? null,
  });

  res.status(200).json({ ok: true, data: result });
}

/** The hospital a session belongs to; 404 if there is no such session. */
async function hospitalOf(sessionId: string): Promise<string> {
  const session = await queueService.requireSession(sessionId);
  return session.hospitalId;
}

/**
 * Refuses a caller who is not staff at this session's hospital.
 *
 * Sync is a console protocol. A patient has no offline queue to replay — their
 * app reads the session channel — so there is no reason for a patient or guest
 * token to reach these endpoints, and a narrower door is a better one.
 */
function requireStaffScope(req: Request, hospitalId: string): void {
  const principal = req.principal;

  if (principal?.kind !== 'staff') {
    throw forbiddenScope({ reason: 'sync_is_staff_only' });
  }

  if (principal.hospitalId !== hospitalId) {
    throw forbiddenScope({ reason: 'wrong_hospital' });
  }
}
