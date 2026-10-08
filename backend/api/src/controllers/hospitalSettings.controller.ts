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
  brandBody,
  logoBody,
  publishingBody,
  declaredCapabilitiesBody,
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
  wardPatchBody,
} from '@platform/domain';

import { authRequired, forbiddenScope, notFound } from '../errors/AppError.js';
import * as settings from '../services/hospitalSettings.service.js';
import * as notifications from '../services/notification.service.js';

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

/** `GET /hospital/messages` — this month's SMS by what became of them (`FR-NOT-06`). */
export async function getMessages(req: Request, res: Response): Promise<void> {
  done(res, await notifications.monthOfMessages(actorOf(req).hospitalId));
}

export async function patchProfile(req: Request, res: Response): Promise<void> {
  await settings.updateProfile(actorOf(req), profileBody.parse(req.body));
  done(res);
}

/** `PUT /hospital/publishing` — the live figures the hospital does not share. */
export async function putPublishing(req: Request, res: Response): Promise<void> {
  await settings.updatePublishing(actorOf(req), publishingBody.parse(req.body));
  done(res);
}

/** `PUT /hospital/brand` — the hospital's colours, or the platform's own again. */
export async function putBrand(req: Request, res: Response): Promise<void> {
  await settings.updateBrand(actorOf(req), brandBody.parse(req.body));
  done(res);
}

/** `PUT /hospital/logo`. */
export async function putLogo(req: Request, res: Response): Promise<void> {
  done(res, await settings.setLogo(actorOf(req), logoBody.parse(req.body)));
}

export async function deleteLogo(req: Request, res: Response): Promise<void> {
  await settings.removeLogo(actorOf(req));
  done(res);
}

/**
 * `GET /hospital/logo` — the hospital's own logo, for its settings screen.
 *
 * The public address answers for a live hospital only; a hospital still being
 * set up has to see what it uploaded all the same.
 */
export async function getOwnLogo(req: Request, res: Response): Promise<void> {
  const file = await settings.ownLogo(actorOf(req).hospitalId);
  if (file === null) throw notFound('logo');
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(file.bytes);
}

/** `GET /hospital/brand` (plan K4, `FR-BRD-12`): any member of the hospital's staff. */
export async function getBrand(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: await settings.workspaceBrand(actorOf(req).hospitalId) });
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

/** `DELETE /hospital/departments/:id` — one nobody sits in (plan D2). */
export async function deleteDepartment(req: Request, res: Response): Promise<void> {
  await settings.removeDepartment(actorOf(req), idOf(req));
  done(res, { removed: true });
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

/** `DELETE /hospital/beds/:id` — one the ward never brought into service (plan D2). */
export async function deleteBed(req: Request, res: Response): Promise<void> {
  await settings.removeBed(actorOf(req), idOf(req));
  done(res, { removed: true });
}

export async function patchWard(req: Request, res: Response): Promise<void> {
  await settings.updateWard(actorOf(req), idOf(req), wardPatchBody.parse(req.body));
  done(res);
}

/** `DELETE /hospital/wards/:id` — one that holds no bed (plan D2). */
export async function deleteWard(req: Request, res: Response): Promise<void> {
  await settings.removeWard(actorOf(req), idOf(req));
  done(res, { removed: true });
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

/** Pilot step 28 (FR-SEC-10): a lost phone, reset by an administrator. */
export async function postResetTwoFactor(req: Request, res: Response): Promise<void> {
  await settings.resetStaffTwoFactor(actorOf(req), idOf(req));
  done(res, { reset: true });
}

export async function putCapabilities(req: Request, res: Response): Promise<void> {
  await settings.declareCapabilities(actorOf(req), declaredCapabilitiesBody.parse(req.body));
  done(res);
}

export async function postRequestReview(req: Request, res: Response): Promise<void> {
  await settings.requestReview(actorOf(req));
  done(res, { requested: true });
}
