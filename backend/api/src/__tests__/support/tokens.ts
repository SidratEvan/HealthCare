/**
 * Token minting for the auth matrix.
 *
 * Uses the real `signToken`, not a hand-rolled JWT. A matrix built on
 * fabricated tokens would prove the middleware accepts what the test thinks a
 * token looks like, which is not the question — the question is whether it
 * accepts what `auth.service` will actually issue in step 4.
 */

import type { StaffRole } from '@platform/domain';

import { signToken } from '../../config/jwt.js';

/** Fixed ids, so a failure message names something recognisable. */
export const IDS = {
  patient: '11111111-1111-7111-8111-111111111111',
  otherPatient: '11111111-1111-7111-8111-222222222222',
  guest: '22222222-2222-7222-8222-111111111111',
  staff: '33333333-3333-7333-8333-111111111111',
  hospital: '44444444-4444-7444-8444-111111111111',
  otherHospital: '44444444-4444-7444-8444-999999999999',
  booking: '55555555-5555-7555-8555-111111111111',
  otherBooking: '55555555-5555-7555-8555-999999999999',
} as const;

export async function patientToken(id: string = IDS.patient): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub: id, kind: 'patient' } });
}

/** A guest token from the booking flow: verified phone, no booking yet. */
export async function guestToken(id: string = IDS.guest): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub: id, kind: 'guest' } });
}

export async function staffToken(
  roles: readonly StaffRole[],
  hospitalId: string = IDS.hospital,
): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: IDS.staff, kind: 'staff', hospitalId, roles },
  });
}

/** A tracking link: scoped to exactly one booking (FR-GST-05). */
export async function trackingLink(
  bookingId: string = IDS.booking,
  guestId: string = IDS.guest,
): Promise<string> {
  return await signToken({
    kind: 'guest',
    claims: { sub: guestId, kind: 'guest', bookingId },
  });
}

/** An access token that expired an hour ago. */
export async function expiredToken(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: IDS.patient, kind: 'patient' },
    expiresIn: '-1h',
  });
}

/** A refresh token, for proving it is not accepted where access is expected. */
export async function refreshToken(): Promise<string> {
  return await signToken({ kind: 'refresh', claims: { sub: IDS.patient, kind: 'patient' } });
}

/** A staff token with no hospital scope, which must never authorise anything. */
export async function unscopedStaffToken(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: IDS.staff, kind: 'staff', roles: ['receptionist'] },
  });
}

/** A staff token with a hospital but no roles. */
export async function rolelessStaffToken(): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: IDS.staff, kind: 'staff', hospitalId: IDS.hospital, roles: [] },
  });
}

export const bearer = (token: string): string => `Bearer ${token}`;
