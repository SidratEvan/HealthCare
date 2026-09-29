/**
 * `S-B-11` hospital settings (pilot step 22, BACKEND.md §7.7 `/hospital/*`).
 *
 * Thin, like every controller. The one decision made here is *which
 * facility*: always the signed-in administrator's own, from the principal,
 * never from anything in the request (`FR-ROLE-01`) — the same rule the admin
 * dashboard follows, for the same reason.
 */

import {
  bedPatchBody,
  bedsBody,
  departmentBody,
  departmentPatchBody,
  doctorBody,
  doctorPatchBody,
  profileBody,
  rulesBody,
  settingsIdParams,
  staffBody,
  staffPatchBody,
  templateBody,
  wardBody,
} from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';
import * as settings from '../services/hospitalSettings.service.js';

import type { Request, Response } from 'express';

function actorOf(req: Request): settings.Actor {
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

function idOf(req: Request): string {
  return settingsIdParams.parse(req.params).id;
}

function done(res: Response, data: unknown = { saved: true }): void {
  res.json({ ok: true, data });
}

export async function getSetup(req: Request, res: Response): Promise<void> {
  done(res, await settings.setup(actorOf(req).hospitalId));
}

export async function patchProfile(req: Request, res: Response): Promise<void> {
  await settings.updateProfile(actorOf(req), profileBody.parse(req.body));
  done(res);
}

export async function patchRules(req: Request, res: Response): Promise<void> {
  await settings.updateRules(actorOf(req), rulesBody.parse(req.body));
  done(res);
}

export async function postDepartment(req: Request, res: Response): Promise<void> {
  done(res, await settings.createDepartment(actorOf(req), departmentBody.parse(req.body)));
}

export async function patchDepartment(req: Request, res: Response): Promise<void> {
  await settings.updateDepartment(actorOf(req), idOf(req), departmentPatchBody.parse(req.body));
  done(res);
}

export async function postDoctor(req: Request, res: Response): Promise<void> {
  done(res, await settings.addDoctor(actorOf(req), doctorBody.parse(req.body)));
}

export async function patchDoctor(req: Request, res: Response): Promise<void> {
  await settings.updateDoctor(actorOf(req), idOf(req), doctorPatchBody.parse(req.body));
  done(res);
}

export async function postTemplate(req: Request, res: Response): Promise<void> {
  done(res, await settings.addSchedule(actorOf(req), templateBody.parse(req.body)));
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  done(res, await settings.removeSchedule(actorOf(req), idOf(req)));
}

export async function postWard(req: Request, res: Response): Promise<void> {
  done(res, await settings.addWard(actorOf(req), wardBody.parse(req.body)));
}

export async function postBeds(req: Request, res: Response): Promise<void> {
  done(res, await settings.addBeds(actorOf(req), bedsBody.parse(req.body)));
}

export async function patchBed(req: Request, res: Response): Promise<void> {
  await settings.updateBed(actorOf(req), idOf(req), bedPatchBody.parse(req.body));
  done(res);
}

export async function postStaff(req: Request, res: Response): Promise<void> {
  done(res, await settings.addStaff(actorOf(req), staffBody.parse(req.body)));
}

export async function patchStaff(req: Request, res: Response): Promise<void> {
  await settings.updateStaff(actorOf(req), idOf(req), staffPatchBody.parse(req.body));
  done(res);
}

export async function postResetPassword(req: Request, res: Response): Promise<void> {
  done(res, await settings.resetStaffPassword(actorOf(req), idOf(req)));
}

export async function postGoLive(req: Request, res: Response): Promise<void> {
  await settings.goLive(actorOf(req));
  done(res, { live: true });
}
