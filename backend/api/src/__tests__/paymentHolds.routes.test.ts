/**
 * A serial held while it is paid for (plan H3; `PRD.md` `FR-PAY-08`–`12`;
 * BACKEND.md §7.7, §8).
 *
 * Against a stand-in provider this file controls: it begins an attempt the way
 * bKash and Nagad do (an id and an address to send the patient to) and says
 * whatever the test tells it when asked. What is proven:
 *
 *   - a booking paid online is **held**, with a deadline and `booking.held`;
 *   - **only the provider makes a payment paid**: a return that says success
 *     while the provider says otherwise changes nothing (`FR-PAY-09`), and an
 *     amount the provider took that is not ours is not accepted;
 *   - a second attempt keeps the first's deadline; one after it is refused;
 *   - choosing the counter stands the online attempt down;
 *   - when the hold runs out the serial is turned to the counter, or released
 *     through the queue where it had to be paid first (question 15);
 *   - money that arrives late, or twice, is recorded and owed back (`FR-PAY-10`);
 *   - every step is in the payment's history, readable by its hospital's
 *     administrator only (`FR-PAY-11`);
 *   - a refund the provider cannot make is recorded by hand, with its
 *     reference (`FR-PAY-12`).
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  resetPaymentProvider,
  setPaymentProvider,
  type ChargeRequest,
  type ChargeResult,
  type ConfirmRequest,
  type ConfirmResult,
  type PaymentProvider,
  type RefundResult,
} from '../adapters/payments/index.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';
import { askAgainAfterExpiry, expireHolds } from '../services/payment.service.js';

import { createQueueFixture, otherHospitalId, type QueueFixture } from './support/queueFixture.js';
import { bearer, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

/** A provider that begins attempts and says what it is told to. */
class StandIn implements PaymentProvider {
  readonly name = 'stand-in';
  refundsByApi = true;
  readonly asked: ConfirmRequest[] = [];
  private readonly answers = new Map<string, ConfirmResult>();

  async charge(request: ChargeRequest): Promise<ChargeResult> {
    return await Promise.resolve({
      ok: true,
      checkoutId: `co_${request.paymentId}`,
      providerRef: null,
      settled: false,
      redirectUrl: `https://pay.example.test/${request.paymentId}`,
    });
  }

  async confirm(request: ConfirmRequest): Promise<ConfirmResult> {
    this.asked.push(request);
    return await Promise.resolve(this.answers.get(request.checkoutId) ?? { status: 'pending' });
  }

  async refund(): Promise<RefundResult> {
    return await Promise.resolve({ ok: true, providerRef: `refund_${randomUUID()}` });
  }

  verifyWebhook(): boolean {
    return false;
  }

  /** What the provider will say about one of our payments. */
  says(paymentId: string, answer: ConfirmResult): void {
    this.answers.set(`co_${paymentId}`, answer);
  }
}

let app: Express;
let fixture: QueueFixture;
let provider: StandIn;
let guestId: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(3);
  provider = new StandIn();
  setPaymentProvider(provider);
  const seeded = await sql<{ id: string }>`
    SELECT id FROM guest_identities WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `.execute(db);
  guestId = seeded.rows[0]?.id ?? '';
});

afterEach(() => {
  resetPaymentProvider();
});

async function linkFor(bookingId: string): Promise<string> {
  return await signToken({ kind: 'access', claims: { sub: guestId, kind: 'guest', bookingId } });
}

function booking(index = 0): string {
  const id = fixture.bookingIds[index];
  if (id === undefined) throw new Error('the fixture made too few bookings');
  return id;
}

async function pay(
  bookingId: string,
  method: 'bkash' | 'nagad' | 'at_hospital' = 'bkash',
): Promise<request.Response> {
  const key = randomUUID();
  return await request(app)
    .post(`${BASE}/payments/intent`)
    .set('Authorization', bearer(await linkFor(bookingId)))
    .set('Idempotency-Key', key)
    .send({ bookingId, method, idempotencyKey: key });
}

async function confirm(
  bookingId: string,
  paymentId: string,
  hint: string | null = 'success',
): Promise<request.Response> {
  return await request(app)
    .post(`${BASE}/bookings/${bookingId}/payments/${paymentId}/confirm`)
    .set('Authorization', bearer(await linkFor(bookingId)))
    .send({ hint });
}

