/**
 * What a receptionist at a desk may manage (`PRD.md` `FR-REC-32`, as the
 * owner answered question 20 on 8 October; plan R4b).
 *
 * In a large hospital a receptionist assigned to a desk manages only that
 * desk's doctors and their chambers, and this is where the server says so:
 * every route that reaches a chamber asks it (the queue, a booking and its
 * payment, offline sync, the live channel). Hiding chambers on the screen is
 * a convenience; this is the rule.
 *
 * Nobody else is limited by desks:
 *   - a receptionist assigned to no desk keeps the one common workspace, which
 *     is every receptionist at a hospital that has not set desks up
 *     (decision 2a);
 *   - an administrator oversees the whole hospital, and a doctor sits in
 *     their own chamber; neither is a desk's.
 */

import { forbiddenScope } from '../errors/AppError.js';
import * as settingsRepo from '../repositories/hospitalSettings.repo.js';

import type { Principal } from '../types/express.js';

/** The doctors this principal may manage, or null when desks do not limit them. */
export async function deskLimit(principal: Principal): Promise<ReadonlySet<string> | null> {
  if (principal.kind !== 'staff') return null;
  const roles: readonly string[] = principal.roles;
  if (!roles.includes('receptionist')) return null;
  if (roles.includes('hospital_admin') || roles.includes('doctor')) return null;
  return await settingsRepo.deskDoctorsForStaff(principal.id, principal.hospitalId);
}

/** Refuses a desk-bound receptionist a chamber that is not one of their desk's doctors'. */
export async function assertDeskAllows(
  principal: Principal,
  session: { readonly doctorId: string },
): Promise<void> {
  const allowed = await deskLimit(principal);
  if (allowed !== null && !allowed.has(session.doctorId)) {
    throw forbiddenScope({ reason: 'outside_your_desk' });
  }
}
