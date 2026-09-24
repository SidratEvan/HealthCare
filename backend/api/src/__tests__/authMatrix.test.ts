/**
 * The auth matrix (BACKEND.md §11: "every endpoint's auth matrix — patient /
 * guest / each staff role / wrong hospital").
 *
 * Written as a matrix rather than as a list of cases because the interesting
 * failures are the ones nobody writes a case for. "Does a receptionist from
 * another hospital get in" and "does a lab technician reach the queue" are
 * questions to answer by enumeration, not by reading the middleware — and
 * every later step adds its endpoints to the same shape.
 *
 * Permission gates under test come from APP_FLOW.md D3:
 *
 *   browse, emergency search, navigate      nothing, not even a phone number
 *   book, pay, bed request                  guest identity or logged-in profile
 *   track a guest booking                   the SMS link, scoped to it alone
 *   any console screen                      staff login + role + hospital scope
 */

import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { STAFF_ROLES, type StaffRole } from '@platform/domain';

import { apps } from './support/probeApp.js';
import {
  bearer,
  expiredToken,
  guestToken,
  IDS,
  nationalToken,
  patientToken,
  refreshToken,
  rolelessStaffToken,
  staffToken,
  trackingLink,
  unscopedStaffToken,
} from './support/tokens.js';

describe('a route with no guard (GR-08, FR-PAT-40)', () => {
  it('serves an anonymous caller, because emergency paths never gate', async () => {
    const response = await request(apps.public()).get('/probe');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, data: { principal: null } });
  });

  it('still identifies a caller who happens to be logged in', async () => {
    const response = await request(apps.public())
      .get('/probe')
      .set('authorization', bearer(await patientToken()));

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toEqual({ kind: 'patient', id: IDS.patient });
  });
});

describe('a route that requires a caller', () => {
  it('refuses with no credential', async () => {
    const response = await request(apps.authenticated()).get('/probe');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('admits a patient', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await patientToken()));

    expect(response.status).toBe(200);
  });

  it('admits a guest, because guest mode is not a downgrade (FR-GST-01)', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await guestToken()));

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toEqual({
      kind: 'guest',
      id: IDS.guest,
      bookingId: null,
    });
  });

  it('admits a staff member', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await staffToken(['receptionist'])));

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toMatchObject({
      kind: 'staff',
      hospitalId: IDS.hospital,
      roles: ['receptionist'],
    });
  });
});

describe('a broken credential is rejected, not ignored', () => {
  it.each([
    ['no scheme', 'sometoken'],
    ['wrong scheme', 'Basic dXNlcjpwYXNz'],
    ['empty bearer', 'Bearer '],
    ['not a jwt', 'Bearer not.a.jwt'],
    ['tampered signature', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.wrong'],
  ])('refuses %s', async (_label, header) => {
    const response = await request(apps.public()).get('/probe').set('authorization', header);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('refuses an expired token', async () => {
    const response = await request(apps.public())
      .get('/probe')
      .set('authorization', bearer(await expiredToken()));

    expect(response.status).toBe(401);
    expect(response.body.error.details.reason).toBe('expired');
  });

  it('refuses a refresh token presented as an access token', async () => {
    // Both are signed JWTs from the same issuer. Without the audience check a
    // 30-day credential would work wherever a 15-minute one does.
    const response = await request(apps.public())
      .get('/probe')
      .set('authorization', bearer(await refreshToken()));

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTH_TOKEN_INVALID');
  });

  it('does not silently downgrade a staff member to anonymous', async () => {
    // Treating a broken credential as "no credential" would hand a
    // receptionist an empty console instead of an error she can act on.
    const response = await request(apps.public())
      .get('/probe')
      .set('authorization', 'Bearer broken');

    expect(response.status).not.toBe(200);
  });
});

describe('a staff token missing its scope authorises nothing (FR-ROLE-01)', () => {
  it('refuses a staff token with no hospital', async () => {
    // A staff principal with no hospital would pass every scope check.
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await unscopedStaffToken()));

    expect(response.status).toBe(401);
    expect(response.body.error.details.reason).toBe('incomplete_claims');
  });

  it('refuses a staff token with no roles', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await rolelessStaffToken()));

    expect(response.status).toBe(401);
    expect(response.body.error.details.reason).toBe('incomplete_claims');
  });
});

