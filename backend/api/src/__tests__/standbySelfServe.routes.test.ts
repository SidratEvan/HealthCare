/**
 * The patient's half of the standby list (`FR-PAT-25`, `FR-PAT-26`,
 * `FR-PAT-27`, `FR-QUE-30`).
 *
 * The owner's ruling on STATUS decision 62, 2026-09-23: "prepaid gets it
 * automatically". A patient joins a full chamber's list from the app; if they
 * paid when joining, the next chair reception frees is theirs without anybody
 * asking; if not, the offer reaches their phone and they answer it. These
 * tests hold the money to the seat — a prepayment follows the person onto the
 * booking they are given, and comes back in full if they never are.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let reception: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(4);
  reception = await signToken({
    kind: 'access',
    claims: {
      sub: fixture.receptionistId,
      kind: 'staff',
      hospitalId: fixture.hospitalId,
      roles: ['receptionist'],
    },
  });
});

/** Fills the chamber: capacity equal to the serials it already holds. */
async function fillChamber(): Promise<void> {
  await sql`UPDATE sessions SET capacity = 4 WHERE id = ${fixture.sessionId}`.execute(db);
}

function phone(): string {
  return `+88017${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`;
}

async function join(
  prepay: 'bkash' | 'nagad' | 'card' | null = null,
  key: string = randomUUID(),
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/sessions/${fixture.sessionId}/standby`)
    .set('Idempotency-Key', key)
    .send({
      guest: { name: 'সালমা বেগম', phone: phone(), ageYears: 41, sex: 'female' },
      prepay,
      clientEventId: key,
    });
}

async function staffPost(
  path: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}${path}`)
    .set('Authorization', bearer(reception))
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

/** Opens the chamber and cancels serial 2, so there is a chair to give. */
async function freeAChair(): Promise<string> {
  const freed = fixture.bookingIds[1] ?? '';
  await staffPost(`/sessions/${fixture.sessionId}/arrived`);
  await staffPost(`/bookings/${freed}/cancel`, { reason: 'patient cancelled' });
  return freed;
}

async function status(token: string): Promise<request.Response> {
  return await request(app).get(`${BASE}/standby/${token}`);
}

