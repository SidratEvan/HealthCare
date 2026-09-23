/**
 * The payment endpoints (BACKEND.md §7.7, `FR-PAY-*`).
 *
 * **`CLAUDE.md` §4 names one thing as this step's definition of done: the
 * idempotency test.** It is the first describe below, and it is first because
 * the failure it guards against is a person charged twice for one serial —
 * the only bug in this file that takes money from somebody.
 *
 * What else is proven here and nowhere else:
 *
 *   - **A client never says how much** (`FR-PAY-04`): the amount comes from
 *     the booking's own row, and a body that tries to name one is ignored.
 *   - **Who may do what** (`FR-ROLE-01`): paying is the patient's, refunding
 *     and settling the administrator's, and a guest's link pays for its own
 *     booking and no other.
 *   - **The refund rule is enforced, not chosen** (`FR-PAY-03`): the reason
 *     picks the rule, and a hospital with no policy is told so rather than
 *     given a computed zero.
 *   - **A webhook is authentication by signature** — an unsigned callback
 *     changes nothing, and a replayed one changes nothing twice.
 *   - **Money is never edited** — the database refuses an amount change.
 */

import { randomUUID } from 'node:crypto';

import { sql } from 'kysely';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { mockWebhookSignature } from '../adapters/payments/index.js';
import { createApp } from '../app.js';
import { db } from '../config/db.js';
import { signToken } from '../config/jwt.js';

import { createQueueFixture, type QueueFixture } from './support/queueFixture.js';
import { bearer, guestToken, patientToken, staffToken } from './support/tokens.js';

import type { Express } from 'express';

const BASE = '/api/v1';

let app: Express;
let fixture: QueueFixture;
let guestId: string;

beforeEach(async () => {
  app = createApp();
  fixture = await createQueueFixture(3);
  guestId = await seededGuestId();
});

/**
 * A real `guest_identities` row.
 *
 * `payments.payer_guest_id` is a foreign key, so a payment can only name a
 * guest who exists — which is the property that makes an unattributable
 * payment impossible rather than merely discouraged. The fixture's bookings
 * carry no payer of their own, so one is borrowed from the seeds.
 */
async function seededGuestId(): Promise<string> {
  const result = await sql<{ id: string }>`
    SELECT id FROM guest_identities WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1
  `.execute(db);
  const id = result.rows[0]?.id;
  if (id === undefined) throw new Error('The seed should hold a guest identity (FR-DEM-03).');
  return id;
}

/**
 * The access token a tracking link exchanges itself for, scoped to one
 * booking — what `guest.service.openTrackingLink` hands the screen.
 *
 * `kind: 'access'` with `claims.kind: 'guest'`, not `kind: 'guest'`: the
 * latter is the long-lived link token for `GET /guest/link/:token`, and
 * `requireAuth` does not accept one.
 */