describe('a national account belongs to no hospital (FR-ROLE-01, R10/R11)', () => {
  it('becomes a national principal when every role on it is national', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await nationalToken(['gov_viewer'])));

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toEqual({
      kind: 'national',
      id: IDS.staff,
      roles: ['gov_viewer'],
    });
  });

  it('is refused by a hospital role guard, whatever roles it lists', async () => {
    // `requireRole` admits hospital staff only. A government viewer is not
    // one, so no route written for a console can be reached with this token.
    const response = await request(apps.role('gov_viewer', 'receptionist'))
      .get('/probe')
      .set('authorization', bearer(await nationalToken(['gov_viewer'])));

    expect(response.status).toBe(403);
    expect(response.body.error.details.was).toBe('national');
  });

  it('is refused by a hospital scope check', async () => {
    const response = await request(apps.hospitalScoped('gov_viewer'))
      .get(`/probe/hospital/${IDS.hospital}`)
      .set('authorization', bearer(await nationalToken(['gov_viewer'])));

    expect(response.status).toBe(403);
  });

  it('does not let a hospital role ride along without a hospital', async () => {
    const response = await request(apps.authenticated())
      .get('/probe')
      .set('authorization', bearer(await nationalToken(['gov_viewer', 'ward'])));

    expect(response.status).toBe(401);
    expect(response.body.error.details.reason).toBe('incomplete_claims');
  });

  it('opens a national route, and a hospital token does not', async () => {
    const national = await request(apps.national('gov_viewer'))
      .get('/probe')
      .set('authorization', bearer(await nationalToken(['gov_viewer'])));
    expect(national.status).toBe(200);

    const hospital = await request(apps.national('gov_viewer'))
      .get('/probe')
      .set('authorization', bearer(await staffToken(['gov_viewer'])));
    expect(hospital.status).toBe(403);
    expect(hospital.body.error.details.was).toBe('staff');
  });

  it('refuses to build a national route that admits everyone', () => {
    expect(() => apps.national()).toThrow(/at least one role/);
  });
});

describe('role gating (FR-ROLE-02, FR-SEC-01)', () => {
  /**
   * Every role against a route that admits only receptionists and doctors —
   * the queue-advancing set (BACKEND.md §7.4).
   */
  const QUEUE_ROLES: readonly StaffRole[] = ['receptionist', 'doctor'];

  it.each(STAFF_ROLES)('%s against a receptionist-or-doctor route', async (role) => {
    const response = await request(apps.role(...QUEUE_ROLES))
      .get('/probe')
      .set('authorization', bearer(await staffToken([role])));

    const shouldPass = QUEUE_ROLES.includes(role);
    expect(response.status, `${role} expected ${shouldPass ? 'pass' : 'refusal'}`).toBe(
      shouldPass ? 200 : 403,
    );

    if (!shouldPass) {
      expect(response.body.error.code).toBe('AUTH_FORBIDDEN_SCOPE');
    }
  });

  it('admits a staff member who holds one of several roles (FR-ROLE-02)', async () => {
    // A doctor who is also an administrator.
    const response = await request(apps.role('receptionist'))
      .get('/probe')
      .set('authorization', bearer(await staffToken(['doctor', 'hospital_admin', 'receptionist'])));

    expect(response.status).toBe(200);
  });

  it('does not grant hospital_admin every role implicitly', async () => {
    // FR-ROLE-02 makes holding several roles normal, so an implicit hierarchy
    // would make an audit row ambiguous about which capacity someone acted in.
    const response = await request(apps.role('receptionist'))
      .get('/probe')
      .set('authorization', bearer(await staffToken(['hospital_admin'])));

    expect(response.status).toBe(403);
  });

  it('refuses a patient on a staff route', async () => {
    const response = await request(apps.role('receptionist'))
      .get('/probe')
      .set('authorization', bearer(await patientToken()));

    expect(response.status).toBe(403);
    expect(response.body.error.details.was).toBe('patient');
  });

  it('refuses a guest on a staff route', async () => {
    const response = await request(apps.role('receptionist'))
      .get('/probe')
      .set('authorization', bearer(await guestToken()));

    expect(response.status).toBe(403);
    expect(response.body.error.details.was).toBe('guest');
  });

  it('refuses to build a route that admits everyone', () => {
    // An empty role list would be a route that looks guarded and is not.
    expect(() => apps.role()).toThrow(/at least one role/);
  });
});

