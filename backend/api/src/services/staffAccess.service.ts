/**
 * Whether a staff access token is still to be honoured (`PRD.md` `FR-SEC-06`,
 * `FR-ROLE-01`; plan A6, handover finding 17).
 *
 * The one rule, asked by the HTTP middleware on every request and by the
 * socket handshake and its sweep: a token stands on its **account** (still
 * there, still active) and on the **sign-in** it came from (`sid`, a session
 * family — migration 0042 — still holding a session that is neither revoked
 * nor expired).
 *
 * Kept apart from `accessGuard.service`, which *ends* access and closes
 * connections: that one reaches into the socket layer, and this one must be
 * importable by the middleware the socket layer itself uses.
 *
 * ## What is deliberately let through
 *
 * A token whose subject is no row at all is honoured: nothing was revoked, no
 * account of that id has ever been deactivated or deleted. (A deleted account
 * is a row, soft-deleted, and is refused.) A token with no `sid` — the
 * demonstration's password-less door mints these, and has no session to name
 * — stands on its account alone.
 *
 * ## The cost
 *
 * One read by primary key per authenticated staff request. Not cached: a
 * cache would be a window in which a deactivated account still works, which
 * is the thing this exists to close.
 */

import * as staffAuthRepo from '../repositories/staffAuth.repo.js';

export async function staffAccessLive(staffId: string, familyId: string | null): Promise<boolean> {
  const state = await staffAuthRepo.accessState(staffId, familyId);
  if (state === null) return true;
  if (!state.accountLive) return false;
  return familyId === null ? true : state.familyLive;
}
