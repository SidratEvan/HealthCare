/**
 * One hospital set against another, on every route there is (plan B2;
 * `FR-SEC-11`, `FR-NET-01`, `FR-NET-02`, `FR-ROLE-01`).
 *
 * Each router has an auth matrix of its own, written with it. What none of
 * them is, is one place that answers "can somebody at hospital A reach
 * hospital B through this API?" for every route, the one added next month
 * included.
 *
 * ## How it stays complete
 *
 * The routes are read off the router the server mounts, not listed by hand.
 * `KEPT` says, for each one, how it is kept to one hospital, or why it need
 * not be. A route with no entry fails the first test, so a route cannot be
 * added without somebody deciding which kind it is.
 *
 * ## What is asked
 *
 * Two seeded hospitals, each given the same things of its own: a chamber with
 * two patients, a ward, a case in its ER, an import, and so on. Then, as a
 * member of A's staff who holds every role A can give (so that no role gate
 * answers before the question of *whose* is reached):
 *
 *   - `path`: the route names a hospital. Named B, it is refused.
 *   - `row`: the route names a row. Given B's row, it is refused, and for B's
 *     own staff the same read is answered, which is what makes the refusal
 *     mean something.
 *   - `body`: the route is A's own but its body names a row. Given B's, it
 *     is refused, and not by a failure nobody chose (a 5xx).
 *   - `principal`: nothing in the request can name a hospital. Its reads
 *     hold nothing of B's.
 *
 * And then the thing the statuses are for: B is, row for row, what it was
 * before any of it.
 *
 * The same requests are made as a platform administrator and as a national
 * viewer, who belong to no hospital and get none of it; as nobody; and the
 * platform's and the nation's own routes as A's staff. A patient's routes are
 * asked for another patient's, and a tracking link for another booking.
 *
 * This suite connects as the API's own role, which the policies of migration
 * 0043 bind: a refusal here may be the application's or the database's, and
 * the suite does not care which.
 *
 * ## What is not here, and where it is
 *
 * Live rooms. A console's hospital rooms are joined from its principal and
 * cannot be asked for; a chamber's room is asked for, and its refusal to
 * another hospital, to a patient with no booking there and to a link for a
 * booking elsewhere is in `realtime.test.ts`. What crosses on purpose, a
 * referral to its two ends and a record under the patient's consent, is in
 * `referral.routes.test.ts` and `clinical.routes.test.ts`; here they are only
 * shown not to cross without it.
 */

import { randomInt, randomUUID } from 'node:crypto';

import { sql, type RawBuilder } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FACILITY_ROLES } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { buildApiRouter } from '../routes/index.js';

