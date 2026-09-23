/**
 * The live serial screen's server half (BACKEND.md §7.1, §7.3).
 *
 * Three endpoints, and the thing they have in common is that a stranger holding
 * a URL is the caller:
 *
 *   `GET  /guest/link/:token`      opens `S-A-08` from an SMS, with no login
 *   `GET  /bookings/:id`           what that screen paints first
 *   `POST /bookings/:id/cancel`    `MOD-A08-CANCEL`
 *
 * So most of this file is about **scope**. A tracking link is the most exposed
 * credential in the product — it arrives by SMS, gets forwarded to relatives,
 * and sits in an inbox indefinitely (`FR-GST-05`) — and the tests that matter
 * are the ones proving a link for one booking cannot read, or cancel, another.
 * A forwarded SMS must not become a way to walk a hospital's queue.
 *
 * Runs against the seeded demo database, each test on a session of its own
 * (CLAUDE.md §6).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { StaffRole } from '@platform/domain';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { resetEmitter } from '../realtime/emit.js';
import * as queueService from '../services/queue.service.js';

import { labFixture, reportsOf, TINY_PDF_BASE64 } from './support/labFixture.js';
import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { IDS, bearer, patientToken, trackingLink } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

beforeEach(async () => {
  app = createApp();
  resetEmitter();
  fixture = await createQueueFixture(4);
});

/**
 * A staff token whose subject is a **real** seeded staff member.
 *
 * `queue_events.actor_staff_id` is a foreign key, so an invented id is refused
 * by the database — which is the behaviour that makes `FR-QUE-04` hold: an
 * unattributable queue action cannot be recorded at all.
 */
async function staff(
  roles: readonly StaffRole[] = ['receptionist'],
  hospitalId: string = fixture.hospitalId,
  sub: string = fixture.receptionistId,
): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub, kind: 'staff', hospitalId, roles } });
}

/** A guest booking with a real tracking link, as `POST /bookings` mints one. */
async function bookAsGuest(
  session: QueueFixture = fixture,
): Promise<{ bookingId: string; serial: number; token: string }> {
  const tail = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);

  const response = await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', crypto.randomUUID())
    .send({
      sessionId: session.sessionId,
      method: 'bkash',
      guest: {
        name: 'রহিমা খাতুন (ডেমো)',
        phone: `+88019${tail}`,
        ageYears: 34,
        sex: 'female',
      },
    });

  expect(response.status).toBe(201);

  const url = new URL(response.body.data.trackingUrl as string);
  const token = url.searchParams.get('t');
  if (token === null) throw new Error('the booking returned no tracking token');

  return {
    bookingId: response.body.data.bookingId as string,
    serial: response.body.data.serial as number,
    token,
  };
}

/** Opens a link and returns the short-lived token it issues. */
async function openLink(token: string): Promise<string> {
  const response = await request(app).get(`${BASE}/guest/link/${token}`);
  expect(response.status).toBe(200);
  return response.body.data.token as string;
}

