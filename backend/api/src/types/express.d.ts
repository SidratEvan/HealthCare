/**
 * What the middleware chain attaches to a request.
 *
 * `req.principal` is the shape BACKEND.md §3 names: `{kind, id, hospitalId,
 * roles}`. It is a discriminated union rather than an object with optional
 * fields, so `requireRole` cannot compile against a patient and a staff member
 * at the same time, and a hospital scope check cannot silently pass because
 * `hospitalId` happened to be undefined on both sides.
 */

import type { NationalRole, StaffRole } from '@platform/domain';

/** An authenticated account holder (FR-PAT-01). */
export interface PatientPrincipal {
  readonly kind: 'patient';
  readonly id: string;
}

/**
 * Someone who booked without an account (FR-GST-04).
 *
 * `bookingId` is present when the principal came from an SMS tracking link,
 * which is scoped to exactly one booking (FR-GST-05). A guest token obtained
 * during a booking flow has no booking yet.
 */
export interface GuestPrincipal {
  readonly kind: 'guest';
  readonly id: string;
  readonly bookingId: string | null;
}

/** A hospital employee, always scoped to one hospital (FR-ROLE-01). */
export interface StaffPrincipal {
  readonly kind: 'staff';
  readonly id: string;
  readonly hospitalId: string;
  readonly roles: readonly StaffRole[];
}

/**
 * Somebody who works for no facility: R10 or R11 (`FR-ROLE-01`).
 *
 * Its own kind rather than a `StaffPrincipal` with no hospital, and that is
 * the point. Every hospital-scoped guard in the API asks `kind === 'staff'`
 * before anything else, so a national principal fails all of them without any
 * of them having to know it exists — a government viewer cannot open a queue,
 * a ward board or a record by any route that was written for hospital staff
 * (`FR-ROLE-04`). The only routes that admit it are the ones that say so with
 * `requireNationalRole`.
 */
export interface NationalPrincipal {
  readonly kind: 'national';
  readonly id: string;
  readonly roles: readonly NationalRole[];
}

export type Principal = PatientPrincipal | GuestPrincipal | StaffPrincipal | NationalPrincipal;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the only way to augment Express's types
  namespace Express {
    interface Request {
      /** Set by `auth` or `guestAuth`. Absent on a public route. */
      principal?: Principal;
      /** Correlates a log line, an audit row and a queue event. */
      requestId: string;
      /** Set by the idempotency middleware on unsafe methods. */
      idempotencyKey?: string;
    }
  }
}
