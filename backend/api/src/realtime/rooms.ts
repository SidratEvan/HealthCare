/**
 * Room naming, and who is allowed into each (BACKEND.md §6).
 *
 * Names are built here and nowhere else. A room name assembled by hand in a
 * service is one typo away from a broadcast that reaches nobody — and the
 * failure is silent, because emitting into a room with no members succeeds.
 * The two-device test would catch it for `session:`; nothing would catch it
 * for the rest.
 *
 * The membership rules are here too, as pure predicates over a principal, so
 * the socket handshake and the HTTP layer answer "may this caller see this
 * session" the same way.
 */

import type { Principal } from '../types/express.js';

/** Every room kind in BACKEND.md §6. */
export const ROOMS = {
  /** Patients with a booking, the reception console, the doctor's screen. */
  session: (sessionId: string): string => `session:${sessionId}`,
  beds: (hospitalId: string): string => `hospital:${hospitalId}:beds`,
  emergency: (hospitalId: string): string => `hospital:${hospitalId}:emergency`,
  lab: (hospitalId: string): string => `hospital:${hospitalId}:lab`,
  admin: (hospitalId: string): string => `hospital:${hospitalId}:admin`,
  /** That patient's own devices. */
  patient: (patientId: string): string => `patient:${patientId}`,
  // No room per referral: both ends hear `referral.*` in their own emergency
  // room, which every ER console is already in (`emit.referralUpdated`).
} as const;

/** The events a session room carries (BACKEND.md §6). */
export type SessionEvent = 'queue.updated' | 'session.delayed' | 'session.ended' | 'patient.called';

/**
 * The envelope every realtime payload uses (BACKEND.md §6).
 *
 * `seq` is what a reconnecting client resumes from, so it is present on
 * anything derived from the log and absent on anything that is not. `serverTs`
 * is always present, because a client that cannot tell how old a payload is
 * cannot render a freshness line (`FR-OFF-03`).
 */
export interface RealtimeEnvelope<T = unknown> {
  readonly type: string;
  readonly seq?: number;
  readonly serverTs: string;
  readonly data: T;
}

/**
 * May this principal join this session's room?
 *
 * Staff must be scoped to the hospital running the session. A patient or a
 * guest must hold a booking in it — which the caller resolves, because this
 * function has no I/O and the answer depends on rows.
 *
 * Fails closed on an unknown kind, like every other guard in this codebase.
 */
export function canJoinSession(
  principal: Principal | undefined,
  context: {
    readonly hospitalId: string;
    /** True when this principal holds a booking in the session. */
    readonly holdsBooking: boolean;
  },
): boolean {
  if (principal === undefined) return false;

  switch (principal.kind) {
    case 'staff':
      return principal.hospitalId === context.hospitalId;
    case 'patient':
    case 'guest':
      return context.holdsBooking;
    case 'national':
      // A chamber's room carries patients' serials and names; the national
      // layer reads aggregates over HTTP and has no room (`FR-GOV-06`).
      return false;
  }
}

/** Every room a principal is entitled to without any row lookup. */
export function ambientRoomsFor(principal: Principal): string[] {
  switch (principal.kind) {
    case 'staff':
      // A console subscribes to its own hospital's boards; which of them it
      // actually listens on is the client's choice, and joining costs nothing
      // it is not already allowed to read.
      return [
        ROOMS.beds(principal.hospitalId),
        ROOMS.emergency(principal.hospitalId),
        ROOMS.lab(principal.hospitalId),
        ROOMS.admin(principal.hospitalId),
      ];
    case 'patient':
      return [];
    case 'guest':
      // A tracking link is scoped to one booking and nothing else (FR-GST-05).
      return [];
    case 'national':
      return [];
  }
}
