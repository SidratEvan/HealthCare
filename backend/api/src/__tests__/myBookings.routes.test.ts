/**
 * A signed-in patient's own serials (plan F1; `PRD.md` `FR-PAT-03`,
 * `FR-PAT-39`, `FR-GST-10`; `S-A-09`).
 *
 * Until this branch a signed-in patient still booked as a guest, and My
 * serials was whatever one phone remembered. What this file holds to: an
 * account books for a profile of its own and for nobody else's; it is given a
 * link to the live screen, as a guest is; its serials are listed from the
 * server, its own and no other person's, with where each stands; and a phone
 * that holds no link for one of them can ask for one, for its own bookings
 * only.
 *
 * Every account here is a seeded one, and every booking is made in a chamber
 * the fixture adds to the demo data.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, guestToken, nationalToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;

interface Account {
  readonly userId: string;
  readonly patientId: string;
  readonly token: string;
}

/**
 * Two seeded accounts, each with a profile that has no serial with this
 * doctor today: the same profile is not booked twice with one doctor in a day
 * (`FR-PAT-24`), and every test here books.
 */
async function twoAccounts(doctorId: string): Promise<[Account, Account]> {
  const rows = await sql<{ user_id: string; patient_id: string }>`
    SELECT DISTINCT ON (p.owner_user_id) p.owner_user_id AS user_id, p.id AS patient_id
      FROM patients p
     WHERE p.owner_user_id IS NOT NULL AND p.deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM bookings b JOIN sessions s ON s.id = b.session_id
          WHERE b.patient_id = p.id AND b.deleted_at IS NULL AND s.doctor_id = ${doctorId}
            AND s.session_date = (now() AT TIME ZONE 'Asia/Dhaka')::date
       )
     ORDER BY p.owner_user_id, p.id
     LIMIT 2
  `.execute(db);
  const made = await Promise.all(
    rows.rows.map(async (row) => ({
      userId: row.user_id,
      patientId: row.patient_id,
      token: await patientToken(row.user_id),
    })),
  );
  const [first, second] = made;
  if (first === undefined || second === undefined) {
    throw new Error('The seed should hold two accounts with a profile free to book.');
  }
  return [first, second];
}

async function bookAs(
  account: Account,
  patientId: string = account.patientId,
  key: string = randomUUID(),
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/bookings`)
    .set('Authorization', bearer(account.token))
    .set('Idempotency-Key', key)
    .send({ sessionId: fixture.sessionId, method: 'at_hospital', patientId });
}

interface Listed {
  readonly bookingId: string;
  readonly serial: number;
  readonly standing: string;
  readonly patientId: string;
  readonly sessionId: string;
  readonly hospitalId: string;
  readonly plannedStart: string;
}

async function listOf(account: Account): Promise<{ bookings: Listed[]; serverTs: string }> {
  const response = await request(app)
    .get(`${BASE}/me/bookings`)
    .set('Authorization', bearer(account.token));
  expect(response.status).toBe(200);
  return response.body.data as { bookings: Listed[]; serverTs: string };
}

function askLink(token: string | null, bookingId: string): request.Test {
  const pending = request(app)
    .post(`${BASE}/me/bookings/${bookingId}/link`)
    .set('Idempotency-Key', randomUUID());
  return token === null ? pending : pending.set('Authorization', bearer(token));
}

/** The opaque token a tracking link carries. */
function tokenOf(url: string): string {
  return new URL(url, 'http://localhost').searchParams.get('t') ?? '';
}

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  fixture = await createQueueFixture(2);
});

describe('a signed-in patient books as themselves (FR-PAT-03, FR-GST-10)', () => {
  it('for a profile of their own, with nothing retyped, and is given a link that opens', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const response = await bookAs(mine);
    expect(response.status).toBe(201);
    const { bookingId, serial, trackingUrl } = response.body.data as {
      bookingId: string;
      serial: number;
      trackingUrl: string | null;
    };
    expect(serial).toBeGreaterThan(0);

    // The account's, for the profile it named, and not a guest's.
    const row = await sql<{
      booked_by_user_id: string | null;
      booked_by_guest_id: string | null;
      patient_id: string;
      source: string;
    }>`
      SELECT booked_by_user_id, booked_by_guest_id, patient_id, source::text AS source
        FROM bookings WHERE id = ${bookingId}
    `.execute(db);
    expect(row.rows[0]).toEqual({
      booked_by_user_id: mine.userId,
      booked_by_guest_id: null,
      patient_id: mine.patientId,
      source: 'app',
    });

    // A link to the live screen, as a guest is given, and it opens this booking.
    expect(trackingUrl).not.toBeNull();
    const opened = await request(app).get(`${BASE}/guest/link/${tokenOf(trackingUrl ?? '')}`);
    expect(opened.status).toBe(200);
    expect(opened.body.data.booking.id).toBe(bookingId);
  });

  it('never for somebody else’s profile, and not without saying which', async () => {
    const [mine, theirs] = await twoAccounts(fixture.doctorId);

    const stolen = await bookAs(mine, theirs.patientId);
    expect(stolen.status).toBe(400);
    expect(stolen.body.error.details).toMatchObject({ field: 'patientId', reason: 'not_yours' });

    const unnamed = await request(app)
      .post(`${BASE}/bookings`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({ sessionId: fixture.sessionId, method: 'at_hospital' });
    expect(unnamed.status).toBe(400);

    const none = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM bookings
       WHERE session_id = ${fixture.sessionId} AND booked_by_user_id = ${mine.userId}
    `.execute(db);
    expect(none.rows[0]?.n).toBe('0');
  });

  it('the same request again is answered with the same booking', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const key = randomUUID();
    const first = await bookAs(mine, mine.patientId, key);
    const again = await bookAs(mine, mine.patientId, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.bookingId).toBe(first.body.data.bookingId);
    expect(again.body.data.serial).toBe(first.body.data.serial);
  });
});