describe('the tracking link opens the live serial screen (FR-GST-05)', () => {
  it('needs no account, and hands back the queue and the ETAs', async () => {
    const booked = await bookAsGuest();

    // No Authorization header of any kind. The token in the path is the
    // credential, which is the entire point: a person opens an SMS in a
    // corridor and sees their serial (`FR-GST-01`).
    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.booking.serial).toBe(booked.serial);
    expect(response.body.data.state.plan.sessionId).toBe(fixture.sessionId);
    expect(Array.isArray(response.body.data.etas)).toBe(true);
  });

  it('carries the chamber a patient needs in order to find the room', async () => {
    const booked = await bookAsGuest();

    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);
    const booking = response.body.data.booking as Record<string, unknown>;

    // Bangla first, because the screen is (`I18N-07`). A serial with no doctor
    // and no hospital beside it is a number nobody can act on.
    expect(booking['doctorNameBn']).toBeTruthy();
    expect(booking['hospitalNameBn']).toBeTruthy();
    expect(booking['plannedStart']).toBeTruthy();
  });

  it('stamps the figures with their age, not with the server clock (FR-PAT-35)', async () => {
    const booked = await bookAsGuest();

    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);

    // `freshAt` is when the queue last moved; `serverTs` is now. A screen that
    // read the second as the first would render "just now" forever, which is
    // the dishonesty `<FreshnessLine>` exists to prevent (`FR-OFF-03`).
    expect(response.body.data.freshAt).toBeTruthy();
    expect(response.body.data.serverTs).toBeTruthy();
  });

  it('exchanges the durable token for a short-lived one', async () => {
    const booked = await bookAsGuest();

    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);

    // The link lasts until the chamber closes plus a day; the token it hands
    // out lasts fifteen minutes. That asymmetry is what makes the credential
    // sitting in an SMS inbox revocable rather than permanent.
    expect(response.body.data.token).toBeTruthy();
    expect(response.body.data.token).not.toBe(booked.token);
    expect(response.body.data.expiresInSeconds).toBe(900);
  });

  it('the token it issues authorises that booking and no other', async () => {
    const mine = await bookAsGuest();
    const other = await bookAsGuest();
    const issued = await openLink(mine.token);

    const own = await request(app)
      .get(`${BASE}/bookings/${mine.bookingId}`)
      .set('Authorization', bearer(issued));
    expect(own.status).toBe(200);

    const theirs = await request(app)
      .get(`${BASE}/bookings/${other.bookingId}`)
      .set('Authorization', bearer(issued));

    // One forwarded SMS must not become a way to enumerate a hospital's queue.
    expect(theirs.status).toBe(403);
  });

  it('refuses a revoked link, and says nothing about why', async () => {
    const booked = await bookAsGuest();

    // Revocation is `FR-GST-05`'s third promise, and it is one row.
    await sql`
      UPDATE guest_links SET revoked_at = now() WHERE booking_id = ${booked.bookingId}::uuid
    `.execute(db);

    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);

    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('GUEST_LINK_EXPIRED');
  });

  it('refuses an expired link', async () => {
    const booked = await bookAsGuest();

    await sql`
      UPDATE guest_links SET expires_at = now() - interval '1 day'
       WHERE booking_id = ${booked.bookingId}::uuid
    `.execute(db);

    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`);
    expect(response.status).toBe(410);
  });

  it('answers a token that never existed exactly as it answers an expired one', async () => {
    const response = await request(app).get(`${BASE}/guest/link/${'a'.repeat(43)}`);

    // Deliberately indistinguishable. Telling a caller that a token *would*
    // have been valid is how a guessing attack learns it is getting warmer.
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('GUEST_LINK_EXPIRED');
  });

  it('rejects something that is not a token shape at all', async () => {
    const response = await request(app).get(`${BASE}/guest/link/short`);
    expect(response.status).toBe(400);
  });
});

describe('GET /bookings/:id — the auth matrix', () => {
  it('refuses an anonymous caller', async () => {
    const response = await request(app).get(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}`);
    expect(response.status).toBe(401);
  });

  it('refuses a signed-in patient asking for a booking that is not theirs', async () => {
    const response = await request(app)
      .get(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}`)
      .set('Authorization', bearer(await patientToken()));

    // The seeded bookings belong to nobody's account, so this token owns none
    // of them. Without this check, any account could read any serial by id.
    expect(response.status).toBe(403);
  });

  it('allows staff at the hospital running the session', async () => {
    const response = await request(app)
      .get(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}`)
      .set('Authorization', bearer(await staff()));

    expect(response.status).toBe(200);
    expect(response.body.data.booking.serial).toBe(1);
  });

  it('refuses staff from another hospital (FR-ROLE-01)', async () => {
    const response = await request(app)
      .get(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}`)
      .set('Authorization', bearer(await staff(['receptionist'], IDS.otherHospital)));

    expect(response.status).toBe(403);
  });

  it('refuses a tracking-link token scoped to a different booking', async () => {
    // The other way a link can arrive: `x-guest-token`, which is what the
    // middleware verifies against the guest-link secret. Both doors have to
    // be the same width (`FR-GST-05`).
    const response = await request(app)
      .get(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}`)
      .set('x-guest-token', await trackingLink(fixture.bookingIds[1] ?? ''));

    expect(response.status).toBe(403);
  });

  it('accepts a tracking-link token for the booking it names', async () => {
    const booked = await bookAsGuest();

    const response = await request(app)
      .get(`${BASE}/bookings/${booked.bookingId}`)
      // The guest id in the token is not what scopes it — `bookingId` is
      // (`FR-GST-05`), which is the property this asserts.
      .set('x-guest-token', await trackingLink(booked.bookingId));

    expect(response.status).toBe(200);
    expect(response.body.data.booking.serial).toBe(booked.serial);
  });

  it('answers 404 for a booking that does not exist', async () => {
    const response = await request(app)
      .get(`${BASE}/bookings/99999999-9999-7999-8999-999999999999`)
      .set('Authorization', bearer(await staff()));

    expect(response.status).toBe(404);
  });
});

