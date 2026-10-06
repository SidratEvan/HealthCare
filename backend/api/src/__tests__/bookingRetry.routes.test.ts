/**
 * A booking survives its own answer being lost, and a phone number cannot be
 * used to fill a doctor's list (plan A5; `FR-QUE-51`, `FR-GST-14`,
 * `FR-GST-05`, `FR-PAY-06`, `FR-DEM-07`; handover findings 19, 26 and 28).
 *
 * `POST /bookings` required an Idempotency-Key and dropped it. The retry of a
 * confirm that had in fact gone through was refused as a duplicate booking,
 * and the patient, who had a serial, had no way to reach it: the tracking link
 * is returned once and only its hash is stored.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { env } from '../env.js';
import { asAppError } from '../errors/AppError.js';
import { resetEmitter, type RecordingEmitter } from '../realtime/emit.js';
import { ROOMS } from '../realtime/rooms.js';
import { MAX_LIVE_LINKS_PER_BOOKING } from '../repositories/guest.repo.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let emitted: RecordingEmitter;

const mutable = env as {
  DEMO_MODE: boolean;
  GUEST_BOOKINGS_PER_PHONE_PER_DAY: number;
  GUEST_BOOKING_OTP?: boolean | undefined;
};
const original = {
  DEMO_MODE: mutable.DEMO_MODE,
  GUEST_BOOKINGS_PER_PHONE_PER_DAY: mutable.GUEST_BOOKINGS_PER_PHONE_PER_DAY,
  GUEST_BOOKING_OTP: mutable.GUEST_BOOKING_OTP,
};

function guestPhone(): string {
  return `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

function guest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'রহিমা খাতুন (ডেমো)',
    phone: guestPhone(),
    ageYears: 34,
    sex: 'female',
    ...overrides,
  };
}

async function book(
  key: string,
  body: Record<string, unknown>,
  sessionId = fixture.sessionId,
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/bookings`)
    .set('Idempotency-Key', key)
    .send({ sessionId, method: 'bkash', ...body });
}

async function count(query: ReturnType<typeof sql<{ n: string }>>): Promise<number> {
  return Number((await query.execute(db)).rows[0]?.n ?? '-1');
}

beforeEach(async () => {
  app = createApp();
  emitted = resetEmitter();
  fixture = await createQueueFixture(3);
});

afterEach(() => {
  mutable.DEMO_MODE = original.DEMO_MODE;
  mutable.GUEST_BOOKINGS_PER_PHONE_PER_DAY = original.GUEST_BOOKINGS_PER_PHONE_PER_DAY;
  mutable.GUEST_BOOKING_OTP = original.GUEST_BOOKING_OTP;
});

describe('the same request, sent again (FR-QUE-51)', () => {
  it('is answered with the booking it already made, and a link that opens it', async () => {
    const key = randomUUID();
    const who = guest();

    const first = await book(key, { guest: who });
    expect(first.status).toBe(201);
    expect(first.body.data.duplicate).toBe(false);

    // The answer never arrived. The phone sends the same confirm again.
    const again = await book(key, { guest: who });
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({
      bookingId: first.body.data.bookingId,
      serial: first.body.data.serial,
      duplicate: true,
      paid: true,
    });

    // The patient who never got the first answer needs a link that works.
    // Only a hash is stored, so it is a new one, for the same booking.
    const link = new URL(again.body.data.trackingUrl as string);
    expect(link.searchParams.get('b')).toBe(first.body.data.bookingId);
    const opened = await request(app).get(
      `${BASE}/guest/link/${encodeURIComponent(link.searchParams.get('t') ?? '')}`,
    );
    expect(opened.status).toBe(200);
    expect(opened.body.data.booking.id).toBe(first.body.data.bookingId);
    // And the link the first answer carried still opens too.
    const original$ = new URL(first.body.data.trackingUrl as string);
    expect(
      (
        await request(app).get(
          `${BASE}/guest/link/${encodeURIComponent(original$.searchParams.get('t') ?? '')}`,
        )
      ).status,
    ).toBe(200);
  });

  it('makes nothing a second time: one serial, one message, one charge, one broadcast', async () => {
    const key = randomUUID();
    const who = guest();
    const first = await book(key, { guest: who });
    const bookingId = first.body.data.bookingId as string;

    const told = (): number =>
      emitted
        .forRoom(ROOMS.session(fixture.sessionId))
        .filter((entry) => entry.event === 'queue.updated').length;
    const toldOnce = told();
    const messages = await count(
      sql<{
        n: string;
      }>`SELECT count(*)::text AS n FROM notifications WHERE params->>'bookingId' = ${bookingId}`,
    );

    await book(key, { guest: who });
    await book(key, { guest: who });

    expect(
      await count(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM bookings WHERE session_id = ${fixture.sessionId}`,
      ),
    ).toBe(4);
    expect(
      await count(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM payments WHERE booking_id = ${bookingId}`,
      ),
    ).toBe(1);
    expect(
      await count(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM notifications WHERE params->>'bookingId' = ${bookingId}`,
      ),
    ).toBe(messages);
    expect(told()).toBe(toldOnce);
  });

  it('two attempts at the same moment make one booking', async () => {
    const key = randomUUID();
    const who = guest();

    const [a, b] = await Promise.all([book(key, { guest: who }), book(key, { guest: who })]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.bookingId).toBe(b.body.data.bookingId);
    expect(a.body.data.serial).toBe(b.body.data.serial);
  });

  it('a retry sent again and again leaves only a few links live, the newest among them', async () => {
    const key = randomUUID();
    const who = guest();
    const first = await book(key, { guest: who });
    const bookingId = first.body.data.bookingId as string;

    let last = first;
    for (let attempt = 0; attempt < 6; attempt += 1) last = await book(key, { guest: who });

    expect(
      await count(
        sql<{ n: string }>`
          SELECT count(*)::text AS n FROM guest_links
           WHERE booking_id = ${bookingId} AND revoked_at IS NULL
        `,
      ),
    ).toBe(MAX_LIVE_LINKS_PER_BOOKING);

    const tokenOf = (response: request.Response): string =>
      new URL(response.body.data.trackingUrl as string).searchParams.get('t') ?? '';
    const open = async (token: string): Promise<number> =>
      (await request(app).get(`${BASE}/guest/link/${encodeURIComponent(token)}`)).status;

    expect(await open(tokenOf(last))).toBe(200);
    // The first, pushed out by the ones after it, no longer opens.
    expect(await open(tokenOf(first))).toBe(410);
  });

  it('refuses the key for a different request', async () => {
    const key = randomUUID();
    const first = await book(key, { guest: guest() });
    expect(first.status).toBe(201);

    // Somebody else, under the key that already made a booking.
    const other = await book(key, { guest: guest() });
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(
      await count(
        sql<{
          n: string;
        }>`SELECT count(*)::text AS n FROM bookings WHERE session_id = ${fixture.sessionId}`,
      ),
    ).toBe(4);
  });

  it('a new attempt by the same patient is still the duplicate it always was (FR-PAT-24)', async () => {
    const who = guest();
    expect((await book(randomUUID(), { guest: who })).status).toBe(201);

    // A different key: not a retry, a second booking with the same doctor.
    const second = await book(randomUUID(), { guest: who });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BOOKING_DUPLICATE');
  });
});

describe('a phone number with no account behind it (FR-GST-14)', () => {
  it('may make only so many bookings in a day, and cancelling does not give one back', async () => {
    mutable.GUEST_BOOKINGS_PER_PHONE_PER_DAY = 2;
    const phone = guestPhone();

    // Three people in one household, three chambers, one phone.
    const chambers = [fixture, await createQueueFixture(1), await createQueueFixture(1)];
    const first = await book(randomUUID(), { guest: guest({ phone }) }, chambers[0]?.sessionId);
    const second = await book(
      randomUUID(),
      { guest: guest({ phone, name: 'করিম উদ্দিন (ডেমো)' }) },
      chambers[1]?.sessionId,
    );
    expect([first.status, second.status]).toEqual([201, 201]);

    const third = await book(
      randomUUID(),
      { guest: guest({ phone, name: 'সালমা বেগম (ডেমো)' }) },
      chambers[2]?.sessionId,
    );
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('BOOKING_LIMIT_REACHED');
    expect(third.body.error.details).toMatchObject({ limit: 2, windowHours: 24 });

    // Another number is not affected.
    expect((await book(randomUUID(), { guest: guest() }, chambers[2]?.sessionId)).status).toBe(201);
  });

  it('does not count against a retry of a booking already made', async () => {
    mutable.GUEST_BOOKINGS_PER_PHONE_PER_DAY = 1;
    const key = randomUUID();
    const who = guest();

    expect((await book(key, { guest: who })).status).toBe(201);
    // At the limit, and the same request is still answered.
    expect((await book(key, { guest: who })).status).toBe(200);
  });
});

describe('demonstration data is stamped only where the server is a demonstration (FR-DEM-07)', () => {
  async function stampOf(bookingId: string): Promise<unknown> {
    const result = await sql<{ demo: unknown }>`
      SELECT intake->'demo' AS demo FROM bookings WHERE id = ${bookingId}
    `.execute(db);
    return result.rows[0]?.demo ?? null;
  }

  it('stamps a booking on a demonstration', async () => {
    mutable.DEMO_MODE = true;
    const made = await book(randomUUID(), { guest: guest() });
    expect(await stampOf(made.body.data.bookingId as string)).toBe(true);
  });

  it('does not stamp a real hospital’s booking', async () => {
    mutable.DEMO_MODE = false;
    // What is under test is the stamp, not the code a real server asks a
    // guest for first (`FR-GST-03`, which has its own tests).
    mutable.GUEST_BOOKING_OTP = false;
    const made = await book(randomUUID(), { guest: guest(), method: 'at_hospital' });
    expect(made.status).toBe(201);
    expect(await stampOf(made.body.data.bookingId as string)).toBeNull();
  });
});

describe('a race the database settles is a conflict, not a server fault', () => {
  it('answers a unique violation with 409', () => {
    // What `pg` throws when a unique index refuses a row.
    const thrown = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
    });
    const error = asAppError(thrown);
    expect(error.code).toBe('WRITE_CONFLICT');
    expect(error.status).toBe(409);
  });

  it('still calls anything else a server fault', () => {
    expect(asAppError(new Error('boom')).code).toBe('INTERNAL');
    expect(asAppError(Object.assign(new Error('x'), { code: '23503' })).code).toBe('INTERNAL');
  });
});