async function row(paymentId: string): Promise<{
  state: string;
  failure_reason: string | null;
  refund_reason: string | null;
  provider_ref: string | null;
}> {
  const result = await sql<{
    state: string;
    failure_reason: string | null;
    refund_reason: string | null;
    provider_ref: string | null;
  }>`
    SELECT state::text AS state, failure_reason, refund_reason, provider_ref
      FROM payments WHERE id = ${paymentId}::uuid
  `.execute(db);
  const found = result.rows[0];
  if (found === undefined) throw new Error('no such payment');
  return found;
}

async function kinds(paymentId: string): Promise<string[]> {
  const result = await sql<{ kind: string }>`
    SELECT kind FROM payment_events WHERE payment_id = ${paymentId}::uuid ORDER BY at, id
  `.execute(db);
  return result.rows.map((entry) => entry.kind);
}

async function messages(bookingId: string): Promise<string[]> {
  const result = await sql<{ template_key: string }>`
    SELECT DISTINCT template_key FROM notifications WHERE params ->> 'bookingId' = ${bookingId}
  `.execute(db);
  return result.rows.map((entry) => entry.template_key);
}

/** Moves a payment's deadline into the past, as the clock would. */
async function runOut(paymentId: string): Promise<void> {
  await sql`
    UPDATE payments SET hold_until = now() - interval '1 minute' WHERE id = ${paymentId}::uuid
  `.execute(db);
}