describe('hospital scoping (FR-ROLE-01)', () => {
  it('admits a receptionist reading her own hospital', async () => {
    const response = await request(apps.hospitalScoped('receptionist'))
      .get(`/probe/hospital/${IDS.hospital}`)
      .set('authorization', bearer(await staffToken(['receptionist'])));

    expect(response.status).toBe(200);
  });

  it('refuses a receptionist reading another hospital', async () => {
    const response = await request(apps.hospitalScoped('receptionist'))
      .get(`/probe/hospital/${IDS.otherHospital}`)
      .set('authorization', bearer(await staffToken(['receptionist'])));

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('wrong_hospital');
  });

  it.each(STAFF_ROLES.filter((role) => role !== 'platform_admin' && role !== 'gov_viewer'))(
    'refuses %s from another hospital',
    async (role) => {
      const response = await request(apps.hospitalScoped(role))
        .get(`/probe/hospital/${IDS.otherHospital}`)
        .set('authorization', bearer(await staffToken([role])));

      expect(response.status).toBe(403);
    },
  );

  it.each(['platform_admin', 'gov_viewer'] as const)(
    'admits %s anywhere, because the role is not hospital-scoped',
    async (role) => {
      const response = await request(apps.hospitalScoped(role))
        .get(`/probe/hospital/${IDS.otherHospital}`)
        .set('authorization', bearer(await staffToken([role], IDS.hospital)));

      expect(response.status).toBe(200);
    },
  );

  it('fails closed when the route promised a hospital id and did not supply one', async () => {
    // A routing mistake becomes a 403 rather than a cross-hospital read.
    const response = await request(apps.hospitalScoped('receptionist'))
      .get('/probe')
      .set('authorization', bearer(await staffToken(['receptionist'])));

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('missing_hospital_parameter');
  });
});

describe('the SMS tracking link (FR-GST-05)', () => {
  it('opens the booking it was issued for, with no login', async () => {
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('x-guest-token', await trackingLink());

    expect(response.status).toBe(200);
    expect(response.body.data.principal).toEqual({
      kind: 'guest',
      id: IDS.guest,
      bookingId: IDS.booking,
    });
  });

  it('works as a query parameter, because the link is a URL in a text message', async () => {
    const response = await request(apps.bookingScoped()).get(
      `/probe/booking/${IDS.booking}?token=${await trackingLink()}`,
    );

    expect(response.status).toBe(200);
  });

  it('refuses a different booking, so a forwarded link cannot enumerate a queue', async () => {
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.otherBooking}`)
      .set('x-guest-token', await trackingLink());

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('link_is_for_a_different_booking');
  });

  it('refuses a booking-flow guest token, which is not scoped to a booking', async () => {
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('authorization', bearer(await guestToken()));

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('guest_token_not_scoped_to_a_booking');
  });

  it('reports an expired link as expired, not as a login prompt', async () => {
    const { signToken } = await import('../config/jwt.js');
    const expired = await signToken({
      kind: 'guest',
      claims: { sub: IDS.guest, kind: 'guest', bookingId: IDS.booking },
      expiresIn: '-1h',
    });

    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('x-guest-token', expired);

    // 410: the link has done its job and the session is over. A 401 would tell
    // the patient to log in, which they cannot do — they have no account.
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('GUEST_LINK_EXPIRED');
  });

  it('refuses an access token presented as a tracking link', async () => {
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('x-guest-token', await patientToken());

    expect(response.status).toBe(401);
  });

  it('lets an account holder through the link guard, ownership being a database question', async () => {
    // Only the database knows which profiles an account owns (FR-PAT-03).
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('authorization', bearer(await patientToken()));

    expect(response.status).toBe(200);
  });

  it('does not let a forwarded link override a logged-in patient', async () => {
    const response = await request(apps.bookingScoped())
      .get(`/probe/booking/${IDS.booking}`)
      .set('authorization', bearer(await patientToken()))
      .set('x-guest-token', await trackingLink());

    expect(response.status).toBe(200);
    expect(response.body.data.principal.kind).toBe('patient');
  });
});

describe('patient-owned actions (FR-PAT-33)', () => {
  it.each([
    ['patient', async () => bearer(await patientToken())],
    ['guest', async () => bearer(await guestToken())],
  ])('admits a %s', async (_label, header) => {
    const response = await request(apps.owner())
      .get('/probe')
      .set('authorization', await header());

    expect(response.status).toBe(200);
  });

  it('refuses staff, so an audit row always names who moved the queue', async () => {
    // The console has its own routes with their own role checks (FR-QUE-04).
    const response = await request(apps.owner())
      .get('/probe')
      .set('authorization', bearer(await staffToken(['receptionist'])));

    expect(response.status).toBe(403);
    expect(response.body.error.details.reason).toBe('staff_must_use_console_routes');
  });
});