describe('POST /bookings/:id/cancel (FR-PAT-23)', () => {
  it('lets the patient holding the link cancel their own serial', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    const response = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(200);

    const entry = (
      response.body.data.state.entries as { bookingId: string; status: string }[]
    ).find((candidate) => candidate.bookingId === booked.bookingId);
    expect(entry?.status).toBe('cancelled');
  });

  it('records why, because the row may not exist without it', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    const row = await sql<{ status: string; cancelled_reason: string | null }>`
      SELECT status::text AS status, cancelled_reason
        FROM bookings WHERE id = ${booked.bookingId}::uuid
    `.execute(db);

    // `bookings_cancelled_has_reason` is a database constraint. The screen
    // asks the patient nothing (`MOD-A08-CANCEL` is a confirm, not a form), so
    // what is recorded is who cancelled — which is what the refund rule
    // (`FR-PAY-03`) and the loss figure (`FR-ADM-03`) read.
    expect(row.rows[0]?.status).toBe('cancelled');
    expect(row.rows[0]?.cancelled_reason).toBeTruthy();
  });

  it('takes the patient out of the line but keeps the row (DB-P2)', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    const before = await queueService.waitingCount(fixture.sessionId);

    const response = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(200);
    expect(await queueService.waitingCount(fixture.sessionId)).toBe(before - 1);

    // History is never deleted: the row stays, carrying its serial, which is
    // what `bookings_session_serial_key` excludes from the live set so the
    // number can be reissued to a standby patient later (`FR-QUE-30`, whose
    // offer half is build step 15).
    const row = await sql<{ serial_number: number }>`
      SELECT serial_number FROM bookings WHERE id = ${booked.bookingId}::uuid
    `.execute(db);
    expect(row.rows[0]?.serial_number).toBe(booked.serial);
  });

  it('is idempotent: the same key twice cancels once', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);
    const key = crypto.randomUUID();
    const clientEventId = crypto.randomUUID();

    const first = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', key)
      .send({ clientEventId });

    const second = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', key)
      .send({ clientEventId });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // A patient on a bad connection tapping বাতিল করুন twice means it once.
    expect(second.body.data.seq).toBe(first.body.data.seq);
  });

  it('refuses a genuine second cancellation of the same booking', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    // A *different* key, so this is a second attempt rather than a replay: the
    // honest answer is that it is already cancelled.
    const again = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    expect(again.status).toBe(422);
    expect(again.body.error.details.guard).toBe('BOOKING_ALREADY_CANCELLED');
  });

  it('refuses a link scoped to a different booking', async () => {
    const mine = await bookAsGuest();
    const other = await bookAsGuest();
    const issued = await openLink(mine.token);

    const response = await request(app)
      .post(`${BASE}/bookings/${other.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    // Cancelling a stranger's serial from a forwarded SMS is the worst thing
    // this credential could be made to do.
    expect(response.status).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings/${fixture.bookingIds[0] ?? ''}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({});

    expect(response.status).toBe(401);
  });

  it('demands an idempotency key (FR-QUE-51)', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    const response = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/cancel`)
      .set('Authorization', bearer(issued))
      .send({});

    expect(response.status).toBe(400);
  });

  it('lets reception cancel at the counter, keeping the reason they gave', async () => {
    const response = await request(app)
      .post(`${BASE}/bookings/${fixture.bookingIds[1] ?? ''}/cancel`)
      .set('Authorization', bearer(await staff()))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'রোগী ফোনে বাতিল করেছেন' });

    expect(response.status).toBe(200);

    const row = await sql<{ cancelled_reason: string | null }>`
      SELECT cancelled_reason FROM bookings WHERE id = ${fixture.bookingIds[1] ?? ''}::uuid
    `.execute(db);

    // A stated reason is kept as stated; only an unstated one is filled in.
    expect(row.rows[0]?.cancelled_reason).toBe('রোগী ফোনে বাতিল করেছেন');
  });
});