import { TINY_PDF_BASE64, stockedMedicine } from './support/labFixture.js';
import { staffIdFor } from './support/queueFixture.js';
import { bearer, nationalToken, patientToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** Seeded hospitals that staff every console (`FR-DEM-01`). A has no seeded referral. */
const A_CODE = 'KARNAPHULI';
const B_CODE = 'PADMA';

/** The structure template's columns (`FR-IMP-01`), for a file with one department in it. */
const STRUCTURE_HEADER =
  'type,ref,name_bn,name_en,code,bmdc_number,degrees,specialties,department_ref,room,fee_taka,doctor_ref,weekday,start,end,serials,ward_ref,floor,bed_kind,bed_label,nightly_taka,role,email';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Call {
  readonly path: string;
  readonly query?: Readonly<Record<string, string>>;
  readonly body?: Readonly<Record<string, unknown>>;
}

/** What one hospital is given, so that the other has something to reach for. */
interface Side {
  readonly hospitalId: string;
  /** A real account at this hospital, holding every role it can give. */
  readonly token: string;
  readonly sessionId: string;
  readonly bookingIds: readonly [string, string];
  /** Two people registered at this counter: a number and a name, as a guest books. */
  readonly patientIds: readonly [string, string];
  readonly patientPhone: string;
  /** The identity that number is, which a tracking link is issued to. */
  readonly guestId: string;
  /** A person this hospital imported, who is the hospital's alone until claimed (`FR-IMP-10`). */
  readonly importedPatientId: string;
  readonly importedPhone: string;
  readonly eventId: string;
  readonly wardId: string;
  readonly bedIds: readonly [string, string];
  readonly bedRequestId: string;
  readonly departmentId: string;
  readonly doctorHospitalId: string;
  readonly templateId: string;
  readonly staffId: string;
  readonly caseId: string;
  readonly testOrderId: string;
  readonly paymentId: string;
  readonly offerId: string;
  readonly importBatchId: string;
  readonly medicineId: string;
}

interface World {
  readonly a: Side;
  readonly b: Side;
  /** A referral A is at neither end of. */
  readonly referralId: string;
  /** A hospital with an ER that is neither A nor B. */
  readonly thirdHospitalId: string;
}

type Asked = (mine: Side, theirs: Side, world: World) => Call;

/** How a route is kept to one hospital, or why it need not be. */
type Kept =
  /** Nobody's credential: what hospitals publish (`FR-NET-01`). */
  | { readonly by: 'public' }
  /** A token in the path is the credential, and names the one thing it opens. */
  | { readonly by: 'token' }
  /** Signing in and out, and one's own account. */
  | { readonly by: 'account' }
  /** The password-less door, which exists only while `DEMO_MODE` is on. */
  | { readonly by: 'demo' }
  /** A payment provider's callback: the signature is the credential. */
  | { readonly by: 'provider' }
  /** A patient's or a guest's own. Asked for somebody else's further down. */
  | { readonly by: 'patient' }
  /** Staff. The hospital comes off the principal and the request cannot name one. */
  | { readonly by: 'principal'; readonly own?: Asked; readonly sample?: Asked }
  /** Staff. The path names a hospital. */
  | { readonly by: 'path'; readonly other: Asked; readonly own?: Asked }
  /** Staff. The path names a row that is some hospital's. */
  | { readonly by: 'row'; readonly other: Asked; readonly smuggled?: readonly Asked[] }
  /** Staff. The route is one's own; the body names a row that is some hospital's. */
  | { readonly by: 'body'; readonly smuggled: readonly Asked[] }
  /** The platform administrator's (`FR-ONB-08`). */
  | { readonly by: 'platform' }
  /** The national viewer's, aggregate only (`FR-GOV-06`). */
  | { readonly by: 'national' };

const envelope = (): Record<string, unknown> => ({
  clientEventId: randomUUID(),
  clientTs: new Date().toISOString(),
});
const keyed = (): Record<string, unknown> => ({ idempotencyKey: randomUUID() });
const today = new Date().toISOString().slice(0, 10);
const deskPerson = {
  name: 'রফিক (ডেমো)',
  phone: `+88018${String(randomInt(10_000_000, 99_999_999))}`,
  ageYears: 50,
  sex: 'male',
};

/** A session's route, aimed at the other hospital's chamber. */
const session =
  (rest: string, body?: () => Record<string, unknown>): Asked =>
  (_mine, theirs) => ({
    path: `/sessions/${theirs.sessionId}/${rest}`,
    body: { ...envelope(), ...body?.() },
  });
const booking =
  (rest: string, body?: () => Record<string, unknown>): Asked =>
  (_mine, theirs) => ({
    path: `/bookings/${theirs.bookingIds[0]}/${rest}`,
    body: { ...envelope(), ...body?.() },
  });
const bed =
  (rest: string, body?: (theirs: Side) => Record<string, unknown>): Asked =>
  (_mine, theirs) => ({
    path: `/beds/${theirs.bedIds[0]}/${rest}`,
    body: { ...envelope(), ...body?.(theirs) },
  });
const referral =
  (rest: string, body?: () => Record<string, unknown>): Asked =>
  (_mine, _theirs, world) => ({
    path: `/referrals/${world.referralId}/${rest}`,
    body: { ...envelope(), ...body?.() },
  });
const batch =
  (rest: string): Asked =>
  (_mine, theirs) => ({ path: `/hospital/imports/${theirs.importBatchId}/${rest}`, body: {} });

const KEPT: Readonly<Record<string, Kept>> = {
  // --- what hospitals publish -------------------------------------------------
  'GET /config': { by: 'public' },
  'GET /search': { by: 'public' },
  'GET /hospitals': { by: 'public' },
  'GET /hospitals/:id': { by: 'public' },
  'GET /hospitals/:id/doctors': { by: 'public' },
  'GET /hospitals/:id/logo': { by: 'public' },
  'GET /doctors': { by: 'public' },
  'GET /doctors/:id': { by: 'public' },
  'GET /sessions': { by: 'public' },
  'GET /sessions/:id/availability': { by: 'public' },
  'GET /medicines': { by: 'public' },
  'GET /emergency/search': { by: 'public' },
  // Asking, with no account: a booking, a bed, a place on a standby list, an
  // alert that somebody is on the way (`FR-GST-01`, `GR-08`).
  'POST /bookings': { by: 'public' },
  'POST /bed-requests': { by: 'public' },
  'POST /sessions/:id/standby': { by: 'public' },
  'POST /emergency/inbound': { by: 'public' },

  // --- a token in the path ------------------------------------------------------
  'GET /guest/link/:token': { by: 'token' },
  'GET /guest/link/:token/reports/:reportId': { by: 'token' },
  'GET /standby/:token': { by: 'token' },
  'POST /standby/:token/accept': { by: 'token' },
  'POST /standby/:token/decline': { by: 'token' },
  'POST /standby/:token/leave': { by: 'token' },
  'GET /bed-requests/track/:token': { by: 'token' },
  'GET /emergency/track/:token': { by: 'token' },
  'POST /emergency/track/:token/cancel': { by: 'token' },
  'GET /files/:key': { by: 'token' },

  // --- signing in and out -------------------------------------------------------
  'POST /staff/login': { by: 'account' },
  'POST /staff/refresh': { by: 'account' },
  'POST /staff/logout': { by: 'account' },
  'GET /staff/me': { by: 'account' },
  'POST /staff/password': { by: 'account' },
  'POST /staff/2fa': { by: 'account' },
  'POST /staff/2fa/setup': { by: 'account' },
  'POST /staff/2fa/enable': { by: 'account' },
  'POST /auth/otp': { by: 'account' },
  'POST /auth/verify': { by: 'account' },
  'POST /auth/refresh': { by: 'account' },
  'POST /auth/logout': { by: 'account' },
  'POST /guest/start': { by: 'account' },
  'POST /guest/verify': { by: 'account' },
  'GET /demo/status': { by: 'demo' },
  'GET /demo/consoles': { by: 'demo' },
  'POST /demo/token': { by: 'demo' },
  'POST /webhooks/bkash': { by: 'provider' },
  'POST /webhooks/nagad': { by: 'provider' },

  // --- a patient's own ----------------------------------------------------------
  'GET /me/profiles': { by: 'patient' },
  'POST /guest/claim': { by: 'patient' },
  'POST /patients/:id/consent-offer': { by: 'patient' },
  'POST /consents': { by: 'patient' },
  'POST /consents/:id/revoke': { by: 'patient' },
  'GET /patients/:id/access': { by: 'patient' },

  // --- the queue ----------------------------------------------------------------
  'GET /staff/chambers': { by: 'principal', own: () => ({ path: '/staff/chambers' }) },
  'GET /sessions/:id/queue': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/sessions/${theirs.sessionId}/queue` }),
  },
  'POST /sessions/:id/arrived': { by: 'row', other: session('arrived') },
  'POST /sessions/:id/delay': {
    by: 'row',
    other: session('delay', () => ({ minutes: 10, declaredBy: 'reception' })),
  },
  'POST /sessions/:id/pause': { by: 'row', other: session('pause') },
  'POST /sessions/:id/resume': { by: 'row', other: session('resume') },
  'POST /sessions/:id/end': { by: 'row', other: session('end') },
  'POST /sessions/:id/next': { by: 'row', other: session('next') },
  'POST /sessions/:id/walkin': {
    by: 'row',
    other: (mine, theirs) => ({
      path: `/sessions/${theirs.sessionId}/walkin`,
      body: { ...envelope(), patientId: mine.patientIds[0] },
    }),
  },
  'POST /sessions/:id/reorder': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/sessions/${theirs.sessionId}/reorder`,
      body: { ...envelope(), bookingId: theirs.bookingIds[1], toIndex: 0, reason: 'matrix' },
    }),
    // A's own chamber, B's patient moved to the front of it.
    smuggled: [
      (mine, theirs) => ({
        path: `/sessions/${mine.sessionId}/reorder`,
        body: { ...envelope(), bookingId: theirs.bookingIds[0], toIndex: 0, reason: 'matrix' },
      }),
    ],
  },
  'GET /sessions/:id/standby': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/sessions/${theirs.sessionId}/standby` }),
  },
  'POST /bookings/:id/done': { by: 'row', other: booking('done') },
  'POST /bookings/:id/late': { by: 'row', other: booking('late', () => ({ expectedMinutes: 10 })) },
  'POST /bookings/:id/no-show': { by: 'row', other: booking('no-show') },
  'POST /bookings/:id/reinstate': { by: 'row', other: booking('reinstate') },
  'POST /bookings/:id/check-in': {
    by: 'row',
    other: booking('check-in', () => ({ quotedWaitMinutes: 10 })),
  },
  'POST /bookings/:id/offer-slot': { by: 'row', other: booking('offer-slot') },
  'POST /bookings/:id/cancel': { by: 'row', other: booking('cancel') },
  'GET /bookings/:id': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/bookings/${theirs.bookingIds[0]}` }),
  },
  'GET /bookings/:id/payments': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/bookings/${theirs.bookingIds[0]}/payments` }),
  },
  'POST /offers/:id/accept': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/offers/${theirs.offerId}/accept`, body: envelope() }),
  },
  'POST /events/:id/undo': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/events/${theirs.eventId}/undo`, body: envelope() }),
  },
  'POST /sync/events': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/sync/events',
        body: {
          sessionId: theirs.sessionId,
          events: [{ clientEventId: randomUUID(), type: 'DOCTOR_ARRIVED', payload: {} }],
        },
      }),
    ],
  },
  'GET /sync/session/:id': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/sync/session/${theirs.sessionId}` }),
  },

  // --- the counter --------------------------------------------------------------
  // The lookup is by a phone, and a phone is not a hospital's: what it may not
  // do is hand A the person B registered.
  'GET /registration/patients': {
    by: 'principal',
    own: (_mine, theirs) => ({
      path: '/registration/patients',
      query: { phone: theirs.importedPhone },
    }),
  },
  'POST /registration/patients': { by: 'principal' },

  // --- records ------------------------------------------------------------------
  'GET /patients/:id/records': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/patients/${theirs.patientIds[0]}/records` }),
  },
  'POST /visits': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/visits',
        body: { ...keyed(), bookingId: theirs.bookingIds[0], diagnosisText: 'matrix' },
      }),
    ],
  },
  // The code is the patient's to give, and names the patient; the hospital it
  // opens the record to is the doctor's own.
  'POST /consents/qr': {
    by: 'principal',
    sample: () => ({ path: '/consents/qr', body: { ...keyed(), code: 'x'.repeat(40) } }),
  },

  // --- beds ---------------------------------------------------------------------
  'GET /hospitals/:id/beds': {
    by: 'path',
    other: (_mine, theirs) => ({ path: `/hospitals/${theirs.hospitalId}/beds` }),
    own: (mine) => ({ path: `/hospitals/${mine.hospitalId}/beds` }),
  },
  'GET /hospitals/:id/bed-requests': {
    by: 'path',
    other: (_mine, theirs) => ({ path: `/hospitals/${theirs.hospitalId}/bed-requests` }),
    own: (mine) => ({ path: `/hospitals/${mine.hospitalId}/bed-requests` }),
  },
  'GET /beds/:id': { by: 'row', other: (_mine, theirs) => ({ path: `/beds/${theirs.bedIds[0]}` }) },
  'POST /beds/:id/admit': {
    by: 'row',
    other: bed('admit', () => ({ patient: deskPerson })),
    smuggled: [
      // A's own bed, for B's pending request.
      (mine, theirs) => ({
        path: `/beds/${mine.bedIds[0]}/admit`,
        body: { ...envelope(), bedRequestId: theirs.bedRequestId },
      }),
      // A's own bed, for a case in B's ER.
      (mine, theirs) => ({
        path: `/beds/${mine.bedIds[0]}/admit`,
        body: { ...envelope(), emergencyCaseId: theirs.caseId, patient: deskPerson },
      }),
    ],
  },
  'POST /beds/:id/discharge': { by: 'row', other: bed('discharge') },
  'POST /beds/:id/transfer': {
    by: 'row',
    other: bed('transfer', (theirs) => ({ toBedId: theirs.bedIds[1] })),
    // Out of A's own bed, into one of B's.
    smuggled: [
      (mine, theirs) => ({
        path: `/beds/${mine.bedIds[0]}/transfer`,
        body: { ...envelope(), toBedId: theirs.bedIds[0] },
      }),
    ],
  },
  'POST /beds/:id/reserve': { by: 'row', other: bed('reserve', () => ({ minutes: 30 })) },
  'POST /beds/:id/release': { by: 'row', other: bed('release') },
  'POST /beds/:id/clean-start': { by: 'row', other: bed('clean-start') },
  'POST /beds/:id/clean-done': { by: 'row', other: bed('clean-done') },
  'POST /beds/:id/oos': { by: 'row', other: bed('oos', () => ({ reason: 'matrix' })) },
  'POST /beds/:id/restore': { by: 'row', other: bed('restore') },
  'POST /beds/:id/expected-discharge': {
    by: 'row',
    other: bed('expected-discharge', () => ({ date: null })),
  },
  'POST /bed-requests/:id/respond': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/bed-requests/${theirs.bedRequestId}/respond`,
      body: { ...envelope(), action: 'decline' },
    }),
    // A's own request, held in one of B's beds.
    smuggled: [
      (mine, theirs) => ({
        path: `/bed-requests/${mine.bedRequestId}/respond`,
        body: { ...envelope(), action: 'hold', bedId: theirs.bedIds[0], minutes: 30 },
      }),
    ],
  },

  // --- the ER -------------------------------------------------------------------
  'GET /hospitals/:id/emergency': {
    by: 'path',
    other: (_mine, theirs) => ({ path: `/hospitals/${theirs.hospitalId}/emergency` }),
    own: (mine) => ({ path: `/hospitals/${mine.hospitalId}/emergency` }),
  },
  'PUT /hospitals/:id/capabilities': {
    by: 'path',
    other: (_mine, theirs) => ({
      path: `/hospitals/${theirs.hospitalId}/capabilities`,
      body: { ...envelope(), capabilities: [{ kind: 'burn_unit', available: false }] },
    }),
  },
  'POST /emergency/cases': { by: 'principal' },
  'GET /emergency/cases/:id/contact': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/emergency/cases/${theirs.caseId}/contact` }),
  },
  'POST /emergency/cases/:id/acknowledge': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/emergency/cases/${theirs.caseId}/acknowledge`,
      body: envelope(),
    }),
  },
  'PATCH /emergency/cases/:id': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/emergency/cases/${theirs.caseId}`,
      body: { ...envelope(), action: 'triage', triage: 'red' },
    }),
  },
  'POST /referrals': {
    by: 'body',
    smuggled: [
      // B's case, sent on by A.
      (_mine, theirs, world) => ({
        path: '/referrals',
        body: {
          ...envelope(),
          emergencyCaseId: theirs.caseId,
          toHospitalId: world.thirdHospitalId,
          requiredBedKind: 'icu',
        },
      }),
    ],
  },
  'POST /referrals/:id/seen': { by: 'row', other: referral('seen') },
  'POST /referrals/:id/accept': { by: 'row', other: referral('accept') },
  'POST /referrals/:id/decline': {
    by: 'row',
    other: referral('decline', () => ({ reason: 'matrix' })),
  },
  'POST /referrals/:id/cancel': { by: 'row', other: referral('cancel') },
  'POST /referrals/:id/arrive': { by: 'row', other: referral('arrive') },

  // --- the lab and the pharmacy -------------------------------------------------
  'GET /lab/catalogue': { by: 'principal', own: () => ({ path: '/lab/catalogue' }) },
  'POST /test-orders': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/test-orders',
        body: { ...keyed(), bookingId: theirs.bookingIds[0], tests: [{ testCode: 'CBC' }] },
      }),
    ],
  },
  'GET /hospitals/:hospitalId/test-orders': {
    by: 'path',
    other: (_mine, theirs) => ({ path: `/hospitals/${theirs.hospitalId}/test-orders` }),
    own: (mine) => ({ path: `/hospitals/${mine.hospitalId}/test-orders`, query: { state: 'all' } }),
  },
  'PATCH /test-orders/:id/state': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/test-orders/${theirs.testOrderId}/state`,
      body: { ...keyed(), action: 'cancel' },
    }),
  },
  'POST /test-orders/:id/report': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/test-orders/${theirs.testOrderId}/report`,
      body: { ...keyed(), fileType: 'application/pdf', content: TINY_PDF_BASE64 },
    }),
  },
  'GET /test-orders/:id/patient': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/test-orders/${theirs.testOrderId}/patient` }),
  },
  'GET /hospitals/:hospitalId/pharmacy-stock': {
    by: 'path',
    other: (_mine, theirs) => ({ path: `/hospitals/${theirs.hospitalId}/pharmacy-stock` }),
    own: (mine) => ({ path: `/hospitals/${mine.hospitalId}/pharmacy-stock` }),
  },
  'PUT /hospitals/:hospitalId/pharmacy-stock': {
    by: 'path',
    other: (_mine, theirs) => ({
      path: `/hospitals/${theirs.hospitalId}/pharmacy-stock`,
      body: { ...keyed(), flags: [{ medicineId: theirs.medicineId, inStock: false }] },
    }),
  },

  // --- money --------------------------------------------------------------------
  'POST /payments/intent': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/payments/intent',
        body: { ...keyed(), bookingId: theirs.bookingIds[0], method: 'at_hospital' },
      }),
    ],
  },
  'POST /payments/:id/refund': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/payments/${theirs.paymentId}/refund`,
      body: { ...keyed(), reason: 'doctor_absent' },
    }),
  },
  'GET /hospitals/:hospitalId/settlement': {
    by: 'path',
    other: (_mine, theirs) => ({
      path: `/hospitals/${theirs.hospitalId}/settlement`,
      query: { from: today, to: today },
    }),
    own: (mine) => ({
      path: `/hospitals/${mine.hospitalId}/settlement`,
      query: { from: today, to: today },
    }),
  },

  // --- the administrator's ------------------------------------------------------
  'GET /admin/dashboard': { by: 'principal', own: () => ({ path: '/admin/dashboard' }) },
  'GET /admin/export': { by: 'principal' },
  'GET /hospital/setup': { by: 'principal', own: () => ({ path: '/hospital/setup' }) },
  'PATCH /hospital/profile': { by: 'principal' },
  'PATCH /hospital/rules': { by: 'principal' },
  // Its public face (`FR-BRD-06`): its own, from the principal.
  'PUT /hospital/brand': { by: 'principal' },
  'GET /hospital/logo': { by: 'principal' },
  'PUT /hospital/logo': { by: 'principal' },
  'DELETE /hospital/logo': { by: 'principal' },
  'POST /hospital/departments': { by: 'principal' },
  'PATCH /hospital/departments/:id': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/hospital/departments/${theirs.departmentId}`,
      body: { nameEn: 'Matrix (Demo)' },
    }),
  },
  'POST /hospital/doctors': {
    by: 'body',
    smuggled: [
      // A new doctor at A, filed under one of B's departments.
      (_mine, theirs) => ({
        path: '/hospital/doctors',
        body: {
          nameBn: 'ডা. ম্যাট্রিক্স (ডেমো)',
          nameEn: 'Dr Matrix (Demo)',
          bmdcNumber: `A-${String(randomInt(1_000_000, 9_999_999))}`,
          departmentId: theirs.departmentId,
          feePoisha: 50_000,
        },
      }),
    ],
  },
  'PATCH /hospital/doctors/:id': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/hospital/doctors/${theirs.doctorHospitalId}`,
      body: { room: 'M-1' },
    }),
  },
  'POST /hospital/templates': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/hospital/templates',
        body: {
          doctorHospitalId: theirs.doctorHospitalId,
          weekday: 1,
          startTime: '03:00',
          endTime: '04:00',
        },
      }),
    ],
  },
  'DELETE /hospital/templates/:id': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/hospital/templates/${theirs.templateId}` }),
  },
  'POST /hospital/wards': { by: 'principal' },
  'POST /hospital/beds': {
    by: 'body',
    smuggled: [
      (_mine, theirs) => ({
        path: '/hospital/beds',
        body: { wardId: theirs.wardId, labels: ['MX-1'], kind: 'general', nightlyPoisha: 100_000 },
      }),
    ],
  },
  'PATCH /hospital/beds/:id': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/hospital/beds/${theirs.bedIds[0]}`,
      body: { label: 'MX-9' },
    }),
  },
  'POST /hospital/staff': { by: 'principal' },
  'PATCH /hospital/staff/:id': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/hospital/staff/${theirs.staffId}`,
      body: { isActive: false },
    }),
  },
  'POST /hospital/staff/:id/reset-password': {
    by: 'row',
    other: (_mine, theirs) => ({
      path: `/hospital/staff/${theirs.staffId}/reset-password`,
      body: {},
    }),
  },
  'POST /hospital/staff/:id/reset-2fa': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/hospital/staff/${theirs.staffId}/reset-2fa`, body: {} }),
  },
  'PUT /hospital/capabilities': { by: 'principal' },
  'POST /hospital/request-review': { by: 'principal' },

  // --- the hospital's own data, imported ----------------------------------------
  'GET /hospital/imports/templates/:set': {
    by: 'principal',
    own: () => ({ path: '/hospital/imports/templates/structure' }),
  },
  'GET /hospital/imports': { by: 'principal', own: () => ({ path: '/hospital/imports' }) },
  'GET /hospital/imports/:id': {
    by: 'row',
    other: (_mine, theirs) => ({ path: `/hospital/imports/${theirs.importBatchId}` }),
  },
  'POST /hospital/imports': { by: 'principal' },
  'POST /hospital/imports/analyse': { by: 'principal' },
  'POST /hospital/imports/mapped': { by: 'principal' },
  'POST /hospital/imports/:id/commit': { by: 'row', other: batch('commit') },
  'POST /hospital/imports/:id/undo': { by: 'row', other: batch('undo') },
  'POST /hospital/imports/:id/discard': { by: 'row', other: batch('discard') },

  // --- the platform's and the nation's ------------------------------------------
  'GET /platform/hospitals': { by: 'platform' },
  'GET /platform/hospitals/:id': { by: 'platform' },
  'POST /platform/hospitals': { by: 'platform' },
  'POST /platform/hospitals/:id/approve': { by: 'platform' },
  'POST /platform/hospitals/:id/send-back': { by: 'platform' },
  'POST /platform/hospitals/:id/suspend': { by: 'platform' },
  'POST /platform/hospitals/:id/reinstate': { by: 'platform' },
  'POST /platform/hospitals/:id/close': { by: 'platform' },
  'POST /platform/hospitals/:id/doctors/:doctorId/verify': { by: 'platform' },
  'POST /platform/hospitals/:id/domain': { by: 'platform' },
  'GET /gov/capacity': { by: 'national' },
  'GET /gov/er-load': { by: 'national' },
  'GET /gov/signals': { by: 'national' },
  'GET /gov/benchmarks': { by: 'national' },
};

// ---------------------------------------------------------------------------
// The routes the server mounts
// ---------------------------------------------------------------------------

interface LayerLike {
  readonly route?: { readonly path: unknown; readonly stack: readonly { method?: string }[] };
  readonly handle?: unknown;
}

function layersOf(router: unknown): readonly LayerLike[] {
  const stack = (router as { stack?: unknown }).stack;
  return Array.isArray(stack) ? (stack as LayerLike[]) : [];
}

/** Every `METHOD /path` the versioned API answers, read off the router itself. */
function mountedRoutes(): string[] {
  const found = new Set<string>();
  const walk = (router: unknown): void => {
    for (const layer of layersOf(router)) {
      if (layer.route === undefined) {
        walk(layer.handle);
        continue;
      }
      if (typeof layer.route.path !== 'string') {
        throw new Error('A route with a pattern for a path: name it in this matrix by hand.');
      }
      for (const handler of layer.route.stack) {
        if (handler.method !== undefined) {
          found.add(`${handler.method.toUpperCase()} ${layer.route.path}`);
        }
      }
    }
  };
  walk(buildApiRouter());
  return [...found].sort();
}

const methodOf = (key: string): Method => key.slice(0, key.indexOf(' ')) as Method;
const patternOf = (key: string): string => key.slice(key.indexOf(' ') + 1);

/** The route's own path with something in every parameter: enough to reach its gate. */
function anyCall(key: string): Call {
  const path = patternOf(key)
    .replace(':set', 'structure')
    .replace(/:[A-Za-z]+/g, () => randomUUID());
  return { path };
}

/** Whether a call is a call to this route, and not to its neighbour. */
function matches(key: string, call: Call): boolean {
  const pattern = patternOf(key).replace(/:[A-Za-z]+/g, '[^/]+');
  return new RegExp(`^${pattern}$`).test(call.path) && !call.path.includes('undefined');
}

// ---------------------------------------------------------------------------
// Asking
// ---------------------------------------------------------------------------

let app: Express;
let world: World;
let before: Record<string, string>;
let platformToken: string;
let govToken: string;
/** Ids of rows that are B's and nobody else's. */
let theirs: ReadonlySet<string>;

async function send(token: string | null, method: Method, call: Call): Promise<request.Response> {
  const url = `${BASE}${call.path}`;
  const agent = request(app);
  let pending: request.Test;
  switch (method) {
    case 'GET':
      pending = agent.get(url);
      break;
    case 'POST':
      pending = agent.post(url);
      break;
    case 'PUT':
      pending = agent.put(url);
      break;
    case 'PATCH':
      pending = agent.patch(url);
      break;
    case 'DELETE':
      pending = agent.delete(url);
      break;
  }
  if (call.query !== undefined) pending = pending.query(call.query);
  if (token !== null) pending = pending.set('Authorization', bearer(token));
  if (method === 'GET') return await pending;
  return await pending.set('Idempotency-Key', randomUUID()).send(call.body ?? {});
}

const said = (response: request.Response): string =>
  `${String(response.status)} ${JSON.stringify(response.body).slice(0, 300)}`;

// ---------------------------------------------------------------------------
// The two hospitals
// ---------------------------------------------------------------------------

async function one<T>(query: RawBuilder<T>, what: string): Promise<T> {
  const row = (await query.execute(db)).rows[0];
  if (row === undefined) throw new Error(`The matrix needs ${what}, and found none.`);
  return row;
}

async function stock(code: string): Promise<Side> {
  const { id: hospitalId } = await one(
    sql<{ id: string }>`SELECT id FROM hospitals WHERE code = ${code} AND deleted_at IS NULL`,
    `the seeded hospital ${code}`,
  );
  const adminId = await staffIdFor(hospitalId, 'hospital_admin');
  const token = await signToken({
    kind: 'access',
    claims: { sub: adminId, kind: 'staff', hospitalId, roles: [...FACILITY_ROLES] },
  });
  const tag = randomUUID().slice(0, 8);

  // Two people registered at this counter, and nowhere else.
  const patientPhone = `+88018${String(randomInt(10_000_000, 99_999_999))}`;
  for (const fullName of [`মিলা ${tag} (ডেমো)`, `রনি ${tag} (ডেমো)`]) {
    const registered = await send(token, 'POST', {
      path: '/registration/patients',
      body: { phone: patientPhone, fullName, ageYears: 40, sex: 'female' },
    });
    if (registered.status >= 300) throw new Error(`registering: ${said(registered)}`);
  }
  const people = await sql<{ id: string }>`
    SELECT id FROM patients WHERE phone = ${patientPhone} AND deleted_at IS NULL
     ORDER BY created_at, id
  `.execute(db);
  const [firstPatient, secondPatient] = people.rows;
  if (firstPatient === undefined || secondPatient === undefined) {
    throw new Error('The counter should have registered two people.');
  }
  const { owner_guest_id: guestId } = await one(
    sql<{ owner_guest_id: string }>`
      SELECT owner_guest_id FROM patients
       WHERE id = ${firstPatient.id}::uuid AND owner_guest_id IS NOT NULL
    `,
    'the guest identity the counter made',
  );

  const importedPhone = `+88018${String(randomInt(10_000_000, 99_999_999))}`;
  const { id: importedPatientId } = await one(
    sql<{ id: string }>`
      INSERT INTO patients (owner_hospital_id, full_name, age_years, sex, phone)
      VALUES (${hospitalId}::uuid, ${`আমদানি ${tag} (ডেমো)`}, 47, 'male', ${importedPhone})
      RETURNING id
    `,
    'an imported patient',
  );

  // A chamber of its own, with both of them in it.
  const chamber = await one(
    sql<{ id: string; doctor_id: string; department_id: string; fee_poisha: number }>`
      SELECT dh.id, dh.doctor_id, dh.department_id, dh.fee_poisha
        FROM doctor_hospitals dh
       WHERE dh.hospital_id = ${hospitalId}::uuid AND dh.deleted_at IS NULL AND dh.is_active
       ORDER BY dh.created_at, dh.id
       LIMIT 1
    `,
    'a seeded chamber',
  );
  const { id: sessionId } = await one(
    sql<{ id: string }>`
      INSERT INTO sessions
        (hospital_id, doctor_id, department_id, room, session_date,
         planned_start, planned_end, capacity, fee_poisha)
      VALUES (
        ${hospitalId}::uuid, ${chamber.doctor_id}::uuid, ${chamber.department_id}::uuid, 'MATRIX',
        (now() AT TIME ZONE 'Asia/Dhaka')::date, now() - interval '30 minutes',
        now() + interval '150 minutes', 40, ${chamber.fee_poisha}
      )
      RETURNING id
    `,
    'a session',
  );
  const bookingIds: string[] = [];
  for (const [index, patientId] of [firstPatient.id, secondPatient.id].entries()) {
    const made = await one(
      sql<{ id: string }>`
        INSERT INTO bookings (session_id, patient_id, serial_number, source, fee_poisha, intake)
        VALUES (${sessionId}::uuid, ${patientId}::uuid, ${index + 1}, 'app',
                ${chamber.fee_poisha}, '{"demo":true}'::jsonb)
        RETURNING id
      `,
      'a booking',
    );
    bookingIds.push(made.id);
  }
  const [firstBooking, secondBooking] = bookingIds;
  if (firstBooking === undefined || secondBooking === undefined) throw new Error('two bookings');

  const arrived = await send(token, 'POST', {
    path: `/sessions/${sessionId}/arrived`,
    body: envelope(),
  });
  if (arrived.status >= 300) throw new Error(`the doctor arriving: ${said(arrived)}`);
  const { id: eventId } = await one(
    sql<{ id: string }>`
      SELECT id FROM queue_events WHERE session_id = ${sessionId}::uuid ORDER BY seq DESC LIMIT 1
    `,
    'the event of the doctor arriving',
  );

  // A ward of its own.
  const { id: wardId } = await one(
    sql<{ id: string }>`
      INSERT INTO wards (hospital_id, name_bn, name_en, floor, kind, created_by)
      VALUES (${hospitalId}::uuid, ${`ম্যাট্রিক্স ওয়ার্ড ${tag} (ডেমো)`},
              ${`Matrix Ward ${tag} (Demo)`}, 9, 'general', ${adminId}::uuid)
      RETURNING id
    `,
    'a ward',
  );
  const bedIds: string[] = [];
  for (const index of [1, 2]) {
    const made = await one(
      sql<{ id: string }>`
        INSERT INTO beds (hospital_id, ward_id, label, kind, nightly_poisha, created_by)
        VALUES (${hospitalId}::uuid, ${wardId}::uuid, ${`M${tag}-${String(index)}`},
                'general', 150000, ${adminId}::uuid)
        RETURNING id
      `,
      'a bed',
    );
    bedIds.push(made.id);
  }
  const [firstBed, secondBed] = bedIds;
  if (firstBed === undefined || secondBed === undefined) throw new Error('two beds');

  // A family asking it for a bed, the way a family does: with no account.
  const asked = await send(null, 'POST', {
    path: '/bed-requests',
    body: {
      hospitalId,
      bedKind: 'general',
      patient: {
        name: `আসমা ${tag} (ডেমো)`,
        phone: `+88018${String(randomInt(10_000_000, 99_999_999))}`,
        ageYears: 61,
        sex: 'female',
      },
    },
  });
  if (asked.status >= 300) throw new Error(`a bed request: ${said(asked)}`);
  const { id: bedRequestId } = await one(
    sql<{ id: string }>`
      SELECT id FROM bed_requests WHERE hospital_id = ${hospitalId}::uuid AND deleted_at IS NULL
       ORDER BY created_at DESC, id LIMIT 1
    `,
    'the bed request',
  );

  // A case in its ER, registered at its own desk.
  const caseKey = randomUUID();
  const walkedIn = await send(token, 'POST', {
    path: '/emergency/cases',
    body: { clientEventId: caseKey, clientTs: new Date().toISOString(), problem: 'accident' },
  });
  if (walkedIn.status >= 300) throw new Error(`a walk-in: ${said(walkedIn)}`);
  const { id: caseId } = await one(
    sql<{ id: string }>`
      SELECT id FROM emergency_cases
       WHERE hospital_id = ${hospitalId}::uuid AND idempotency_key::text = ${caseKey}
    `,
    'the walk-in case',
  );

  // An import, checked and not written.
  const uploaded = await send(token, 'POST', {
    path: '/hospital/imports',
    body: {
      set: 'structure',
      fileName: `matrix-${tag}.csv`,
      csv: [
        STRUCTURE_HEADER,
        `department,D-1,ম্যাট্রিক্স ${tag} (ডেমো),Matrix ${tag} (Demo),MX${tag.slice(0, 4)}${','.repeat(STRUCTURE_HEADER.split(',').length - 5)}`,
      ].join('\r\n'),
    },
  });
  if (uploaded.status >= 300) throw new Error(`an import: ${said(uploaded)}`);
  const { id: importBatchId } = await one(
    sql<{ id: string }>`
      SELECT id FROM import_batches WHERE hospital_id = ${hospitalId}::uuid
       ORDER BY created_at DESC, id LIMIT 1
    `,
    'the import batch',
  );

  // And what the seed already gave it.
  const { id: templateId } = await one(
    sql<{ id: string }>`
      SELECT st.id FROM session_templates st
        JOIN doctor_hospitals dh ON dh.id = st.doctor_hospital_id
       WHERE dh.hospital_id = ${hospitalId}::uuid AND st.deleted_at IS NULL
       ORDER BY st.created_at, st.id LIMIT 1
    `,
    'a weekly schedule',
  );
  const { id: testOrderId } = await one(
    sql<{ id: string }>`
      SELECT id FROM test_orders WHERE hospital_id = ${hospitalId}::uuid AND deleted_at IS NULL
       ORDER BY created_at, id LIMIT 1
    `,
    'a test order',
  );
  const { id: paymentId } = await one(
    sql<{ id: string }>`
      SELECT p.id FROM payments p
        JOIN bookings k ON k.id = p.booking_id
        JOIN sessions s ON s.id = k.session_id
       WHERE s.hospital_id = ${hospitalId}::uuid AND p.deleted_at IS NULL
       ORDER BY p.created_at, p.id LIMIT 1
    `,
    'a payment',
  );
  const { id: offerId } = await one(
    sql<{ id: string }>`
      SELECT o.id FROM slot_offers o JOIN sessions s ON s.id = o.session_id
       WHERE s.hospital_id = ${hospitalId}::uuid
       ORDER BY o.created_at, o.id LIMIT 1
    `,
    'a slot offer',
  );

  return {
    hospitalId,
    token,
    sessionId,
    bookingIds: [firstBooking, secondBooking],
    patientIds: [firstPatient.id, secondPatient.id],
    patientPhone,
    guestId,
    importedPatientId,
    importedPhone,
    eventId,
    wardId,
    bedIds: [firstBed, secondBed],
    bedRequestId,
    departmentId: chamber.department_id,
    doctorHospitalId: chamber.id,
    templateId,
    staffId: await staffIdFor(hospitalId, 'receptionist'),
    caseId,
    testOrderId,
    paymentId,
    offerId,
    importBatchId,
    medicineId: (await stockedMedicine(hospitalId)).medicineId,
  };
}

/**
 * B as the database has it: its own rows whole, and how many of each kind of
 * thing the hospital holds. A row changed, added or taken away shows.
 */
async function stateOf(side: Side, referralId: string): Promise<Record<string, string>> {
  const h = sql`${side.hospitalId}::uuid`;
  const s = sql`${side.sessionId}::uuid`;
  const w = sql`${side.wardId}::uuid`;
  const result = await sql<{ what: string; mark: string }>`
    SELECT 'hospital' AS what, md5(x::text) AS mark FROM hospitals x WHERE x.id = ${h}
    UNION ALL SELECT 'session', md5(x::text) FROM sessions x WHERE x.id = ${s}
    UNION ALL SELECT 'queue state', md5(coalesce(string_agg(x::text, '|'), ''))
                FROM queue_state x WHERE x.session_id = ${s}
    UNION ALL SELECT 'bookings', md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
                FROM bookings x WHERE x.session_id = ${s}
    UNION ALL SELECT 'queue events', count(*)::text FROM queue_events x WHERE x.session_id = ${s}
    UNION ALL SELECT 'standby', count(*)::text FROM standby_list x WHERE x.session_id = ${s}
    UNION ALL SELECT 'offer', md5(x::text) FROM slot_offers x WHERE x.id = ${side.offerId}::uuid
    UNION ALL SELECT 'ward', md5(x::text) FROM wards x WHERE x.id = ${w}
    UNION ALL SELECT 'beds', md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
                FROM beds x WHERE x.ward_id = ${w}
    UNION ALL SELECT 'bed events', count(*)::text
                FROM bed_events x JOIN beds y ON y.id = x.bed_id WHERE y.ward_id = ${w}
    UNION ALL SELECT 'bed request', md5(x::text)
                FROM bed_requests x WHERE x.id = ${side.bedRequestId}::uuid
    UNION ALL SELECT 'case', md5(x::text) FROM emergency_cases x WHERE x.id = ${side.caseId}::uuid
    UNION ALL SELECT 'referral', md5(x::text) FROM referrals x WHERE x.id = ${referralId}::uuid
    UNION ALL SELECT 'test order', md5(x::text)
                FROM test_orders x WHERE x.id = ${side.testOrderId}::uuid
    UNION ALL SELECT 'reports', count(*)::text
                FROM reports x WHERE x.test_order_id = ${side.testOrderId}::uuid
    UNION ALL SELECT 'payment', md5(x::text) FROM payments x WHERE x.id = ${side.paymentId}::uuid
    UNION ALL SELECT 'import', md5(x::text)
                FROM import_batches x WHERE x.id = ${side.importBatchId}::uuid
    UNION ALL SELECT 'schedule', md5(x::text)
                FROM session_templates x WHERE x.id = ${side.templateId}::uuid
    UNION ALL SELECT 'department', md5(x::text)
                FROM departments x WHERE x.id = ${side.departmentId}::uuid
    UNION ALL SELECT 'chamber', md5(x::text)
                FROM doctor_hospitals x WHERE x.id = ${side.doctorHospitalId}::uuid
    UNION ALL SELECT 'staff member', md5(x::text)
                FROM staff_users x WHERE x.id = ${side.staffId}::uuid
    UNION ALL SELECT 'roles', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
                FROM staff_roles x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'settings', md5(coalesce(string_agg(x::text, '|'), ''))
                FROM hospital_settings x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'capabilities', md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), ''))
                FROM capabilities x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'stock', md5(coalesce(string_agg(x::text, '|' ORDER BY x.id), ''))
                FROM pharmacy_stock x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many departments', count(*)::text FROM departments x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many chambers', count(*)::text FROM doctor_hospitals x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many schedules', count(*)::text
                FROM session_templates x JOIN doctor_hospitals y ON y.id = x.doctor_hospital_id
               WHERE y.hospital_id = ${h}
    UNION ALL SELECT 'how many sessions', count(*)::text FROM sessions x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many wards', count(*)::text FROM wards x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many beds', count(*)::text FROM beds x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many admissions', count(*)::text FROM admissions x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many bed requests', count(*)::text FROM bed_requests x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many cases', count(*)::text FROM emergency_cases x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many referrals', count(*)::text
                FROM referrals x WHERE x.from_hospital_id = ${h} OR x.to_hospital_id = ${h}
    UNION ALL SELECT 'how many test orders', count(*)::text FROM test_orders x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many visits', count(*)::text FROM visits x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many consents', count(*)::text FROM consents x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many imports', count(*)::text FROM import_batches x WHERE x.hospital_id = ${h}
    UNION ALL SELECT 'how many staff', count(*)::text FROM staff_users x WHERE x.hospital_id = ${h}
  `.execute(db);
  return Object.fromEntries(result.rows.map((row) => [row.what, row.mark]));
}

/** The ids of rows that are this hospital's and nobody else's. */
async function idsOf(side: Side): Promise<Set<string>> {
  const h = sql`${side.hospitalId}::uuid`;
  const result = await sql<{ id: string }>`
    SELECT id::text AS id FROM beds WHERE hospital_id = ${h}
    UNION SELECT id::text FROM wards WHERE hospital_id = ${h}
    UNION SELECT id::text FROM departments WHERE hospital_id = ${h}
    UNION SELECT id::text FROM doctor_hospitals WHERE hospital_id = ${h}
    UNION SELECT id::text FROM sessions WHERE hospital_id = ${h}
    UNION SELECT k.id::text FROM bookings k JOIN sessions s ON s.id = k.session_id
           WHERE s.hospital_id = ${h}
    UNION SELECT id::text FROM staff_users WHERE hospital_id = ${h}
    UNION SELECT id::text FROM test_orders WHERE hospital_id = ${h}
    UNION SELECT id::text FROM bed_requests WHERE hospital_id = ${h}
    UNION SELECT id::text FROM import_batches WHERE hospital_id = ${h}
    UNION SELECT id::text FROM admissions WHERE hospital_id = ${h}
    UNION SELECT id::text FROM pharmacy_stock WHERE hospital_id = ${h}
    UNION SELECT id::text FROM emergency_cases WHERE hospital_id = ${h}
  `.execute(db);
  return new Set([
    side.hospitalId,
    ...side.patientIds,
    side.importedPatientId,
    ...result.rows.map((row) => row.id),
  ]);
}

function heldOf(response: request.Response, ids: ReadonlySet<string>): string[] {
  const text = JSON.stringify(response.body);
  const uuids = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) ?? [];
  return [...new Set(uuids)].filter((id) => ids.has(id));
}

beforeAll(async () => {
  app = createApp();
  const a = await stock(A_CODE);
  const b = await stock(B_CODE);

  const { id: referralId } = await one(
    sql<{ id: string }>`
      SELECT id FROM referrals
       WHERE (from_hospital_id = ${b.hospitalId}::uuid OR to_hospital_id = ${b.hospitalId}::uuid)
         AND from_hospital_id <> ${a.hospitalId}::uuid AND to_hospital_id <> ${a.hospitalId}::uuid
         AND deleted_at IS NULL
       ORDER BY created_at, id LIMIT 1
    `,
    'a seeded referral A is at neither end of',
  );
  const { hospital_id: thirdHospitalId } = await one(
    sql<{ hospital_id: string }>`
      SELECT hospital_id FROM staff_roles
       WHERE role = 'emergency' AND deleted_at IS NULL
         AND hospital_id NOT IN (${a.hospitalId}::uuid, ${b.hospitalId}::uuid)
       ORDER BY hospital_id LIMIT 1
    `,
    'a third hospital with an ER',
  );

  world = { a, b, referralId, thirdHospitalId };
  platformToken = await nationalToken(['platform_admin']);
  govToken = await nationalToken(['gov_viewer']);
  theirs = await idsOf(b);
  before = await stateOf(b, referralId);
}, 120_000);

afterAll(async () => {
  // The two checked imports are this suite's own; neither was written.
  if ((world as World | undefined) === undefined) return;
  for (const side of [world.a, world.b]) {
    await send(side.token, 'POST', {
      path: `/hospital/imports/${side.importBatchId}/discard`,
      body: {},
    });
  }
});

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

const entries = Object.entries(KEPT);
const staffKinds: readonly Kept['by'][] = ['principal', 'path', 'row', 'body'];
const guarded = entries.filter(([, kept]) =>
  [...staffKinds, 'platform', 'national'].includes(kept.by),
);

describe('every route says how it is kept to one hospital', () => {
  it('no route is mounted that this matrix does not name, and none is named that is not mounted', () => {
    expect(Object.keys(KEPT).sort()).toEqual(mountedRoutes());
  });

  it('each request below is a request to the route it is filed under', () => {
    const { a, b } = world;
    for (const [key, kept] of entries) {
      const calls: Call[] = [];
      if ('other' in kept) calls.push(kept.other(a, b, world));
      if ('own' in kept && kept.own !== undefined) calls.push(kept.own(a, b, world));
      if ('smuggled' in kept) {
        for (const asked of kept.smuggled ?? []) calls.push(asked(a, b, world));
      }
      for (const call of calls) expect(matches(key, call), `${key} ← ${call.path}`).toBe(true);
    }
  });
});

describe('a member of one hospital’s staff, holding every role it gives (FR-SEC-11)', () => {
  const named = entries.filter(
    (entry): entry is [string, Extract<Kept, { by: 'path' | 'row' }>] =>
      entry[1].by === 'path' || entry[1].by === 'row',
  );

  it.each(named)('%s: the other hospital’s is refused', async (key, kept) => {
    const response = await send(world.a.token, methodOf(key), kept.other(world.a, world.b, world));
    expect([403, 404], said(response)).toContain(response.status);
    expect(heldOf(response, theirs)).toEqual([]);
  });

  const reads = named.filter(([key, kept]) => kept.by === 'row' && methodOf(key) === 'GET');

  it.each(reads)('%s: and is there, for the hospital whose it is', async (key, kept) => {
    const response = await send(world.b.token, 'GET', kept.other(world.a, world.b, world));
    expect(response.status, said(response)).toBe(200);
  });

  const smuggling = entries.flatMap(([key, kept]) =>
    'smuggled' in kept
      ? (kept.smuggled ?? []).map((asked, index) => [key, index, asked] as const)
      : [],
  );

  it.each(smuggling)(
    '%s (%i): its own, naming the other hospital’s row, is refused',
    async (key, _index, asked) => {
      const response = await send(world.a.token, methodOf(key), asked(world.a, world.b, world));
      expect(response.status, said(response)).toBeGreaterThanOrEqual(400);
      // Refused on purpose, not by something breaking.
      expect(response.status, said(response)).toBeLessThan(500);
      expect(heldOf(response, theirs)).toEqual([]);
    },
  );

  const own = entries.flatMap(([key, kept]) =>
    'own' in kept && kept.own !== undefined ? [[key, kept.own] as const] : [],
  );

  it.each(own)('%s: its own holds nothing of the other hospital’s', async (key, asked) => {
    const response = await send(world.a.token, methodOf(key), asked(world.a, world.b, world));
    expect(response.status, said(response)).toBe(200);
    expect(heldOf(response, theirs)).toEqual([]);
  });

  const platform = entries.filter(([, kept]) => kept.by === 'platform' || kept.by === 'national');

  it.each(platform)('%s: is not a hospital’s to ask', async (key) => {
    const response = await send(world.a.token, methodOf(key), anyCall(key));
    expect(response.status, said(response)).toBe(403);
  });
});

describe('an account that belongs to no hospital (FR-ROLE-01, FR-ONB-08)', () => {
  const staffs = entries.filter(([, kept]) => staffKinds.includes(kept.by));

  /** The request most likely to be answered: the other hospital's row where the route names one. */
  const callFor = (key: string, kept: Kept): Call => {
    if ('other' in kept) return kept.other(world.a, world.b, world);
    if ('smuggled' in kept) return kept.smuggled[0]?.(world.a, world.b, world) ?? anyCall(key);
    if ('sample' in kept && kept.sample !== undefined) return kept.sample(world.a, world.b, world);
    return anyCall(key);
  };

  it.each(staffs)('%s: a platform administrator is refused', async (key, kept) => {
    const response = await send(platformToken, methodOf(key), callFor(key, kept));
    expect([403, 404], said(response)).toContain(response.status);
    expect(heldOf(response, theirs)).toEqual([]);
  });

  it.each(staffs)('%s: a national viewer is refused', async (key, kept) => {
    const response = await send(govToken, methodOf(key), callFor(key, kept));
    expect([403, 404], said(response)).toContain(response.status);
    expect(heldOf(response, theirs)).toEqual([]);
  });

  it('the platform reads its hospitals and nobody in them', async () => {
    const response = await send(platformToken, 'GET', { path: '/platform/hospitals' });
    expect(response.status, said(response)).toBe(200);
    const text = JSON.stringify(response.body);
    for (const patientId of [...world.a.patientIds, ...world.b.patientIds]) {
      expect(text).not.toContain(patientId);
    }
    const one = await send(platformToken, 'GET', {
      path: `/platform/hospitals/${world.b.hospitalId}`,
    });
    expect(one.status, said(one)).toBe(200);
    expect(JSON.stringify(one.body)).not.toContain(world.b.patientPhone);
  });
});

describe('nobody at all', () => {
  it.each(guarded)('%s: is asked who they are', async (key, kept) => {
    const call = 'other' in kept ? kept.other(world.a, world.b, world) : anyCall(key);
    const response = await send(null, methodOf(key), call);
    expect(response.status, said(response)).toBe(401);
  });
});

describe('a patient, and a tracking link (FR-GST-05, FR-NET-02)', () => {
  it('a patient account reaches no other person’s bookings or record', async () => {
    // A real account, with profiles of its own: somebody else's all the same.
    const { owner_user_id: accountId } = await one(
      sql<{ owner_user_id: string }>`
        SELECT owner_user_id FROM patients
         WHERE owner_user_id IS NOT NULL AND deleted_at IS NULL
         ORDER BY created_at, id LIMIT 1
      `,
      'a seeded patient account',
    );
    const stranger = await patientToken(accountId);
    const { b } = world;
    const asked: readonly (readonly [Method, Call])[] = [
      ['GET', { path: `/bookings/${b.bookingIds[0]}` }],
      ['POST', { path: `/bookings/${b.bookingIds[0]}/cancel`, body: envelope() }],
      ['POST', { path: `/bookings/${b.bookingIds[0]}/late`, body: { expectedMinutes: 10 } }],
      ['GET', { path: `/bookings/${b.bookingIds[0]}/payments` }],
      ['GET', { path: `/patients/${b.patientIds[0]}/records` }],
      ['GET', { path: `/patients/${b.patientIds[0]}/access` }],
      ['POST', { path: `/patients/${b.patientIds[0]}/consent-offer`, body: {} }],
      [
        'POST',
        {
          path: '/payments/intent',
          body: { ...keyed(), bookingId: b.bookingIds[0], method: 'at_hospital' },
        },
      ],
    ];
    for (const [method, call] of asked) {
      const response = await send(stranger, method, call);
      expect([403, 404], `${method} ${call.path}: ${said(response)}`).toContain(response.status);
      expect(heldOf(response, theirs)).toEqual([]);
    }
  });

  it('a tracking link opens the booking it names and no other', async () => {
    const { b } = world;
    // What opening the link in an SMS hands the screen: a short token for the
    // identity the number is, naming the one booking (`guest.service`).
    const link = await signToken({
      kind: 'access',
      claims: { sub: b.guestId, kind: 'guest', bookingId: b.bookingIds[0] },
    });
    const mine = await send(link, 'GET', { path: `/bookings/${b.bookingIds[0]}` });
    expect(mine.status, said(mine)).toBe(200);

    const asked: readonly (readonly [Method, Call])[] = [
      ['GET', { path: `/bookings/${b.bookingIds[1]}` }],
      ['POST', { path: `/bookings/${b.bookingIds[1]}/cancel`, body: envelope() }],
      ['POST', { path: `/bookings/${b.bookingIds[1]}/late`, body: { expectedMinutes: 10 } }],
      ['GET', { path: `/bookings/${b.bookingIds[1]}/payments` }],
      ['GET', { path: `/bookings/${world.a.bookingIds[0]}` }],
      [
        'POST',
        {
          path: '/payments/intent',
          body: { ...keyed(), bookingId: b.bookingIds[1], method: 'at_hospital' },
        },
      ],
    ];
    for (const [method, call] of asked) {
      const response = await send(link, method, call);
      expect([403, 404], `${method} ${call.path}: ${said(response)}`).toContain(response.status);
    }
  });

  // The one thing about a person that crosses between hospitals with no
  // referral and no consent, and it is written down so that it cannot change
  // by accident in either direction: a number and a name given at one counter
  // are the same person at the next (`FR-GST-12`, `FR-GST-13`, `FR-REC-20`).
  // Whether `FR-NET-02` means it should not is the owner's to rule on
  // (`docs/STATUS.md`, question Q7). What a hospital imported does not cross
  // (`FR-IMP-10`), which the matrix above asks of the same lookup.
  it('a number given at one counter is the same person at the next, and an imported one is not', async () => {
    const { a, b } = world;
    const given = await send(a.token, 'GET', {
      path: '/registration/patients',
      query: { phone: b.patientPhone },
    });
    expect(given.status, said(given)).toBe(200);
    expect(heldOf(given, new Set(b.patientIds)).sort()).toEqual([...b.patientIds].sort());

    const imported = await send(a.token, 'GET', {
      path: '/registration/patients',
      query: { phone: b.importedPhone },
    });
    expect(imported.status, said(imported)).toBe(200);
    expect(JSON.stringify(imported.body)).not.toContain(b.importedPatientId);

    const own = await send(b.token, 'GET', {
      path: '/registration/patients',
      query: { phone: b.importedPhone },
    });
    expect(JSON.stringify(own.body)).toContain(b.importedPatientId);
  });

  it('a hospital’s own app shows that hospital and no other (FR-BRD-02)', async () => {
    const scope = { scope: A_CODE };
    for (const path of ['/hospitals', '/doctors', '/search']) {
      const response = await send(null, 'GET', { path, query: scope });
      expect(response.status, said(response)).toBe(200);
      expect(heldOf(response, theirs), path).toEqual([]);
    }
    const config = await send(null, 'GET', { path: '/config', query: scope });
    expect(config.status, said(config)).toBe(200);
    expect(JSON.stringify(config.body)).toContain(world.a.hospitalId);
  });
});

describe('and after all of it', () => {
  it('the other hospital is, row for row, what it was', async () => {
    expect(await stateOf(world.b, world.referralId)).toEqual(before);
  });
});
