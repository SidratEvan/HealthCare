/**
 * Ending a staff member's access (`PRD.md` `FR-SEC-06`, `FR-ROLE-01`;
 * plan A6, handover finding 17).
 *
 * Whether access still stands is `staffAccess.service`. This is the other
 * half: when it is ended — a sign-out, a deactivation, a change of roles, a
 * password reset — the sessions are revoked *and the account's live
 * connections are closed in the same call*, not at their next reconnect. A
 * deactivated receptionist's screen used to go on receiving the queue.
 *
 * Every place that revokes a session goes through here, so that none can
 * revoke and forget the connections.
 */

import { dropFamilySockets, dropStaffSockets } from '../realtime/auth.js';
import * as staffAuthRepo from '../repositories/staffAuth.repo.js';

/**
 * Ends every sign-in an account has: its refresh tokens stop working, its
 * access tokens are refused from the next request, and its live connections
 * are closed now. For a deactivation, a change of roles, a password reset.
 */
export async function revokeStaffSessions(staffId: string): Promise<void> {
  await staffAuthRepo.revokeOtherSessions(staffId, null);
  dropStaffSockets(staffId);
}

/**
 * Ends one sign-in: `POST /staff/logout`. Returns whether this call ended it.
 * The person's other devices are not touched.
 */
export async function endStaffSession(session: {
  readonly id: string;
  readonly familyId: string;
}): Promise<boolean> {
  const ended = await staffAuthRepo.revokeRefreshSession(session.id);
  if (ended) dropFamilySockets(session.familyId);
  return ended;
}