async function linkFor(bookingId: string): Promise<string> {
  return await signToken({
    kind: 'access',
    claims: { sub: guestId, kind: 'guest', bookingId },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The booking a payment is made against, and a token that may pay for it. */
async function payableBooking(): Promise<{ bookingId: string; token: string }> {
  const bookingId = fixture.bookingIds[0];
  if (bookingId === undefined) throw new Error('the fixture made no bookings');
  return { bookingId, token: await linkFor(bookingId) };
}

/** The payment row as the database has it, for what the API does not return. */
async function paymentRow(paymentId: string): Promise<{
  state: string;
  amountPoisha: number;
  refundedPoisha: number;
  providerRef: string | null;
  idempotencyKey: string;
}> {
  const result = await sql<{
    state: string;
    amount_poisha: number;
    refunded_poisha: number;
    provider_ref: string | null;
    idempotency_key: string;
  }>`
    SELECT state::text AS state, amount_poisha, refunded_poisha, provider_ref, idempotency_key
      FROM payments WHERE id = ${paymentId}::uuid
  `.execute(db);

  const row = result.rows[0];
  if (row === undefined) throw new Error(`No payment ${paymentId}.`);
  return {
    state: row.state,
    amountPoisha: row.amount_poisha,
    refundedPoisha: row.refunded_poisha,
    providerRef: row.provider_ref,
    idempotencyKey: row.idempotency_key,
  };
}

/** How many payments exist against one booking. */
async function paymentCount(bookingId: string): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count FROM payments WHERE booking_id = ${bookingId}::uuid
  `.execute(db);
  return Number(result.rows[0]?.count ?? '0');
}

/** Gives a hospital cancellation terms, so a refund has a rule to follow. */
async function setRefundPolicy(hospitalId: string, policy: unknown): Promise<void> {
  await sql`
    UPDATE hospital_settings SET refund_policy = ${JSON.stringify(policy)}::jsonb
     WHERE hospital_id = ${hospitalId}::uuid
  `.execute(db);
}

// ---------------------------------------------------------------------------
// The definition of done (`CLAUDE.md` §4, `FR-PAY-06`)
// ---------------------------------------------------------------------------

describe('a retry never double-charges (FR-PAY-06)', () => {
  it('answers the same payment for the same key, and creates one row', async () => {
    const { bookingId, token } = await payableBooking();
    const before = await paymentCount(bookingId);
    const key = randomUUID();
    const body = { bookingId, method: 'bkash', idempotencyKey: key };

    const first = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send(body);

    expect(first.status).toBe(201);
    const firstId = (first.body as { data: { payment: { id: string } } }).data.payment.id;

    const second = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send(body);

    expect(second.status).toBe(200);
    const replayed = second.body as { data: { payment: { id: string }; duplicate: boolean } };

    expect(replayed.data.duplicate).toBe(true);
    expect(replayed.data.payment.id).toBe(firstId);
    expect(await paymentCount(bookingId)).toBe(before + 1);
  });

  it('holds under a burst of identical requests sent at once', async () => {
    // Not a retry after a timeout but five in flight together, which is what
    // a patient double-tapping on a bad connection actually produces. The
    // advisory lock is what makes the second through fifth wait and then
    // find the first's row rather than each inserting their own.
    const { bookingId, token } = await payableBooking();
    const before = await paymentCount(bookingId);
    const key = randomUUID();
    const body = { bookingId, method: 'bkash', idempotencyKey: key };

    const responses = await Promise.all(
      Array.from(
        { length: 5 },
        async () =>
          await request(app)
            .post(`${BASE}/payments/intent`)
            .set('Authorization', bearer(token))
            .set('Idempotency-Key', key)
            .send(body),
      ),
    );

    for (const response of responses) {
      expect([200, 201]).toContain(response.status);
    }

    const ids = new Set(
      responses.map(
        (response) => (response.body as { data: { payment: { id: string } } }).data.payment.id,
      ),
    );

    expect(ids.size).toBe(1);
    expect(await paymentCount(bookingId)).toBe(before + 1);
  });

  it('makes a separate payment for a different key', async () => {
    // The key is what makes a retry safe; two genuinely different attempts
    // are two payments, and conflating them would be the opposite bug.
    const { bookingId, token } = await payableBooking();
    const before = await paymentCount(bookingId);

    for (const key of [randomUUID(), randomUUID()]) {
      await request(app)
        .post(`${BASE}/payments/intent`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', key)
        .send({ bookingId, method: 'bkash', idempotencyKey: key })
        .expect(201);
    }

    expect(await paymentCount(bookingId)).toBe(before + 2);
  });
});

// ---------------------------------------------------------------------------
// What is charged (`FR-PAY-01`, `FR-PAY-04`)
// ---------------------------------------------------------------------------

describe('the amount is the booking’s, never the caller’s', () => {
  it('charges the booking’s own fee and ignores anything sent', async () => {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();

    const response = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key, amountPoisha: 1 });

    const payment = (response.body as { data: { payment: { id: string; amountPoisha: number } } })
      .data.payment;

    expect(payment.amountPoisha).toBe(fixture.feePoisha);
    expect((await paymentRow(payment.id)).amountPoisha).toBe(fixture.feePoisha);
  });

  it('settles inline under the mock provider, and records its reference', async () => {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();

    const response = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key });

    const payment = (response.body as { data: { payment: { id: string; state: string } } }).data
      .payment;

    expect(payment.state).toBe('paid');

    const row = await paymentRow(payment.id);
    expect(row.providerRef).not.toBeNull();

    // `CLAUDE.md` §7: the reference identifies a real wallet transaction and
    // never leaves the database.
    expect(JSON.stringify(response.body)).not.toContain(row.providerRef ?? 'unreachable');
  });

  it('records paying at the counter as an intention, not a charge', async () => {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();

    const response = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'at_hospital', idempotencyKey: key });

    const payment = (response.body as { data: { payment: { id: string; state: string } } }).data
      .payment;

    // The row exists so a settlement can count it; nobody has taken the cash.
    expect(payment.state).toBe('pending');
    expect((await paymentRow(payment.id)).providerRef).toBeNull();
  });

  it('refuses a payment that names two things, or none', async () => {
    const { bookingId, token } = await payableBooking();

    for (const body of [
      { method: 'bkash', idempotencyKey: randomUUID() },
      {
        bookingId,
        testOrderId: randomUUID(),
        method: 'bkash',
        idempotencyKey: randomUUID(),
      },
    ]) {
      await request(app)
        .post(`${BASE}/payments/intent`)
        .set('Authorization', bearer(token))
        .set('Idempotency-Key', randomUUID())
        .send(body)
        .expect(400);
    }
  });
});

// ---------------------------------------------------------------------------
// Who may do what (`FR-ROLE-01`)
// ---------------------------------------------------------------------------

describe('the auth matrix', () => {
  it('needs a principal of some kind', async () => {
    const { bookingId } = await payableBooking();
    await request(app)
      .post(`${BASE}/payments/intent`)
      .send({ bookingId, method: 'bkash', idempotencyKey: randomUUID() })
      .expect(401);
  });

  it("refuses a guest paying for somebody else's booking", async () => {
    // A forwarded SMS must not become a way to attach one guest's payment to
    // another patient's serial.
    const mine = fixture.bookingIds[0];
    const theirs = fixture.bookingIds[1];
    if (mine === undefined || theirs === undefined) throw new Error('need two bookings');

    const key = randomUUID();
    await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(await linkFor(mine)))
      .set('Idempotency-Key', key)
      .send({ bookingId: theirs, method: 'bkash', idempotencyKey: key })
      .expect(403);
  });

  it('refuses staff paying, because paying is the patient’s', async () => {
    const { bookingId } = await payableBooking();
    const key = randomUUID();

    await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(await staffToken(['receptionist'], fixture.hospitalId)))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key })
      .expect(403);
  });

  it('lets only an administrator refund', async () => {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();
    const made = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key });

    const paymentId = (made.body as { data: { payment: { id: string } } }).data.payment.id;
    const refundBody = { reason: 'doctor_absent', note: null, idempotencyKey: randomUUID() };

    for (const who of [
      await patientToken(),
      await guestToken(),
      await staffToken(['receptionist'], fixture.hospitalId),
      await staffToken(['doctor'], fixture.hospitalId),
    ]) {
      await request(app)
        .post(`${BASE}/payments/${paymentId}/refund`)
        .set('Authorization', bearer(who))
        .set('Idempotency-Key', randomUUID())
        .send(refundBody)
        .expect(403);
    }

    await request(app)
      .post(`${BASE}/payments/${paymentId}/refund`)
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .set('Idempotency-Key', randomUUID())
      .send(refundBody)
      .expect(200);
  });

  it("refuses an administrator reading another hospital's settlement", async () => {
    const other = randomUUID();
    await request(app)
      .get(`${BASE}/hospitals/${other}/settlement`)
      .query({ from: '2026-09-01', to: '2026-09-30' })
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .expect(403);
  });
});

// ---------------------------------------------------------------------------
// Refunds (`FR-PAY-03`, `FR-PAY-07`)
// ---------------------------------------------------------------------------

describe('the reason picks the rule', () => {
  /** A paid booking, ready to be refunded. */
  async function paidBooking(): Promise<string> {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();
    const made = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key });
    return (made.body as { data: { payment: { id: string } } }).data.payment.id;
  }

  it('returns everything for a doctor’s absence, whatever the policy says', async () => {
    // `FR-PAY-07`. The patient did not cancel, so no cancellation policy
    // applies to them.
    await setRefundPolicy(fixture.hospitalId, {
      cutoffHours: 48,
      beforeCutoffPercent: 0,
      afterCutoffPercent: 0,
      platformFeeRefundable: false,
    });

    const paymentId = await paidBooking();

    const response = await request(app)
      .post(`${BASE}/payments/${paymentId}/refund`)
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'doctor_absent', note: null, idempotencyKey: randomUUID() })
      .expect(200);

    expect((response.body as { data: { refundPoisha: number } }).data.refundPoisha).toBe(
      fixture.feePoisha,
    );

    const row = await paymentRow(paymentId);
    expect(row.state).toBe('refunded');
    expect(row.refundedPoisha).toBe(fixture.feePoisha);
  });

  it('says the hospital will decide when it has set no terms', async () => {
    // `PRD.md` §3.2: refusing is more honest than returning zero as though a
    // rule had decided it.
    await setRefundPolicy(fixture.hospitalId, {});
    const paymentId = await paidBooking();

    const response = await request(app)
      .post(`${BASE}/payments/${paymentId}/refund`)
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .set('Idempotency-Key', randomUUID())
      .send({ reason: 'patient_cancelled', note: null, idempotencyKey: randomUUID() });

    expect(response.status).toBe(409);
    expect((response.body as { error: { code: string } }).error.code).toBe('REFUND_POLICY_UNKNOWN');
    expect((await paymentRow(paymentId)).refundedPoisha).toBe(0);
  });

  it('answers a second refund as a replay rather than paying twice', async () => {
    const paymentId = await paidBooking();
    const admin = await staffToken(['hospital_admin'], fixture.hospitalId);
    const body = { reason: 'doctor_absent', note: null, idempotencyKey: randomUUID() };

    await request(app)
      .post(`${BASE}/payments/${paymentId}/refund`)
      .set('Authorization', bearer(admin))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(200);

    const again = await request(app)
      .post(`${BASE}/payments/${paymentId}/refund`)
      .set('Authorization', bearer(admin))
      .set('Idempotency-Key', randomUUID())
      .send(body)
      .expect(200);

    expect((again.body as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    expect((await paymentRow(paymentId)).refundedPoisha).toBe(fixture.feePoisha);
  });
});

// ---------------------------------------------------------------------------
// Money is never edited (migration 0009)
// ---------------------------------------------------------------------------

describe('an agreed amount cannot be revised', () => {
  it('refuses a direct update to the amount', async () => {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();
    const made = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'bkash', idempotencyKey: key });

    const paymentId = (made.body as { data: { payment: { id: string } } }).data.payment.id;

    // No endpoint does this; the guarantee is the database's, so that no
    // later code path can quietly change what somebody agreed to.
    await expect(
      sql`UPDATE payments SET amount_poisha = 1 WHERE id = ${paymentId}::uuid`.execute(db),
    ).rejects.toThrow(/fixed at creation/);
  });
});

// ---------------------------------------------------------------------------
// Settlement (`FR-PAY-05`)
// ---------------------------------------------------------------------------

describe('the settlement report', () => {
  it('reports the five figures and declares disputes as zero', async () => {
    const response = await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/settlement`)
      .query({ from: '2026-01-01', to: '2030-12-31' })
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .expect(200);

    const data = (
      response.body as {
        data: {
          bookings: number;
          settlement: {
            collectionsPoisha: number;
            refundsPoisha: number;
            netCollectionsPoisha: number;
            payoutPoisha: number;
            disputes: number;
            byMethod: unknown[];
          };
        };
      }
    ).data;

    expect(data.bookings).toBeGreaterThan(0);
    expect(data.settlement.netCollectionsPoisha).toBe(
      data.settlement.collectionsPoisha - data.settlement.refundsPoisha,
    );
    // `FR-PAY-05` names disputes; this version can raise none, and says so.
    expect(data.settlement.disputes).toBe(0);
    expect(data.settlement.payoutPoisha).toBeGreaterThanOrEqual(0);
  });

  it('refuses a period that is not a pair of dates', async () => {
    await request(app)
      .get(`${BASE}/hospitals/${fixture.hospitalId}/settlement`)
      .query({ from: 'last tuesday', to: '2026-09-30' })
      .set('Authorization', bearer(await staffToken(['hospital_admin'], fixture.hospitalId)))
      .expect(400);
  });
});