async function answer(
  token: string,
  verb: 'accept' | 'decline' | 'leave',
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/standby/${token}/${verb}`)
    .set('Idempotency-Key', randomUUID())
    .send(body);
}

async function notificationKeys(): Promise<string[]> {
  const result = await sql<{ template_key: string }>`
    SELECT n.template_key FROM notifications n
     WHERE n.params ->> 'doctor' IS NOT NULL
       AND n.created_at > now() - interval '1 minute'
  `.execute(db);
  return result.rows.map((row) => row.template_key);
}

describe('joining the list (FR-PAT-25)', () => {
  it('is only for a full chamber — one with a free serial is booked instead', async () => {
    const response = await join();

    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('SESSION_NOT_FULL');
  });

  it('puts the patient at the back and hands them a status link', async () => {
    await fillChamber();

    const response = await join();

    expect(response.status).toBe(201);
    expect(response.body.data.position).toBe(1);
    expect(response.body.data.prepaid).toBe(false);
    expect(response.body.data.statusUrl).toContain('/standby?t=');

    const read = await status(response.body.data.token);
    expect(read.status).toBe(200);
    expect(read.body.data.state).toBe('waiting');
    expect(read.body.data.ahead).toBe(0);
  });

  it('is one place, not two, when the same tap is replayed (FR-QUE-51)', async () => {
    await fillChamber();
    const key = randomUUID();

    const first = await join(null, key);
    const second = await join(null, key);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.standbyId).toBe(first.body.data.standbyId);
  });

  it('takes a prepayment against the place, before there is a booking (FR-PAT-26)', async () => {
    await fillChamber();

    const response = await join('bkash');
    expect(response.body.data.prepaid).toBe(true);

    const payments = await sql<{ state: string; amount_poisha: number; booking_id: string | null }>`
      SELECT state::text, amount_poisha, booking_id FROM payments
       WHERE standby_id = ${response.body.data.standbyId as string}
    `.execute(db);
    expect(payments.rows).toHaveLength(1);
    expect(payments.rows[0]?.state).toBe('paid');
    expect(payments.rows[0]?.amount_poisha).toBe(fixture.feePoisha);
    expect(payments.rows[0]?.booking_id).toBeNull();
  });
});

describe('the status link is one place and nothing else', () => {
  it('refuses a token of another audience', async () => {
    const tracking = await signToken({
      kind: 'bed_request',
      claims: { sub: randomUUID(), kind: 'guest', bedRequestId: randomUUID() },
    });

    expect((await status(tracking)).status).toBe(401);
  });
});

describe('prepaid gets the chair automatically (FR-PAT-26)', () => {
  it('seats them on the offer, moves the payment onto the booking, and says so', async () => {
    await fillChamber();
    const joined = await join('nagad');
    const freed = await freeAChair();

    const offered = await staffPost(`/bookings/${freed}/offer-slot`);
    expect(offered.status).toBe(200);

    const read = await status(joined.body.data.token);
    expect(read.body.data.state).toBe('seated');
    // The cancelled serial was still ahead of the chamber, so it is reissued.
    expect(read.body.data.seated.serial).toBe(2);
    // Minted the first time it is asked — and never again, which would kill
    // the link already in their SMS.
    expect(read.body.data.seated.trackingUrl).toContain('/s?b=');
    expect((await status(joined.body.data.token)).body.data.seated.trackingUrl).toBeNull();

    const bookingId = read.body.data.seated.bookingId as string;
    const moved = await sql<{ booking_id: string | null; standby_id: string | null }>`
      SELECT booking_id, standby_id FROM payments WHERE booking_id = ${bookingId}
    `.execute(db);
    expect(moved.rows).toHaveLength(1);
    expect(moved.rows[0]?.standby_id).toBeNull();

    // Counted as an offer made and taken, so the recovery figure sees it.
    const offers = await sql<{ accepted_at: Date | null }>`
      SELECT accepted_at FROM slot_offers WHERE session_id = ${fixture.sessionId}
    `.execute(db);
    expect(offers.rows[0]?.accepted_at).not.toBeNull();

    expect(await notificationKeys()).toContain('queue.slot_seated');
  });
});

describe('everybody else answers on their phone (FR-PAT-27)', () => {
  it('shows the offer, and yes makes a paid booking with a live link', async () => {
    await fillChamber();
    const joined = await join();
    const freed = await freeAChair();
    await staffPost(`/bookings/${freed}/offer-slot`);

    const read = await status(joined.body.data.token);
    expect(read.body.data.state).toBe('offered');
    expect(Date.parse(read.body.data.offer.expiresAt)).toBeGreaterThan(Date.now());
    expect(await notificationKeys()).toContain('queue.slot_offered_link');

    const accepted = await answer(joined.body.data.token, 'accept', {
      method: 'bkash',
      clientEventId: randomUUID(),
    });

    expect(accepted.status).toBe(200);
    expect(accepted.body.data.serial).toBe(2);
    expect(accepted.body.data.paid).toBe(true);
    expect(accepted.body.data.trackingUrl).toContain('/s?b=');
    expect((await status(joined.body.data.token)).body.data.state).toBe('seated');
  });

  it('no passes the chair to the next person on the list', async () => {
    await fillChamber();
    const first = await join();
    const second = await join();
    const freed = await freeAChair();
    await staffPost(`/bookings/${freed}/offer-slot`);

    const declined = await answer(first.body.data.token, 'decline');
    expect(declined.status).toBe(200);

    expect((await status(first.body.data.token)).body.data.state).toBe('waiting');
    expect((await status(second.body.data.token)).body.data.state).toBe('offered');
  });

  it('refuses to accept when there is nothing on offer', async () => {
    await fillChamber();
    const joined = await join();

    const response = await answer(joined.body.data.token, 'accept', { method: 'bkash' });
    expect(response.status).toBe(422);
    expect(response.body.error.details.guard).toBe('NO_OPEN_OFFER');
  });
});

describe('a prepayment for a chair that never came comes back (standby_unseated)', () => {
  it('is owed at once when the patient leaves the list', async () => {
    await fillChamber();
    const joined = await join('card');

    const left = await answer(joined.body.data.token, 'leave');
    expect(left.body.data.refundOwed).toBe(true);
    expect((await status(joined.body.data.token)).body.data.state).toBe('left');

    const owed = await sql<{ refund_reason: string | null }>`
      SELECT refund_reason FROM payments
       WHERE standby_id = ${joined.body.data.standbyId as string}
    `.execute(db);
    expect(owed.rows[0]?.refund_reason).toBe('standby_unseated');
  });

  it('is owed when the session ends with them still waiting', async () => {
    await fillChamber();
    const joined = await join('bkash');

    await staffPost(`/sessions/${fixture.sessionId}/arrived`);
    expect((await staffPost(`/sessions/${fixture.sessionId}/end`, { reason: null })).status).toBe(
      200,
    );

    // Raised after the session's own commit, so give it a moment to land.
    let reason: string | null = null;
    for (let attempt = 0; attempt < 20 && reason === null; attempt += 1) {
      const owed = await sql<{ refund_reason: string | null }>`
        SELECT refund_reason FROM payments
         WHERE standby_id = ${joined.body.data.standbyId as string}
      `.execute(db);
      reason = owed.rows[0]?.refund_reason ?? null;
      if (reason === null) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(reason).toBe('standby_unseated');
  });
});

describe('reception sees who prepaid (FR-REC-30)', () => {
  it('marks a prepaid place on the panel', async () => {
    await fillChamber();
    await join('bkash');
    await join();

    const panel = await request(app)
      .get(`${BASE}/sessions/${fixture.sessionId}/standby`)
      .set('Authorization', bearer(reception))
      .expect(200);

    const waiting = (panel.body as { data: { waiting: { prepaid: boolean }[] } }).data.waiting;
    expect(waiting.map((row) => row.prepaid)).toEqual([true, false]);
  });
});
