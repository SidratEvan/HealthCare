/**
 * Payments, refunds and settlements (DATABASE.md §2.6; migration 0009;
 * `FR-PAY-*`).
 *
 * The only place payment SQL lives (CLAUDE.md §7).
 *
 * **A payment is written under a lock the service took.** `lockPayment` is
 * `FOR UPDATE`; a refund racing a webhook that marks the same row paid
 * serialise on it, and the second decides against what the first wrote. For
 * money that is not a nicety — two concurrent refunds against one payment is
 * how a patient gets paid twice.
 *
 * **`provider_ref` is read and written here and logged nowhere** (CLAUDE.md
 * §7). It identifies a real transaction against a real person's wallet.
 */

import { sql } from 'kysely';

import type { PaymentMethod, PaymentState, SettlementRow, Timestamp } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

function iso(value: Date | null): Timestamp | null {
  return value === null ? null : (value.toISOString() as Timestamp);
}

/** A payment as the API returns it. Never carries `provider_ref`. */
export interface PaymentView {
  readonly id: string;
  readonly bookingId: string | null;
  readonly bedRequestId: string | null;
  readonly testOrderId: string | null;
  readonly ambulanceRequestId: string | null;
  readonly amountPoisha: number;
  readonly platformFeePoisha: number;
  readonly method: PaymentMethod;
  readonly state: PaymentState;
  readonly paidAt: Timestamp | null;
  readonly refundedPoisha: number;
  readonly refundReason: string | null;
  readonly refundedAt: Timestamp | null;
  readonly createdAt: Timestamp;
}

interface PaymentSqlRow {
  id: string;
  booking_id: string | null;
  bed_request_id: string | null;
  test_order_id: string | null;
  ambulance_request_id: string | null;
  amount_poisha: number;
  platform_fee_poisha: number;
  method: PaymentMethod;
  state: PaymentState;
  paid_at: Date | null;
  refunded_poisha: number;
  refund_reason: string | null;
  refunded_at: Date | null;
  created_at: Date;
}

const PAYMENT_SELECT = sql`
  SELECT id, booking_id, bed_request_id, test_order_id, ambulance_request_id,
         amount_poisha, platform_fee_poisha, method::text AS method, state::text AS state,
         paid_at, refunded_poisha, refund_reason, refunded_at, created_at
    FROM payments
`;

function toView(row: PaymentSqlRow): PaymentView {
  return {
    id: row.id,
    bookingId: row.booking_id,
    bedRequestId: row.bed_request_id,
    testOrderId: row.test_order_id,
    ambulanceRequestId: row.ambulance_request_id,
    amountPoisha: row.amount_poisha,
    platformFeePoisha: row.platform_fee_poisha,
    method: row.method,
    state: row.state,
    paidAt: iso(row.paid_at),
    refundedPoisha: row.refunded_poisha,
    refundReason: row.refund_reason,
    refundedAt: iso(row.refunded_at),
    createdAt: row.created_at.toISOString() as Timestamp,
  };
}

export async function findPayment(paymentId: string, trx?: Tx): Promise<PaymentView | null> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT} WHERE id = ${paymentId}::uuid AND deleted_at IS NULL
  `.execute(trx ?? db);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

export async function lockPayment(trx: Tx, paymentId: string): Promise<PaymentView | null> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT} WHERE id = ${paymentId}::uuid AND deleted_at IS NULL FOR UPDATE
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/**
 * Serialises two intents carrying one key for the rest of the transaction,
 * so a replay that races its original waits and then finds the payment.
 */
export async function lockIdempotencyKey(trx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`payment-key:${key}`}, 0))`.execute(
    trx,
  );
}