// ---------------------------------------------------------------------------
// Webhooks — the signature is the authentication
// ---------------------------------------------------------------------------

describe('a provider callback is trusted only when it is signed', () => {
  async function pendingPayment(): Promise<{ paymentId: string; providerRef: string }> {
    const { bookingId, token } = await payableBooking();
    const key = randomUUID();
    const made = await request(app)
      .post(`${BASE}/payments/intent`)
      .set('Authorization', bearer(token))
      .set('Idempotency-Key', key)
      .send({ bookingId, method: 'at_hospital', idempotencyKey: key });

    const paymentId = (made.body as { data: { payment: { id: string } } }).data.payment.id;

    // Counter payments carry no provider reference, so give it one the way a
    // real provider would — by naming it in the callback.
    const providerRef = `ref_${randomUUID()}`;
    await sql`
      UPDATE payments SET provider_ref = ${providerRef} WHERE id = ${paymentId}::uuid
    `.execute(db);

    return { paymentId, providerRef };
  }

  it('changes nothing without a signature', async () => {
    const { paymentId, providerRef } = await pendingPayment();

    await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ providerRef, status: 'Success' }))
      .expect(401);

    expect((await paymentRow(paymentId)).state).toBe('pending');
  });

  it('changes nothing with the wrong signature', async () => {
    const { paymentId, providerRef } = await pendingPayment();
    const body = JSON.stringify({ providerRef, status: 'Success' });

    await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', mockWebhookSignature('a different body'))
      .send(body)
      .expect(401);

    expect((await paymentRow(paymentId)).state).toBe('pending');
  });

  it('marks a payment paid when the signature checks out', async () => {
    const { paymentId, providerRef } = await pendingPayment();
    const body = JSON.stringify({ providerRef, status: 'Success' });

    const response = await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', mockWebhookSignature(body))
      .send(body)
      .expect(200);

    expect((response.body as { data: { applied: boolean } }).data.applied).toBe(true);
    expect((await paymentRow(paymentId)).state).toBe('paid');
  });

  it('answers a replayed callback 200 and changes nothing twice', async () => {
    // A 4xx would make the provider keep retrying something already done.
    const { paymentId, providerRef } = await pendingPayment();
    const body = JSON.stringify({ providerRef, status: 'Success' });
    const signature = mockWebhookSignature(body);

    await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', signature)
      .send(body)
      .expect(200);

    const replay = await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', signature)
      .send(body)
      .expect(200);

    expect((replay.body as { data: { applied: boolean } }).data.applied).toBe(false);
    expect((await paymentRow(paymentId)).state).toBe('paid');
  });

  it('marks a failure when the provider says the payment did not work', async () => {
    const { paymentId, providerRef } = await pendingPayment();
    const body = JSON.stringify({ providerRef, status: 'Failed' });

    await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', mockWebhookSignature(body))
      .send(body)
      .expect(200);

    expect((await paymentRow(paymentId)).state).toBe('failed');
  });

  it('says nothing about a reference it does not hold', async () => {
    // Signed, but names a transaction that is not ours. Answering 200 with
    // `applied: false` tells a prober nothing about which refs are real.
    const body = JSON.stringify({ providerRef: `ref_${randomUUID()}`, status: 'Success' });

    const response = await request(app)
      .post(`${BASE}/webhooks/bkash`)
      .set('Content-Type', 'application/json')
      .set('x-signature', mockWebhookSignature(body))
      .send(body)
      .expect(200);

    expect((response.body as { data: { applied: boolean } }).data.applied).toBe(false);
  });
});
