/**
 * A member of staff reaches only the modules their hospital runs
 * (`PRD.md` `FR-BRD-11`; plan C4).
 *
 * One gate for every staff request, placed after the principal is known and
 * before any route: the request's method and path are looked up in
 * `MODULE_ROUTES` (`shared/domain`), and if the hospital has one of the
 * modules it needs switched off, it is refused with `MODULE_OFF`.
 *
 * In one place and not on each route, so that no route can forget it; the
 * table is held against the routes the server really mounts by
 * `moduleRoutes.test.ts`.
 *
 * Only a member of staff is asked. A patient's or the public's request for a
 * hospital that does not run something is refused by the service that would
 * take it (`modules.service` `requireOn`), which knows which hospital it is
 * for; here that is only known for staff, from their token.
 */

import { modulesOfRequest } from '@platform/domain';

import { AppError } from '../errors/AppError.js';
import { API_BASE_PATH } from '../routes/index.js';
import { firstOff } from '../services/modules.service.js';

import type { NextFunction, Request, Response } from 'express';

export function moduleGate(req: Request, _res: Response, next: NextFunction): void {
  const principal = req.principal;
  if (principal?.kind !== 'staff' || !req.path.startsWith(`${API_BASE_PATH}/`)) {
    next();
    return;
  }

  const needed = modulesOfRequest(req.method, req.path.slice(API_BASE_PATH.length));
  if (needed.length === 0) {
    next();
    return;
  }

  firstOff(principal.hospitalId, needed).then((off) => {
    next(off === null ? undefined : new AppError('MODULE_OFF', { details: { module: off } }));
  }, next);
}