describe('My serials comes from the server (S-A-09, FR-PAT-39)', () => {
  it('lists the account’s own serials with where each stands, and nobody else’s', async () => {
    const [mine, theirs] = await twoAccounts(fixture.doctorId);
    const booked = await bookAs(mine);
    const bookingId = booked.body.data.bookingId as string;

    const list = await listOf(mine);
    const entry = list.bookings.find((item) => item.bookingId === bookingId);
    expect(entry).toMatchObject({
      serial: booked.body.data.serial,
      standing: 'current',
      patientId: mine.patientId,
      sessionId: fixture.sessionId,
      hospitalId: fixture.hospitalId,
    });
    // When it was read, for the freshness line (`FR-PAT-35`).
    expect(Number.isNaN(Date.parse(list.serverTs))).toBe(false);

    // Every serial in it is for one of this account's own profiles.
    const owned = await sql<{ id: string }>`
      SELECT id FROM patients WHERE owner_user_id = ${mine.userId}
    `.execute(db);
    const profiles = new Set(owned.rows.map((row) => row.id));
    expect(list.bookings.every((item) => profiles.has(item.patientId))).toBe(true);
    // Newest first.
    const starts = list.bookings.map((item) => item.plannedStart);
    expect([...starts].sort().reverse()).toEqual(starts);

    // And the other account is not shown it.
    const others = await listOf(theirs);
    expect(others.bookings.map((item) => item.bookingId)).not.toContain(bookingId);
  });

  it('a serial that was cancelled, or whose chamber has ended, is past', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const booked = await bookAs(mine);
    const bookingId = booked.body.data.bookingId as string;

    const cancelled = await request(app)
      .post(`${BASE}/bookings/${bookingId}/cancel`)
      .set('Authorization', bearer(mine.token))
      .set('Idempotency-Key', randomUUID())
      .send({});
    expect(cancelled.status).toBe(200);

    const list = await listOf(mine);
    expect(list.bookings.find((item) => item.bookingId === bookingId)?.standing).toBe('past');
  });

  it('is the account’s alone: not staff’s, not a tracking link’s, not nobody’s', async () => {
    expect((await request(app).get(`${BASE}/me/bookings`)).status).toBe(401);
    for (const token of [
      await staffToken(['receptionist', 'hospital_admin'], fixture.hospitalId),
      await nationalToken(),
      await guestToken(),
    ]) {
      const response = await request(app)
        .get(`${BASE}/me/bookings`)
        .set('Authorization', bearer(token));
      expect(response.status).toBe(403);
    }
  });
});

describe('a link to one of the account’s own live screens (FR-GST-05)', () => {
  it('is given for its own booking, and opens that booking', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const bookingId = (await bookAs(mine)).body.data.bookingId as string;

    const response = await askLink(mine.token, bookingId);
    expect(response.status).toBe(201);
    const opened = await request(app).get(
      `${BASE}/guest/link/${tokenOf(response.body.data.url as string)}`,
    );
    expect(opened.status).toBe(200);
    expect(opened.body.data.booking.id).toBe(bookingId);
  });

  it('needs a key, like every write', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const bookingId = (await bookAs(mine)).body.data.bookingId as string;
    const response = await request(app)
      .post(`${BASE}/me/bookings/${bookingId}/link`)
      .set('Authorization', bearer(mine.token));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('is not given for another person’s booking, which is not there for this account', async () => {
    const [mine, theirs] = await twoAccounts(fixture.doctorId);
    const theirBooking = (await bookAs(theirs)).body.data.bookingId as string;
    // A booking in the chamber that belongs to no account at all.
    const [counterBooking] = fixture.bookingIds;

    for (const id of [theirBooking, counterBooking ?? '', randomUUID()]) {
      const response = await askLink(mine.token, id);
      expect(response.status, id).toBe(404);
    }
    const links = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM guest_links WHERE booking_id = ${theirBooking}
    `.execute(db);
    // The one their own booking was given, and none made by asking here.
    expect(links.rows[0]?.n).toBe('1');
  });

  it('is nobody’s but an account’s to ask for', async () => {
    const [mine] = await twoAccounts(fixture.doctorId);
    const bookingId = (await bookAs(mine)).body.data.bookingId as string;
    expect((await askLink(null, bookingId)).status).toBe(401);
    for (const token of [
      await staffToken(['receptionist', 'hospital_admin'], fixture.hospitalId),
      await nationalToken(),
      await guestToken(),
    ]) {
      expect((await askLink(token, bookingId)).status).toBe(403);
    }
  });

  it('a chamber that closed days ago has no live screen to open', async () => {
    // From the seeded history: a serial of an account's own profile, in a
    // chamber that ended more than two days ago.
    const old = await sql<{ booking_id: string; user_id: string }>`
      SELECT b.id AS booking_id, p.owner_user_id AS user_id
        FROM bookings b
        JOIN patients p ON p.id = b.patient_id
        JOIN sessions s ON s.id = b.session_id
       WHERE p.owner_user_id IS NOT NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
         AND s.planned_end < now() - interval '2 days'
       ORDER BY s.planned_end DESC, b.id
       LIMIT 1
    `.execute(db);
    const row = old.rows[0];
    if (row === undefined) throw new Error('The seeded history should hold an account’s serial.');

    const response = await askLink(await patientToken(row.user_id), row.booking_id);
    expect(response.status).toBe(410);
    expect(response.body.error.code).toBe('GUEST_LINK_EXPIRED');
  });
});