describe('an online payment holds the serial (FR-PAY-08)', () => {
  it('answers where to pay and until when, and keeps the provider’s id', async () => {
    const started = await pay(booking());
    expect(started.status).toBe(201);
    const payment = started.body.data.payment;

    expect(payment.state).toBe('pending');
    expect(started.body.data.redirectUrl).toBe(`https://pay.example.test/${payment.id}`);
    const minutes = (Date.parse(payment.holdUntil) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    expect(await kinds(payment.id)).toEqual(['created', 'redirected']);
  });

  it('is sent booking.held, not the confirmation, when booked to pay online', async () => {
    const key = randomUUID();
    const made = await request(app)
      .post(`${BASE}/bookings`)
      .set('Idempotency-Key', key)
      .send({
        sessionId: fixture.sessionId,
        method: 'bkash',
        guest: {
          name: 'সালমা বেগম (ডেমো)',
          phone: `+88019${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
          ageYears: 41,
          sex: 'female',
        },
      });
    expect(made.status).toBe(201);
    expect(made.body.data.payment.state).toBe('pending');
    expect(made.body.data.payment.redirectUrl).not.toBeNull();

    const sent = await messages(made.body.data.bookingId);
    expect(sent).toContain('booking.held');
    expect(sent).not.toContain('booking.confirmed');
  });

  it('keeps the first attempt’s deadline for a second, and refuses one after it', async () => {
    const first = (await pay(booking())).body.data.payment;
    provider.says(first.id, { status: 'failed', reason: 'cancelled' });
    await confirm(booking(), first.id, 'cancel');

    const second = (await pay(booking())).body.data.payment;
    expect(second.holdUntil).toBe(first.holdUntil);

    await runOut(first.id);
    await runOut(second.id);
    const late = await pay(booking());
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('PAYMENT_HOLD_ENDED');
  });

  it('refuses the counter for a booking that must be paid first', async () => {
    await sql`UPDATE bookings SET prepayment_required = true WHERE id = ${booking()}::uuid`.execute(
      db,
    );
    const refused = await pay(booking(), 'at_hospital');
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('PREPAYMENT_REQUIRED');
  });
});

describe('only the provider says a payment was made (FR-PAY-09)', () => {
  it('does not believe a return that says success while the provider says pending', async () => {
    const payment = (await pay(booking())).body.data.payment;

    const answer = await confirm(booking(), payment.id, 'success');
    expect(answer.status).toBe(200);
    expect(answer.body.data.payment.state).toBe('pending');
    expect(answer.body.data.serial).toBe('held');
    expect((await row(payment.id)).state).toBe('pending');
  });

  it('records the payment when the provider says it was paid, and confirms the serial', async () => {
    const payment = (await pay(booking())).body.data.payment;
    provider.says(payment.id, {
      status: 'paid',
      providerRef: 'TRX-STANDIN-1',
      amountPoisha: payment.amountPoisha,
    });

    const answer = await confirm(booking(), payment.id);
    expect(answer.body.data.payment.state).toBe('paid');
    expect(answer.body.data.serial).toBe('confirmed');
    expect((await row(payment.id)).provider_ref).toBe('TRX-STANDIN-1');
    expect(await kinds(payment.id)).toEqual(['created', 'redirected', 'paid']);
    expect(await messages(booking())).toContain('booking.confirmed');

    // Asked again, a settled payment is answered from the row.
    const asked = provider.asked.length;
    await confirm(booking(), payment.id);
    expect(provider.asked.length).toBe(asked);
  });

  it('does not accept an amount the provider took that is not the fee', async () => {
    const payment = (await pay(booking())).body.data.payment;
    provider.says(payment.id, {
      status: 'paid',
      providerRef: 'TRX-WRONG',
      amountPoisha: payment.amountPoisha - 100,
    });

    await confirm(booking(), payment.id);
    const stored = await row(payment.id);
    expect(stored.state).toBe('failed');
    expect(stored.failure_reason).toBe('amount_mismatch');
    expect(await kinds(payment.id)).toContain('amount_mismatch');
  });

  it('records a cancellation the provider reports', async () => {
    const payment = (await pay(booking())).body.data.payment;
    provider.says(payment.id, { status: 'failed', reason: 'cancelled' });

    const answer = await confirm(booking(), payment.id, 'cancel');
    expect(answer.body.data.payment.state).toBe('failed');
    expect(answer.body.data.payment.failureReason).toBe('cancelled');
    expect(answer.body.data.serial).toBe('held');
  });

  it('is the booking owner’s to ask, and only about that booking’s payment', async () => {
    const payment = (await pay(booking())).body.data.payment;

    // Another booking's link.
    const other = await request(app)
      .post(`${BASE}/bookings/${booking()}/payments/${payment.id}/confirm`)
      .set('Authorization', bearer(await linkFor(booking(1))))
      .send({});
    expect([403, 404]).toContain(other.status);

    // The right link, the wrong booking in the path for this payment.
    const mismatched = await request(app)
      .post(`${BASE}/bookings/${booking(1)}/payments/${payment.id}/confirm`)
      .set('Authorization', bearer(await linkFor(booking(1))))
      .send({});
    expect(mismatched.status).toBe(404);

    const nobody = await request(app)
      .post(`${BASE}/bookings/${booking()}/payments/${payment.id}/confirm`)
      .send({});
    expect(nobody.status).toBe(401);
  });
});

describe('choosing the counter (FR-PAY-08)', () => {
  it('stands the online attempt down and turns the serial to the counter', async () => {
    const online = (await pay(booking())).body.data.payment;
    const counter = await pay(booking(), 'at_hospital');
    expect(counter.status).toBe(201);

    const stored = await row(online.id);
    expect(stored.state).toBe('failed');
    expect(stored.failure_reason).toBe('superseded');
  });
});

describe('when the hold runs out (FR-PAY-08, question 15)', () => {
  it('turns the serial to the counter where the hospital takes payment there', async () => {
    const payment = (await pay(booking())).body.data.payment;
    await runOut(payment.id);

    await expireHolds();

    const stored = await row(payment.id);
    expect(stored.state).toBe('failed');
    expect(stored.failure_reason).toBe('expired');
    expect(await kinds(payment.id)).toEqual([
      'created',
      'redirected',
      'asked',
      'expired',
      'counter',
    ]);

    const counter = await sql<{ n: string }>`
      SELECT count(*)::text AS n FROM payments
       WHERE booking_id = ${booking()}::uuid AND method = 'at_hospital' AND state = 'pending'
    `.execute(db);
    expect(counter.rows[0]?.n).toBe('1');
    expect(await messages(booking())).toContain('payment.counter');

    // Dealt with once: a second tick changes nothing.
    await expireHolds();
    expect(await kinds(payment.id)).toHaveLength(5);
  });

  it('releases the serial through the queue where it had to be paid first', async () => {
    await sql`UPDATE bookings SET prepayment_required = true WHERE id = ${booking()}::uuid`.execute(
      db,
    );
    const payment = (await pay(booking())).body.data.payment;
    await runOut(payment.id);

    await expireHolds();

    const status = await sql<{ status: string }>`
      SELECT status::text AS status FROM bookings WHERE id = ${booking()}::uuid
    `.execute(db);
    expect(status.rows[0]?.status).toBe('cancelled');
    expect(await kinds(payment.id)).toContain('released');
    const sent = await messages(booking());
    expect(sent).toContain('payment.released');
    expect(sent).not.toContain('queue.cancelled');
  });

  it('records money that arrives after the serial was released, and owes it back (FR-PAY-10)', async () => {
    await sql`UPDATE bookings SET prepayment_required = true WHERE id = ${booking()}::uuid`.execute(
      db,
    );
    const payment = (await pay(booking())).body.data.payment;
    await runOut(payment.id);
    await expireHolds();

    provider.says(payment.id, {
      status: 'paid',
      providerRef: 'TRX-LATE',
      amountPoisha: payment.amountPoisha,
    });
    await sql`UPDATE payments SET checked_at = now() - interval '1 hour' WHERE id = ${payment.id}::uuid`.execute(
      db,
    );
    await askAgainAfterExpiry();

    const stored = await row(payment.id);
    expect(stored.state).toBe('paid');
    expect(stored.refund_reason).toBe('paid_after_release');
    expect(await kinds(payment.id)).toContain('owed_back');
  });

  it('owes back a second payment for a serial already paid (FR-PAY-10)', async () => {
    const first = (await pay(booking())).body.data.payment;
    const second = (await pay(booking())).body.data.payment;
    for (const [id, ref] of [
      [first.id, 'TRX-ONE'],
      [second.id, 'TRX-TWO'],
    ] as const) {
      provider.says(id, { status: 'paid', providerRef: ref, amountPoisha: first.amountPoisha });
    }

    await confirm(booking(), first.id);
    await confirm(booking(), second.id);

    expect((await row(first.id)).refund_reason).toBeNull();
    const owed = await row(second.id);
    expect(owed.state).toBe('paid');
    expect(owed.refund_reason).toBe('duplicate_payment');
  });
});

describe('a payment’s history (FR-PAY-11)', () => {
  it('is read by its hospital’s administrator, and by nobody else', async () => {
    const payment = (await pay(booking())).body.data.payment;

    const mine = await request(app)
      .get(`${BASE}/payments/${payment.id}/history`)
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)));
    expect(mine.status).toBe(200);
    const events = (mine.body as { data: { events: { kind: string }[] } }).data.events;
    expect(events.map((event) => event.kind)).toEqual(['created', 'redirected']);
    // Nothing in a step names the wallet or the provider's reference.
    expect(JSON.stringify(mine.body)).not.toContain(`co_${payment.id}`);

    const elsewhere = await request(app)
      .get(`${BASE}/payments/${payment.id}/history`)
      .set(
        'Authorization',
        bearer(await staffToken(['hospital_admin'], await otherHospitalId(fixture.hospitalId))),
      );
    expect(elsewhere.status).toBe(404);

    const reception = await request(app)
      .get(`${BASE}/payments/${payment.id}/history`)
      .set('Authorization', bearer(await staffToken(['receptionist'], fixture.hospitalId)));
    expect(reception.status).toBe(403);

    const patient = await request(app)
      .get(`${BASE}/payments/${payment.id}/history`)
      .set('Authorization', bearer(await patientToken()));
    expect(patient.status).toBe(403);
  });
});

describe('a refund the provider cannot make (FR-PAY-12)', () => {
  it('needs the reference it was made under, and calls no provider', async () => {
    provider.refundsByApi = false;
    const payment = (await pay(booking())).body.data.payment;
    provider.says(payment.id, {
      status: 'paid',
      providerRef: 'TRX-R',
      amountPoisha: payment.amountPoisha,
    });
    await confirm(booking(), payment.id);

    const admin = bearer(await staffToken(['hospital_admin'], fixture.hospitalId));
    const bare = randomUUID();
    const refused = await request(app)
      .post(`${BASE}/payments/${payment.id}/refund`)
      .set('Authorization', admin)
      .set('Idempotency-Key', bare)
      .send({ reason: 'doctor_absent', idempotencyKey: bare });
    expect(refused.status).toBe(422);
    expect(refused.body.error.code).toBe('REFUND_NOTE_REQUIRED');

    const noted = randomUUID();
    const recorded = await request(app)
      .post(`${BASE}/payments/${payment.id}/refund`)
      .set('Authorization', admin)
      .set('Idempotency-Key', noted)
      .send({ reason: 'doctor_absent', note: 'Merchant panel ref DEMO-42', idempotencyKey: noted });
    expect(recorded.status).toBe(200);
    expect(recorded.body.data.byHand).toBe(true);
    expect((await row(payment.id)).state).toBe('refunded');
    expect(await kinds(payment.id)).toContain('refunded');
  });
});
