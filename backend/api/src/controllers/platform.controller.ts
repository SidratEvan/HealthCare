/**
 * Platform onboarding controllers (`S-B-12`, `FR-ONB-*`).
 *
 * Thin: parse what the route validated, call the service, shape a response.
 */

import {
  lifecycleNoteBody,
  modulesBody,
  platformDoctorParams,
  portalDomainBody,
  settingsIdParams,
  workspaceBody,
} from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as platform from '../services/platform.service.js';

import type { Request, RequestHandler, Response } from 'express';

function actorOf(req: Request): platform.PlatformActor {
  const principal = req.principal;
  if (principal === undefined) throw authRequired();
  if (principal.kind !== 'national') throw forbiddenScope({ reason: 'not_platform_staff' });
  return {
    staffId: principal.id,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

export async function listWorkspaces(_req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: { workspaces: await platform.listWorkspaces() } });
}

export async function getWorkspace(req: Request, res: Response): Promise<void> {
  const { id } = settingsIdParams.parse(req.params);
  res.json({ ok: true, data: await platform.workspace(id) });
}

export async function postWorkspace(req: Request, res: Response): Promise<void> {
  const created = await platform.createWorkspace(actorOf(req), workspaceBody.parse(req.body));
  res.status(201).json({ ok: true, data: created });
}

/** One handler per act, so each route names what it does. */
export function postAct(action: platform.PlatformAction): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const { id } = settingsIdParams.parse(req.params);
    const { note } = lifecycleNoteBody.parse(req.body);
    res.json({ ok: true, data: await platform.act(actorOf(req), id, action, note) });
  };
}

/** `PUT /platform/hospitals/:id/modules` — the modules the hospital does not run. */
export async function putModules(req: Request, res: Response): Promise<void> {
  const { id } = settingsIdParams.parse(req.params);
  const { off } = modulesBody.parse(req.body);
  res.json({ ok: true, data: await platform.setModules(actorOf(req), id, off) });
}

/** `POST /platform/hospitals/:id/domain` — the hospital's own domain, or null to remove it. */
export async function postPortalDomain(req: Request, res: Response): Promise<void> {
  const { id } = settingsIdParams.parse(req.params);
  const { domain } = portalDomainBody.parse(req.body);
  res.json({ ok: true, data: await platform.setPortalDomain(actorOf(req), id, domain) });
}

export async function postVerifyDoctor(req: Request, res: Response): Promise<void> {
  const { id, doctorId } = platformDoctorParams.parse(req.params);
  res.json({ ok: true, data: await platform.verifyDoctor(actorOf(req), id, doctorId) });
}