/** The payment a replayed intent already made (`FR-PAY-06`). */
export async function findByIdempotencyKey(trx: Tx, key: string): Promise<PaymentView | null> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT} WHERE idempotency_key = ${key}
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/** The payment a provider's callback names. */
export async function findByProviderRef(trx: Tx, providerRef: string): Promise<PaymentView | null> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT} WHERE provider_ref = ${providerRef} AND deleted_at IS NULL FOR UPDATE
  `.execute(trx);
  const row = result.rows[0];
  return row === undefined ? null : toView(row);
}

/** Every payment against one booking, newest first. */
export async function listForBooking(bookingId: string): Promise<PaymentView[]> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT}
     WHERE booking_id = ${bookingId}::uuid AND deleted_at IS NULL
     ORDER BY created_at DESC
  `.execute(db);
  return result.rows.map(toView);
}

export async function insertPayment(
  trx: Tx,
  input: {
    readonly bookingId: string | null;
    readonly bedRequestId: string | null;
    readonly testOrderId: string | null;
    readonly ambulanceRequestId: string | null;
    readonly payerUserId: string | null;
    readonly payerGuestId: string | null;
    readonly amountPoisha: number;
    readonly platformFeePoisha: number;
    readonly method: PaymentMethod;
    readonly idempotencyKey: string;
    readonly createdBy: string | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO payments
      (booking_id, bed_request_id, test_order_id, ambulance_request_id,
       payer_user_id, payer_guest_id, amount_poisha, platform_fee_poisha,
       method, idempotency_key, created_by)
    VALUES (
      ${input.bookingId}::uuid, ${input.bedRequestId}::uuid,
      ${input.testOrderId}::uuid, ${input.ambulanceRequestId}::uuid,
      ${input.payerUserId}::uuid, ${input.payerGuestId}::uuid,
      ${input.amountPoisha}, ${input.platformFeePoisha},
      ${input.method}::payment_method, ${input.idempotencyKey}, ${input.createdBy}::uuid
    )
    RETURNING id
  `.execute(trx);

  const row = result.rows[0];
  if (row === undefined) throw new Error('insertPayment returned no row');
  return row.id;
}

/**
 * Marks a payment taken.
 *
 * `paid_at` is written once — `COALESCE` keeps the first — so a replayed
 * webhook cannot move the instant a settlement period is computed from.
 */
export async function markPaid(
  trx: Tx,
  input: { readonly paymentId: string; readonly providerRef: string | null; readonly at: Date },
): Promise<void> {
  await sql`
    UPDATE payments
       SET state = 'paid'::payment_state,
           provider_ref = COALESCE(provider_ref, ${input.providerRef}),
           paid_at = COALESCE(paid_at, ${input.at})
     WHERE id = ${input.paymentId}::uuid
  `.execute(trx);
}

export async function markFailed(trx: Tx, paymentId: string): Promise<void> {
  await sql`
    UPDATE payments SET state = 'failed'::payment_state WHERE id = ${paymentId}::uuid
  `.execute(trx);
}

/**
 * Records money going back.
 *
 * Adds to `refunded_poisha` rather than replacing it, so two partial refunds
 * accumulate, and sets the state from the resulting total — which is what
 * `payments_refunded_in_full` and its siblings check.
 */
export async function recordRefund(
  trx: Tx,
  input: {
    readonly paymentId: string;
    readonly amountPoisha: number;
    readonly reason: string;
    readonly at: Date;
  },
): Promise<void> {
  await sql`
    UPDATE payments
       SET refunded_poisha = refunded_poisha + ${input.amountPoisha},
           refund_reason = ${input.reason},
           refunded_at = ${input.at},
           state = CASE
             WHEN refunded_poisha + ${input.amountPoisha} >= amount_poisha
               THEN 'refunded'::payment_state
             ELSE 'partially_refunded'::payment_state
           END
     WHERE id = ${input.paymentId}::uuid
  `.execute(trx);
}

/**
 * Marks a payment as owed a refund without moving money (`FR-PAY-07`).
 *
 * The reason alone, with `refunded_poisha` still zero — which is exactly what
 * `payments_refund_pending_idx` selects. Used where eligibility is raised
 * automatically and the money follows: a doctor who never arrived makes every
 * waiting patient eligible in one statement, and each refund is then its own
 * decision with its own provider call.
 *
 * Deliberately *not* written through `recordRefund`: that would set
 * `refunded_at` and trip `payments_refund_names_a_reason`, which requires a
 * stamp only once money has actually gone.
 */
export async function markRefundOwed(
  trx: Tx,
  input: { readonly paymentIds: readonly string[]; readonly reason: string },
): Promise<number> {
  if (input.paymentIds.length === 0) return 0;

  const result = await sql<{ id: string }>`
    UPDATE payments
       SET refund_reason = ${input.reason}
     WHERE id = ANY(${input.paymentIds}::uuid[])
       AND state = 'paid'::payment_state
       AND refunded_poisha = 0
       AND refund_reason IS NULL
       AND deleted_at IS NULL
    RETURNING id
  `.execute(trx);

  return result.rows.length;
}

/** Paid, unrefunded payments against a session's bookings — `FR-PAY-07`'s subjects. */
export async function paidForSession(
  trx: Tx,
  sessionId: string,
): Promise<{ paymentId: string; bookingId: string }[]> {
  const result = await sql<{ id: string; booking_id: string }>`
    SELECT p.id, p.booking_id
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
     WHERE b.session_id = ${sessionId}::uuid
       AND p.state = 'paid'::payment_state
       AND p.refunded_poisha = 0
       AND p.deleted_at IS NULL
       AND b.deleted_at IS NULL
       -- Somebody who was seen owes nothing back; somebody who never turned
       -- up forfeited by their own choice (FR-QUE-20).
       AND b.status NOT IN ('done', 'no_show', 'cancelled')
  `.execute(trx);

  return result.rows.map((row) => ({ paymentId: row.id, bookingId: row.booking_id }));
}

/** Whether a session's doctor ever arrived — what makes an absence an absence. */
export async function doctorArrived(trx: Tx, sessionId: string): Promise<boolean> {
  const result = await sql<{ present: boolean }>`
    SELECT EXISTS (
      SELECT 1 FROM queue_events
       WHERE session_id = ${sessionId}::uuid AND type = 'DOCTOR_ARRIVED'::queue_event_type
    ) AS present
  `.execute(trx);
  return result.rows[0]?.present ?? false;
}

/** The rows one hospital's settlement is computed from (`FR-PAY-05`). */
export async function settlementRows(input: {
  readonly hospitalId: string;
  readonly from: string;
  readonly to: string;
}): Promise<SettlementRow[]> {
  const result = await sql<{
    amount_poisha: number;
    platform_fee_poisha: number;
    refunded_poisha: number;
    method: PaymentMethod;
    state: PaymentState;
  }>`
    SELECT p.amount_poisha, p.platform_fee_poisha, p.refunded_poisha,
           p.method::text AS method, p.state::text AS state
      FROM payments p
      JOIN bookings b ON b.id = p.booking_id
      JOIN sessions s ON s.id = b.session_id
     WHERE s.hospital_id = ${input.hospitalId}::uuid
       AND p.deleted_at IS NULL
       -- Dated by the chamber's own day, not by when the money settled: a
       -- settlement is a statement about the days a hospital worked, and a
       -- payment that cleared at midnight belongs to the session it paid for.
       AND s.session_date >= ${input.from}::date
       AND s.session_date <= ${input.to}::date
  `.execute(db);

  return result.rows.map((row) => ({
    amountPoisha: row.amount_poisha,
    platformFeePoisha: row.platform_fee_poisha,
    refundedPoisha: row.refunded_poisha,
    method: row.method,
    state: row.state,
  }));
}

/** How many bookings the same period holds, for the settlement's first line. */
export async function bookingsInPeriod(input: {
  readonly hospitalId: string;
  readonly from: string;
  readonly to: string;
}): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT count(*)::text AS count
      FROM bookings b
      JOIN sessions s ON s.id = b.session_id
     WHERE s.hospital_id = ${input.hospitalId}::uuid
       AND s.session_date >= ${input.from}::date
       AND s.session_date <= ${input.to}::date
       AND b.deleted_at IS NULL
       AND b.status <> 'cancelled'
  `.execute(db);

  return Number(result.rows[0]?.count ?? '0');
}
