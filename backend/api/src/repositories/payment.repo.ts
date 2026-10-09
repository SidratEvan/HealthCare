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
  /** An online attempt's deadline (0057, `FR-PAY-08`). */
  readonly holdUntil: Timestamp | null;
  /** Why a failed payment failed (0057). */
  readonly failureReason: FailureReason | null;
}

/** Why a payment failed (`payments_failure_reason_known`, 0057). */
export type FailureReason =
  'declined' | 'cancelled' | 'expired' | 'superseded' | 'provider_error' | 'amount_mismatch';

/** What a payment step is recorded as (`payment_events.kind`, 0057, `FR-PAY-11`). */
export type PaymentEventKind =
  | 'created'
  | 'redirected'
  | 'asked'
  | 'paid'
  | 'failed'
  | 'expired'
  | 'superseded'
  | 'counter'
  | 'released'
  | 'owed_back'
  | 'refunded'
  | 'amount_mismatch';

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
  hold_until: Date | null;
  failure_reason: FailureReason | null;
}

const PAYMENT_SELECT = sql`
  SELECT id, booking_id, bed_request_id, test_order_id, ambulance_request_id,
         amount_poisha, platform_fee_poisha, method::text AS method, state::text AS state,
         paid_at, refunded_poisha, refund_reason, refunded_at, created_at,
         hold_until, failure_reason
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
    holdUntil: iso(row.hold_until),
    failureReason: row.failure_reason,
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
    /** 0023 — a standby prepayment, before there is a booking (`FR-PAT-26`). */
    readonly standbyId?: string | null;
    readonly payerUserId: string | null;
    readonly payerGuestId: string | null;
    readonly amountPoisha: number;
    readonly platformFeePoisha: number;
    readonly method: PaymentMethod;
    readonly idempotencyKey: string;
    readonly createdBy: string | null;
    /** An online attempt's deadline (`FR-PAY-08`). */
    readonly holdUntil?: Date | null;
  },
): Promise<string> {
  const result = await sql<{ id: string }>`
    INSERT INTO payments
      (booking_id, bed_request_id, test_order_id, ambulance_request_id, standby_id,
       payer_user_id, payer_guest_id, amount_poisha, platform_fee_poisha,
       method, idempotency_key, created_by, hold_until)
    VALUES (
      ${input.bookingId}::uuid, ${input.bedRequestId}::uuid,
      ${input.testOrderId}::uuid, ${input.ambulanceRequestId}::uuid,
      ${input.standbyId ?? null}::uuid,
      ${input.payerUserId}::uuid, ${input.payerGuestId}::uuid,
      ${input.amountPoisha}, ${input.platformFeePoisha},
      ${input.method}::payment_method, ${input.idempotencyKey}, ${input.createdBy}::uuid,
      ${input.holdUntil ?? null}
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
           failure_reason = NULL,
           provider_ref = COALESCE(provider_ref, ${input.providerRef}),
           paid_at = COALESCE(paid_at, ${input.at})
     WHERE id = ${input.paymentId}::uuid
  `.execute(trx);
}

/** Marks a payment failed, with why (`payments_failed_says_why`, 0057). */
export async function markFailed(
  trx: Tx,
  paymentId: string,
  reason: FailureReason = 'declined',
): Promise<void> {
  await sql`
    UPDATE payments
       SET state = 'failed'::payment_state, failure_reason = ${reason}
     WHERE id = ${paymentId}::uuid
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

/**
 * The paid, unrefunded prepayment on a standby row, if it has one
 * (`FR-PAT-26`).
 */
export async function paidForStandby(trx: Tx, standbyId: string): Promise<string | null> {
  const result = await sql<{ id: string }>`
    SELECT id FROM payments
     WHERE standby_id = ${standbyId}::uuid
       AND state = 'paid'::payment_state
       AND refunded_poisha = 0
       AND refund_reason IS NULL
       AND deleted_at IS NULL
     LIMIT 1
  `.execute(trx);
  return result.rows[0]?.id ?? null;
}

/**
 * Moves a standby prepayment onto the booking it bought (`FR-QUE-30`).
 *
 * The same money, now for the thing it paid for. From here every settlement,
 * revenue and refund query that reads bookings counts it, and nothing has to
 * know it began on a standby list. The amounts are untouched —
 * `trg_payments_amount_locked` would refuse otherwise.
 */
export async function moveStandbyToBooking(
  trx: Tx,
  standbyId: string,
  bookingId: string,
): Promise<number> {
  const result = await sql<{ id: string }>`
    UPDATE payments
       SET booking_id = ${bookingId}::uuid, standby_id = NULL
     WHERE standby_id = ${standbyId}::uuid
       AND deleted_at IS NULL
    RETURNING id
  `.execute(trx);
  return result.rows.length;
}

/**
 * Standby prepayments on a session whose payer was never seated — owed back in
 * full when the session ends (`standby_unseated`). Seated ones have already
 * moved to their booking and are that booking's business.
 */
export async function unseatedStandbyForSession(trx: Tx, sessionId: string): Promise<string[]> {
  const result = await sql<{ id: string }>`
    SELECT p.id
      FROM payments p
      JOIN standby_list sl ON sl.id = p.standby_id
     WHERE sl.session_id = ${sessionId}::uuid
       AND p.state = 'paid'::payment_state
       AND p.refunded_poisha = 0
       AND p.refund_reason IS NULL
       AND p.deleted_at IS NULL
  `.execute(trx);
  return result.rows.map((row) => row.id);
}

// --- Paying by being sent away (0057, plan H3) -----------------------------

/** The provider's references for one payment. Read here and logged nowhere. */
export interface PaymentRefs {
  readonly checkoutId: string | null;
  readonly providerRef: string | null;
}

export async function refsOf(trx: Tx, paymentId: string): Promise<PaymentRefs> {
  const result = await sql<{ provider_checkout_id: string | null; provider_ref: string | null }>`
    SELECT provider_checkout_id, provider_ref FROM payments WHERE id = ${paymentId}::uuid
  `.execute(trx);
  const row = result.rows[0];
  return { checkoutId: row?.provider_checkout_id ?? null, providerRef: row?.provider_ref ?? null };
}

/** What the provider calls the attempt, written when it begins. */
export async function setCheckout(trx: Tx, paymentId: string, checkoutId: string): Promise<void> {
  await sql`
    UPDATE payments SET provider_checkout_id = ${checkoutId} WHERE id = ${paymentId}::uuid
  `.execute(trx);
}

/** When the provider was last asked about a payment. */
export async function markChecked(trx: Tx, paymentId: string, at: Date): Promise<void> {
  await sql`UPDATE payments SET checked_at = ${at} WHERE id = ${paymentId}::uuid`.execute(trx);
}

/** Every payment against one booking, locked, oldest first. */
export async function lockForBooking(trx: Tx, bookingId: string): Promise<PaymentView[]> {
  const result = await sql<PaymentSqlRow>`
    ${PAYMENT_SELECT}
     WHERE booking_id = ${bookingId}::uuid AND deleted_at IS NULL
     ORDER BY created_at
     FOR UPDATE
  `.execute(trx);
  return result.rows.map(toView);
}

/** One step of a payment (`FR-PAY-11`). The hospital is the paid thing's. */
export async function recordEvent(
  trx: Tx,
  input: {
    readonly paymentId: string;
    readonly kind: PaymentEventKind;
    readonly detail?: Readonly<Record<string, string>>;
    readonly at?: Date;
  },
): Promise<void> {
  await sql`
    INSERT INTO payment_events (payment_id, hospital_id, kind, detail, at)
    SELECT p.id,
           COALESCE(s.hospital_id, ss.hospital_id, br.hospital_id, t.hospital_id),
           ${input.kind}, ${JSON.stringify(input.detail ?? {})}::jsonb, ${input.at ?? new Date()}
      FROM payments p
      LEFT JOIN bookings b      ON b.id = p.booking_id
      LEFT JOIN sessions s      ON s.id = b.session_id
      LEFT JOIN standby_list w  ON w.id = p.standby_id
      LEFT JOIN sessions ss     ON ss.id = w.session_id
      LEFT JOIN bed_requests br ON br.id = p.bed_request_id
      LEFT JOIN test_orders t   ON t.id = p.test_order_id
     WHERE p.id = ${input.paymentId}::uuid
  `.execute(trx);
}

export interface PaymentEventView {
  readonly kind: PaymentEventKind;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly at: Timestamp;
}

/** A payment's history, oldest first. */
export async function historyOf(paymentId: string): Promise<PaymentEventView[]> {
  const result = await sql<{ kind: PaymentEventKind; detail: Record<string, unknown>; at: Date }>`
    SELECT kind, detail, at
      FROM payment_events
     WHERE payment_id = ${paymentId}::uuid
     ORDER BY at, id
  `.execute(db);
  return result.rows.map((row) => ({
    kind: row.kind,
    detail: row.detail,
    at: row.at.toISOString() as Timestamp,
  }));
}

/** The hospital a payment belongs to, through what it paid for. */
export async function hospitalOf(paymentId: string): Promise<string | null> {
  const result = await sql<{ hospital_id: string | null }>`
    SELECT COALESCE(s.hospital_id, ss.hospital_id, br.hospital_id, t.hospital_id) AS hospital_id
      FROM payments p
      LEFT JOIN bookings b      ON b.id = p.booking_id
      LEFT JOIN sessions s      ON s.id = b.session_id
      LEFT JOIN standby_list w  ON w.id = p.standby_id
      LEFT JOIN sessions ss     ON ss.id = w.session_id
      LEFT JOIN bed_requests br ON br.id = p.bed_request_id
      LEFT JOIN test_orders t   ON t.id = p.test_order_id
     WHERE p.id = ${paymentId}::uuid AND p.deleted_at IS NULL
  `.execute(db);
  return result.rows[0]?.hospital_id ?? null;
}

/** Whether a hospital takes no payment at the counter (`hospital_settings.prepay_required`). */
export async function hospitalPaysFirst(trx: Tx, hospitalId: string): Promise<boolean> {
  const result = await sql<{ prepay_required: boolean }>`
    SELECT prepay_required FROM hospital_settings WHERE hospital_id = ${hospitalId}::uuid
  `.execute(trx);
  return result.rows[0]?.prepay_required ?? false;
}

/**
 * Bookings with an online attempt whose hold has run out and that the timer
 * has not yet dealt with (no `expired` step recorded), oldest first.
 */
export async function bookingsWithHoldsDue(now: Date, limit: number): Promise<string[]> {
  const result = await sql<{ booking_id: string }>`
    SELECT p.booking_id
      FROM payments p
     WHERE p.booking_id IS NOT NULL
       AND p.hold_until IS NOT NULL
       AND p.hold_until < ${now}
       AND p.deleted_at IS NULL
       AND p.state IN ('pending', 'failed')
       AND NOT EXISTS (SELECT 1 FROM payment_events e
                        WHERE e.payment_id = p.id AND e.kind = 'expired')
     GROUP BY p.booking_id
     ORDER BY min(p.hold_until)
     LIMIT ${limit}
  `.execute(db);
  return result.rows.map((row) => row.booking_id);
}

/**
 * Attempts that ran out within the last day and have not been asked for a
 * quarter of an hour: a provider can complete after the patient has gone.
 */
export async function expiredToAskAgain(now: Date, limit: number): Promise<string[]> {
  const result = await sql<{ id: string }>`
    SELECT id
      FROM payments
     WHERE state = 'failed'
       AND failure_reason IN ('expired', 'superseded')
       AND provider_checkout_id IS NOT NULL
       AND hold_until > ${new Date(now.getTime() - 24 * 3_600_000)}
       AND (checked_at IS NULL OR checked_at < ${new Date(now.getTime() - 15 * 60_000)})
       AND deleted_at IS NULL
     ORDER BY hold_until
     LIMIT ${limit}
  `.execute(db);
  return result.rows.map((row) => row.id);
}

/** Who paid an earlier attempt, for the row that takes its place. */
export async function payerOf(
  trx: Tx,
  paymentId: string,
): Promise<{ readonly payerUserId: string | null; readonly payerGuestId: string | null }> {
  const result = await sql<{ payer_user_id: string | null; payer_guest_id: string | null }>`
    SELECT payer_user_id, payer_guest_id FROM payments WHERE id = ${paymentId}::uuid
  `.execute(trx);
  const row = result.rows[0];
  return { payerUserId: row?.payer_user_id ?? null, payerGuestId: row?.payer_guest_id ?? null };
}

/**
 * A hospital's prepayment rules (`FR-PAY-02`, `FR-GST-14`; 0058): whether it
 * takes no payment at the counter, and whether, and over how many days, it
 * asks a number with three no-shows to pay first.
 */
export async function prepaymentRules(
  trx: Tx,
  hospitalId: string,
): Promise<{
  readonly paysFirst: boolean;
  readonly noShowRuleOn: boolean;
  readonly windowDays: number;
}> {
  const result = await sql<{
    prepay_required: boolean;
    noshow_prepay: boolean;
    noshow_window_days: number;
  }>`
    SELECT prepay_required, noshow_prepay, noshow_window_days
      FROM hospital_settings WHERE hospital_id = ${hospitalId}::uuid
  `.execute(trx);
  const row = result.rows[0];
  return {
    paysFirst: row?.prepay_required ?? false,
    noShowRuleOn: row?.noshow_prepay ?? false,
    windowDays: row?.noshow_window_days ?? 90,
  };
}
