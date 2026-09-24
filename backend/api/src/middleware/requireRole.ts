/**
 * Role and hospital scoping (FR-ROLE-01, FR-ROLE-02, FR-SEC-01).
 *
 * "Every role is scoped to a hospital except R1, R2, R10, R11." A receptionist
 * at one facility has no business reading another facility's queue, and the
 * check that stops them is this file — which is why `hospitalId` is a required
 * field on `StaffPrincipal` rather than an optional one.
 *
 * Every guard here fails closed. An unknown principal kind, a missing scope, a
 * role that is not in the list: all refused. The auth matrix tests assert that
 * for each role against each scope, because "does the receptionist from
 * another hospital get in" is not a question to answer by reading code.
 */

import type { NationalRole, StaffRole } from '@platform/domain';

import { authRequired, forbiddenScope } from '../errors/AppError.js';

import type { Principal, StaffPrincipal } from '../types/express.js';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Roles that are not hospital-scoped (FR-ROLE-01: R10, R11). */
const UNSCOPED_ROLES: readonly StaffRole[] = ['platform_admin', 'gov_viewer'];

/**
 * Requires a staff principal holding at least one of `roles`.
 *
 * `hospital_admin` is not implicitly granted every role. A hospital
 * administrator who needs to run a queue is given the receptionist role
 * explicitly, because FR-ROLE-02 makes holding several roles the normal case
 * and an implicit hierarchy would make an audit row ambiguous about which
 * capacity a person was acting in.
 */
export function requireRole(...roles: StaffRole[]): RequestHandler {
  if (roles.length === 0) {
    throw new Error('requireRole needs at least one role; an empty list would allow everyone.');
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (principal === undefined) {
      next(authRequired());
      return;
    }

    if (principal.kind !== 'staff') {
      next(forbiddenScope({ needed: roles, was: principal.kind }));
      return;
    }

    if (!roles.some((role) => principal.roles.includes(role))) {
      next(forbiddenScope({ needed: roles }));
      return;
    }

    next();
  };
}

/**
 * Requires that the staff principal belongs to the hospital the route is about.
 *
 * `param` names the route parameter carrying the hospital id. Platform admins
 * and government viewers pass, since neither is hospital-scoped (FR-ROLE-01) —
 * and the government layer can never reach an identifiable row anyway
 * (FR-GOV-06), which is enforced at the query, not here.
 */
export function requireHospitalScope(param = 'hospitalId'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (principal === undefined) {
      next(authRequired());
      return;
    }

    if (principal.kind !== 'staff') {
      next(forbiddenScope({ was: principal.kind }));
      return;
    }

    if (isUnscoped(principal)) {
      next();
      return;
    }

    const target = req.params[param];
    if (typeof target !== 'string' || target === '') {
      // The route promised a hospital id and did not supply one. Failing
      // closed here turns a routing mistake into a 403 rather than a silent
      // cross-hospital read.
      next(forbiddenScope({ reason: 'missing_hospital_parameter', param }));
      return;
    }

    if (target !== principal.hospitalId) {
      next(forbiddenScope({ reason: 'wrong_hospital' }));
      return;
    }

    next();
  };
}

/**
 * Requires a national principal holding at least one of `roles` (`FR-ROLE-01`).
 *
 * The only door into the national layer. `requireRole('gov_viewer')` would not
 * do: it admits `kind === 'staff'` alone, and a national account is not a
 * hospital's staff. Keeping the two guards apart means no route can admit both
 * a receptionist and a government viewer by listing their roles side by side —
 * the routes that answer "what happened in Dhaka district this week" and the
 * ones that answer "who is waiting in this chamber" never share a guard.
 */
export function requireNationalRole(...roles: NationalRole[]): RequestHandler {
  if (roles.length === 0) {
    throw new Error(
      'requireNationalRole needs at least one role; an empty list would allow everyone.',
    );
  }

  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (principal === undefined) {
      next(authRequired());
      return;
    }

    if (principal.kind !== 'national') {
      next(forbiddenScope({ needed: roles, was: principal.kind }));
      return;
    }

    if (!roles.some((role) => principal.roles.includes(role))) {
      next(forbiddenScope({ needed: roles }));
      return;
    }

    next();
  };
}

/** True when this staff member's roles are all hospital-independent. */
export function isUnscoped(principal: StaffPrincipal): boolean {
  return principal.roles.every((role) => UNSCOPED_ROLES.includes(role));
}

/** True when the principal holds the given role. */
export function hasRole(principal: Principal | undefined, role: StaffRole): boolean {
  return principal?.kind === 'staff' && principal.roles.includes(role);
}

/**
 * Requires a principal that can act for one patient — the patient themselves,
 * or the guest whose tracking link names the booking.
 *
 * Used by the endpoints a patient calls about their own booking: cancel,
 * reschedule, and "I'm running late" (FR-PAT-33). Staff are not admitted by
 * this guard; the console's equivalents are separate routes with their own
 * role checks, so an audit row always says whether a patient or a counter
 * moved the queue (FR-QUE-04).
 */
export function requireOwner(): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (principal === undefined) {
      next(authRequired());
      return;
    }

    if (principal.kind === 'staff') {
      next(forbiddenScope({ reason: 'staff_must_use_console_routes' }));
      return;
    }

    next();
  };
}
