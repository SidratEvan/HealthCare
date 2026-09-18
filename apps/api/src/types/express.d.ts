/**
 * What the middleware chain attaches to a request.
 *
 * `req.principal` is the shape BACKEND.md §3 names: `{kind, id, hospitalId,
 * roles}`. It is a discriminated union rather than an object with optional
 * fields, so `requireRole` cannot compile against a patient and a staff member
 * at the same time, and a hospital scope check cannot silently pass because
 * `hospitalId` happened to be undefined on both sides.
 */

import type { StaffRole } from '@platform/domain';

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

export type Principal = PatientPrincipal | GuestPrincipal | StaffPrincipal;

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
