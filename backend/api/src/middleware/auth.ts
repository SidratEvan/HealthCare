/**
 * Turns a bearer token into `req.principal` (BACKEND.md §3).
 *
 * Two layers, and the split matters:
 *
 *   `attachPrincipal` reads a token if one is present and moves on if not. It
 *   runs on every route, including the public ones, because emergency search
 *   and hospital browse must work with no credential at all (GR-08,
 *   FR-PAT-40) while still knowing who the caller is when they happen to be
 *   logged in.
 *
 *   `requireAuth` refuses the request when no principal was attached.
 *
 * A route that needs a caller says so by using `requireAuth`. A route that is
 * public says so by not using it. There is no third state where a route half
 * checks, which is the state real leaks live in.
 */

import {
  NATIONAL_ROLES,
  STAFF_ROLES,
  type NationalRole,
  type StaffRole,
} from '@platform/domain';

import { verifyToken, type TokenClaims } from '../config/jwt.js';
import { authRequired, tokenInvalid } from '../errors/AppError.js';

import type { Principal } from '../types/express.js';
import type { NextFunction, Request, Response } from 'express';

const BEARER = /^Bearer (.+)$/i;

/**
 * Reads `Authorization: Bearer …` and attaches a principal when the token is
 * valid.
 *
 * A malformed or expired token is rejected rather than ignored. Treating a
 * broken credential as "anonymous" would silently downgrade a staff member to
 * a public browser and give them an empty console instead of an error they can
 * act on.
 */
export async function attachPrincipal(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get('authorization');
  if (header === undefined || header === '') {
    next();
    return;
  }

  const match = BEARER.exec(header);
  if (match === null) {
    next(tokenInvalid('malformed_authorization_header'));
    return;
  }

  const token = match[1];
  if (token === undefined) {
    next(tokenInvalid('malformed_authorization_header'));
    return;
  }

  const result = await verifyToken(token, 'access');
  if (!result.ok) {
    next(tokenInvalid(result.reason));
    return;
  }

  const principal = toPrincipal(result.claims);
  if (principal === null) {
    next(tokenInvalid('incomplete_claims'));
    return;
  }

  req.principal = principal;
  next();
}

/** Refuses the request unless a principal was attached. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.principal === undefined) {
    next(authRequired());
    return;
  }
  next();
}

/**
 * Builds a principal from verified claims.
 *
 * Returns null when a staff token is missing its hospital or roles rather than
 * filling in a default. A staff member with no hospital scope would pass every
 * scope check in `requireRole`, which is the opposite of what those checks are
 * for (FR-ROLE-01).
 *
 * The one staff token that legitimately has no hospital is a national
 * account's (R10, R11), and it becomes a `national` principal — a different
 * kind, which every hospital guard refuses without having to know about it.
 */
export function toPrincipal(claims: TokenClaims): Principal | null {
  switch (claims.kind) {
    case 'patient':
      return { kind: 'patient', id: claims.sub };

    case 'guest':
      return {
        kind: 'guest',
        id: claims.sub,
        bookingId: typeof claims.bookingId === 'string' ? claims.bookingId : null,
      };

    case 'staff': {
      const roles = toStaffRoles(claims.roles);
      if (roles.length === 0) return null;

      const hospitalId = claims.hospitalId;
      if (typeof hospitalId !== 'string' || hospitalId === '') {
        // No facility is right for exactly one kind of account: one whose
        // every role is national (`FR-ROLE-01`, migration 0024). Anything
        // else without a hospital is an incomplete token, and a receptionist
        // with nothing to compare against would pass every scope check.
        const national = toNationalRoles(roles);
        return national === null ? null : { kind: 'national', id: claims.sub, roles: national };
      }

      return { kind: 'staff', id: claims.sub, hospitalId, roles };
    }
  }
}

/** The roles, if every one of them belongs to no facility; otherwise null. */
function toNationalRoles(roles: readonly StaffRole[]): readonly NationalRole[] | null {
  const national: readonly string[] = NATIONAL_ROLES;
  const kept = roles.filter((role): role is NationalRole => national.includes(role));
  return kept.length === roles.length ? kept : null;
}

/**
 * Keeps only labels that are real roles.
 *
 * A token carrying an unrecognised role is not an error — it is an old token
 * issued before a role was removed — but the unrecognised label must not
 * survive into a permission check.
 */
function toStaffRoles(value: unknown): readonly StaffRole[] {
  if (!Array.isArray(value)) return [];
  const known: readonly string[] = STAFF_ROLES;
  return value.filter(
    (candidate): candidate is StaffRole =>
      typeof candidate === 'string' && known.includes(candidate),
  );
}