describe('POST /bookings/:id/late — the patient declares it (FR-PAT-33)', () => {
  it('accepts it from the tracking link and re-inserts after k patients', async () => {
    const booked = await bookAsGuest();
    const issued = await openLink(booked.token);

    const response = await request(app)
      .post(`${BASE}/bookings/${booked.bookingId}/late`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ expectedMinutes: 20 });

    expect(response.status).toBe(200);

    const entry = (
      response.body.data.state.entries as {
        bookingId: string;
        late: { reinsertAfter: number } | null;
      }[]
    ).find((candidate) => candidate.bookingId === booked.bookingId);

    // Never dropped, re-inserted after three (`FR-QUE-21`).
    expect(entry?.late?.reinsertAfter).toBe(3);
  });

  it('refuses a link scoped to a different booking', async () => {
    const mine = await bookAsGuest();
    const other = await bookAsGuest();
    const issued = await openLink(mine.token);

    const response = await request(app)
      .post(`${BASE}/bookings/${other.bookingId}/late`)
      .set('Authorization', bearer(issued))
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ expectedMinutes: 20 });

    expect(response.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// `TAB-A12-REP`: the reports a link carries (`FR-GST-08`, `FR-LAB-03`)
// ---------------------------------------------------------------------------

describe('the tracking link carries the booking’s tests, and only those', () => {
  /** Orders a test on a booking, works it to a report, and delivers it. */
  async function testedBooking(): Promise<{
    token: string;
    bookingId: string;
    reportId: string;
  }> {
    const booked = await bookAsGuest();
    const shapla = await labFixture('Shapla General');

    // A doctor has to have signed a visit before a test can hang off it.
    const key = randomUUID();
    await request(app)
      .post(`${BASE}/visits`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', key)
      .send({ bookingId: booked.bookingId, diagnosisText: 'পরীক্ষা', idempotencyKey: key })
      .expect((response) => {
        expect([200, 201]).toContain(response.status);
      });

    const orderKey = randomUUID();
    const ordered = await request(app)
      .post(`${BASE}/test-orders`)
      .set('Authorization', bearer(shapla.doctorToken))
      .set('Idempotency-Key', orderKey)
      .send({
        bookingId: booked.bookingId,
        tests: [{ testCode: 'CBC' }],
        idempotencyKey: orderKey,
      });
    expect(ordered.status).toBe(201);

    const orderId = (ordered.body as { data: { orders: { id: string }[] } }).data.orders[0]?.id;
    if (orderId === undefined) throw new Error('no order was created');

    for (const action of ['collect', 'process'] as const) {
      await request(app)
        .patch(`${BASE}/test-orders/${orderId}/state`)
        .set('Authorization', bearer(shapla.labToken))
        .set('Idempotency-Key', randomUUID())
        .send({ action, idempotencyKey: randomUUID() })
        .expect(200);
    }

    const uploadKey = randomUUID();
    await request(app)
      .post(`${BASE}/test-orders/${orderId}/report`)
      .set('Authorization', bearer(shapla.labToken))
      .set('Idempotency-Key', uploadKey)
      .send({ fileType: 'application/pdf', content: TINY_PDF_BASE64, idempotencyKey: uploadKey })
      .expect(201);

    const [report] = await reportsOf(orderId);
    if (report === undefined) throw new Error('no report was written');

    return { token: booked.token, bookingId: booked.bookingId, reportId: report.id };
  }

  it('lists the tests this booking produced, with their delivered reports', async () => {
    const { token } = await testedBooking();

    const response = await request(app).get(`${BASE}/guest/link/${token}`).expect(200);
    const tests = (
      response.body as {
        data: { tests: { testCode: string; state: string; report: { id: string } | null }[] };
      }
    ).data.tests;

    expect(tests).toHaveLength(1);
    expect(tests[0]?.testCode).toBe('CBC');
    expect(tests[0]?.state).toBe('delivered');
    expect(tests[0]?.report).not.toBeNull();
  });

  it('carries no tests for a booking whose consultation ordered none', async () => {
    // Not an error and not an absence of reports — this person had no test.
    const booked = await bookAsGuest();
    const response = await request(app).get(`${BASE}/guest/link/${booked.token}`).expect(200);
    expect((response.body as { data: { tests: unknown[] } }).data.tests).toEqual([]);
  });

  it('opens a report through the link that carried it', async () => {
    const { token, reportId } = await testedBooking();

    const response = await request(app)
      .get(`${BASE}/guest/link/${token}/reports/${reportId}`)
      .expect(200);

    const url = (response.body as { data: { url: string } }).data.url;
    expect(url).toContain('/files/');

    // The URL it hands back actually serves the file.
    const file = await request(app).get(`${BASE}${url}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
  });

  it("refuses a report belonging to somebody else's visit", async () => {
    // The whole point of scoping the lookup to the link's own booking: a live
    // token must not become a key to another patient's results.
    const mine = await bookAsGuest();
    const theirs = await testedBooking();

    await request(app)
      .get(`${BASE}/guest/link/${mine.token}/reports/${theirs.reportId}`)
      .expect(404);
  });

  it('refuses a report id that was never real, with the same 404', async () => {
    const { token } = await testedBooking();
    await request(app).get(`${BASE}/guest/link/${token}/reports/${randomUUID()}`).expect(404);
  });

  it('refuses an expired link before it looks at the report at all', async () => {
    const { reportId } = await testedBooking();
    await request(app)
      .get(`${BASE}/guest/link/${'x'.repeat(43)}/reports/${reportId}`)
      .expect(410);
  });
});
