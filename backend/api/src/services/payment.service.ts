/**
 * Money: intents, refunds and settlements (BACKEND.md §7.7; `FR-PAY-*`).
 *
 * ## The rule this file exists to keep
 *
 * **A client never says how much.** An intent names *what* is being paid for
 * and the amount is read from that thing's own row — `bookings.fee_poisha`,
 * copied on at booking time (`DB-P5`) so a later fee change cannot alter what
 * was charged. A refund names a *reason* and the amount is `refundFor` in
 * `shared/domain`, the same function `MOD-A08-CANCEL` states the rule with
 * (`FR-PAY-03`). Neither number is ever in a request body, so neither can be
 * argued with.
 *
 * ## Every write runs the same way
 *
 *   1. **Lock** — the idempotency key for an intent, the payment row for a
 *      refund. Two refunds against one payment is how a patient gets paid
 *      twice, and the lock is what makes that impossible rather than unlikely.
 *   2. **Decide** with the domain's pure functions.
 *   3. **Call the provider** outside the transaction, for the reason the lab's
 *      upload stores its file outside one: a network round trip must not hold
 *      a database connection, and a provider call that fails after the rows
 *      are written is worse than one that fails before.
 *   4. **Record** what the provider said, in its own short transaction.
 *
 * ## `FR-PAY-06`, three deep
 *
 * The caller's key is unique in the database (`payments_idempotency_key`),
 * serialised by an advisory lock so a replay that races its original waits,
 * and passed to the provider so even a retry that got past both finds the
 * same transaction. Any one of the three would usually do. Payments get all
 * three because the failure is somebody being charged twice for a serial.
 */

import {
  readRefundPolicy,
  refundFor,
  settle,
  type PaymentMethod,
  type RefundReason,
  type Settlement,
  type Timestamp,
} from '@platform/domain';

import { payments as provider } from '../adapters/payments/index.js';
import { logger } from '../config/logger.js';
import { env } from '../env.js';
import { AppError, forbiddenScope, notFound } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as paymentRepo from '../repositories/payment.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import type { PaymentView } from '../repositories/payment.repo.js';

/**
 * Who is paying. Exactly one, matching `payments_one_payer`.
 *
 * `guestId` is a `guest_identities` row, which is what `payments_one_payer`
 * references — not the `patients` row the booking also names. A guest and the
 * patient they booked for are two different things, and one is the payer.
 */
export type Payer =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'guest'; readonly guestId: string };

/** What an intent answers with. */
export interface PaymentIntentResult {
  readonly payment: PaymentView;
  /** Where the patient goes to pay, or null when it settled inline. */
  readonly redirectUrl: string | null;
  /** True when this was a replay of a payment already made (`FR-PAY-06`). */
  readonly duplicate: boolean;
  readonly serverTs: string;
}

/**
 * `POST /payments/intent`.
 *
 * Only a booking is supported in this version. `bed_request_id`,
 * `test_order_id` and `ambulance_request_id` are columns on `payments`
 * because DATABASE.md §2.6 specifies them, and none of those three has a
 * price anybody has agreed: a bed's nightly rate, a test's catalogue price
 * and an ambulance's quoted fare are commercial terms per hospital
 * (`CLAUDE.md` §1.1). Charging for them needs those terms, not more code.
 */
export async function createIntent(
  input: {
    readonly bookingId: string;
    readonly method: PaymentMethod;
    readonly idempotencyKey: string;
    readonly returnUrl: string;
  },
  payer: Payer,
): Promise<PaymentIntentResult> {
  const { payment, duplicate } = await withTransaction(async (trx) => {
    await paymentRepo.lockIdempotencyKey(trx, input.idempotencyKey);

    const replayed = await paymentRepo.findByIdempotencyKey(trx, input.idempotencyKey);
    if (replayed !== null) return { payment: replayed, duplicate: true };

    // Inside the transaction, on the same connection: see `findDetail`. A
    // second pool connection here is how five concurrent intents deadlock.
    const booking = await bookingRepo.findDetail(input.bookingId, trx);
    if (booking === null) throw notFound('booking');

    // The amount is the booking's, never the caller's. `fee_poisha` was
    // copied onto the row when the booking was made (`DB-P5`).
    const id = await paymentRepo.insertPayment(trx, {
      bookingId: input.bookingId,
      bedRequestId: null,
      testOrderId: null,
      ambulanceRequestId: null,
      payerUserId: payer.kind === 'user' ? payer.userId : null,
      payerGuestId: payer.kind === 'guest' ? payer.guestId : null,
      amountPoisha: booking.feePoisha,
      platformFeePoisha: platformFeeWithin(booking.feePoisha),
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      createdBy: null,
    });

    const created = await paymentRepo.findPayment(id, trx);
    if (created === null) throw notFound('payment');
    return { payment: created, duplicate: false };
  });

  const serverTs = new Date().toISOString();

  // A replay is answered with what the first attempt produced, and the
  // provider is not called again — which is the whole of `FR-PAY-06`.
  if (duplicate) return { payment, redirectUrl: null, duplicate: true, serverTs };

  // Paying at the counter is an intention, not a charge. The row exists so a
  // settlement can count it (`FR-PAY-05`) and `payment.paid_at` stays null
  // until somebody takes the cash.
  if (input.method === 'at_hospital' || input.method === 'cash') {
    return { payment, redirectUrl: null, duplicate: false, serverTs };
  }

  const charged = await provider().charge({
    paymentId: payment.id,
    amountPoisha: payment.amountPoisha,
    // The provider's key is our payment's id, not the caller's key: bKash's
    // merchant invoice number is unique per merchant forever, and a uuid v7
    // is the only one of the two guaranteed to be.
    idempotencyKey: payment.id,
    returnUrl: input.returnUrl,
  });

  if (!charged.ok) {
    await withTransaction(async (trx) => {
      await paymentRepo.markFailed(trx, payment.id);
    });
    throw new AppError('PAYMENT_FAILED', { details: { reason: charged.error } });
  }

  const settled = await withTransaction(async (trx) => {
    if (charged.settled) {
      await paymentRepo.markPaid(trx, {
        paymentId: payment.id,
        providerRef: charged.providerRef,
        at: new Date(),
      });
    }
    return await paymentRepo.findPayment(payment.id, trx);
  });

  return {
    payment: settled ?? payment,
    redirectUrl: charged.redirectUrl,
    duplicate: false,
    serverTs,
  };
}

/**
 * The platform's share of one fee (`FR-PAY-04`).
 *
 * Capped at the amount, because `payments_platform_fee_within_amount` refuses
 * more and a free consultation with a fee attached is not a thing. With
 * `PLATFORM_FEE_POISHA=0` — which is what `.env.example` and `render.yaml`
 * set — this is always zero, and the line is itemised as zero rather than
 * hidden.
 */
function platformFeeWithin(amountPoisha: number): number {
  // Read through the booking's own total: `feeFor` in `booking.service` has
  // already added the platform fee to what the patient was shown, so the
  // share of that total is what the fee actually was.
  return Math.min(env.PLATFORM_FEE_POISHA, amountPoisha);
}

/** What a refund answers with. */
export interface RefundResult {
  readonly payment: PaymentView;
  readonly refundPoisha: number;
  readonly duplicate: boolean;
  readonly serverTs: string;
}

/**
 * `POST /payments/:id/refund` (`FR-PAY-03`, `FR-PAY-07`).
 *
 * The amount is computed, never supplied — see the header. An administrator
 * chooses the *reason*, and the reason chooses the rule: a cancellation
 * follows the hospital's policy, an absence returns everything.
 */
export async function refund(
  input: {
    readonly paymentId: string;
    readonly reason: RefundReason;
    readonly note: string | null;
    readonly idempotencyKey: string;
  },
  actor: { readonly hospitalId: string },
): Promise<RefundResult> {
  const prepared = await withTransaction(async (trx) => {
    const payment = await paymentRepo.lockPayment(trx, input.paymentId);
    if (payment === null) throw notFound('payment');
    if (payment.bookingId === null) throw notFound('payment');

    const booking = await bookingRepo.findDetail(payment.bookingId, trx);
    if (booking === null) throw notFound('booking');
    if (booking.hospitalId !== actor.hospitalId) {
      throw forbiddenScope({ resource: 'payment', hospitalId: booking.hospitalId });
    }

    // Already fully returned: a replayed request, answered as one rather
    // than refused, so an administrator's second tap is not an error.
    if (payment.state === 'refunded') {
      return { payment, decision: null, booking };
    }

    const decision = refundFor(
      {
        amountPoisha: payment.amountPoisha,
        platformFeePoisha: payment.platformFeePoisha,
        refundedPoisha: payment.refundedPoisha,
        paidAt: payment.paidAt,
      },
      {
        reason: input.reason,
        now: new Date().toISOString() as Timestamp,
        sessionStart: booking.plannedStart as Timestamp,
        policy: readRefundPolicy(booking.refundPolicy),
      },
    );

    return { payment, decision, booking };
  });

  const serverTs = new Date().toISOString();

  if (prepared.decision === null) {
    return { payment: prepared.payment, refundPoisha: 0, duplicate: true, serverTs };
  }

  const { decision } = prepared;

  // The hospital has no policy, so there is nothing to enforce. Refusing is
  // more honest than returning zero as though a rule had decided it
  // (`PRD.md` §3.2).
  if (!decision.stated) {
    throw new AppError('REFUND_POLICY_UNKNOWN');
  }

  if (decision.refundPoisha <= 0) {
    return { payment: prepared.payment, refundPoisha: 0, duplicate: false, serverTs };
  }

  const returned = await provider().refund({
    paymentId: prepared.payment.id,
    providerRef: prepared.payment.id,
    amountPoisha: decision.refundPoisha,
    idempotencyKey: input.idempotencyKey,
  });

  if (!returned.ok) {
    logger.error({ paymentId: prepared.payment.id, err: returned.error }, 'refund failed');
    throw new AppError('PAYMENT_FAILED', { details: { reason: returned.error } });
  }

  const after = await withTransaction(async (trx) => {
    await paymentRepo.recordRefund(trx, {
      paymentId: prepared.payment.id,
      amountPoisha: decision.refundPoisha,
      reason: input.note === null ? decision.reason : `${decision.reason}: ${input.note}`,
      at: new Date(),
    });
    return await paymentRepo.findPayment(prepared.payment.id, trx);
  });

  return {
    payment: after ?? prepared.payment,
    refundPoisha: decision.refundPoisha,
    duplicate: false,
    serverTs,
  };
}

/**
 * `FR-PAY-07` — "doctor absence triggers automatic refund eligibility without
 * the patient asking."
 *
 * Called when a session ends. Every patient who paid and was never seen
 * becomes eligible in one statement: eligibility is a `refund_reason` with no
 * money moved yet, which is exactly what `payments_refund_pending_idx`
 * selects and what an administrator's list reads.
 *
 * **Eligibility, not payment.** Each refund is then its own decision with its
 * own provider call, because a batch of provider calls inside a session's end
 * would make ending a session fail when a gateway is slow. The patient is
 * owed the moment the session ends; the money follows.
 *
 * ## What counts as absence
 *
 * No document defines it. Implemented as: the session ended, and no
 * `DOCTOR_ARRIVED` was ever appended to its log. A session where the doctor
 * came and simply did not reach everybody is `session_ended` instead — the
 * patients are equally owed, and the reason says which happened so an
 * administrator is not told a doctor was absent when they were not. Recorded
 * as an open decision.
 */
export async function raiseRefundsForEndedSession(sessionId: string): Promise<{
  readonly eligible: number;
  readonly reason: RefundReason | null;
}> {
  return await withTransaction(async (trx) => {
    const owed = await paymentRepo.paidForSession(trx, sessionId);
    if (owed.length === 0) return { eligible: 0, reason: null };

    const arrived = await paymentRepo.doctorArrived(trx, sessionId);
    const reason: RefundReason = arrived ? 'session_ended' : 'doctor_absent';

    const eligible = await paymentRepo.markRefundOwed(trx, {
      paymentIds: owed.map((entry) => entry.paymentId),
      reason,
    });

    // The session, never a patient (`DB-P7`). How many people are owed money
    // is an operational figure; who they are is not a log line.
    logger.info({ sessionId, eligible, reason }, 'refund eligibility raised');

    return { eligible, reason };
  });
}

/** `GET /payments/:id` and the booking's own list. */
export async function forBooking(bookingId: string): Promise<PaymentView[]> {
  return await paymentRepo.listForBooking(bookingId);
}

/** `GET /hospitals/:id/settlement` (`FR-PAY-05`). */
export async function settlement(
  input: { readonly hospitalId: string; readonly from: string; readonly to: string },
  actor: { readonly hospitalId: string },
): Promise<{ settlement: Settlement; bookings: number; serverTs: string }> {
  if (input.hospitalId !== actor.hospitalId) {
    throw forbiddenScope({ resource: 'settlement', hospitalId: input.hospitalId });
  }

  const [rows, bookings] = await Promise.all([
    paymentRepo.settlementRows(input),
    paymentRepo.bookingsInPeriod(input),
  ]);

  return { settlement: settle(rows), bookings, serverTs: new Date().toISOString() };
}

/**
 * Whether a callback really came from the provider.
 *
 * Here rather than in the controller because the adapter lives behind the
 * service layer (CLAUDE.md §7), and because "is this the provider" is a
 * decision about money rather than about HTTP. Fails closed: an unconfigured
 * provider has no key to check against and trusts nothing.
 */
export function verifyProviderSignature(rawBody: string, signature: string | undefined): boolean {
  return provider().verifyWebhook(rawBody, signature);
}

/**
 * A provider's callback (`POST /webhooks/bkash` | `/nagad`).
 *
 * The signature is checked by the adapter before this is called; by here the
 * callback is known to be the provider's. What remains is to find the payment
 * and record what happened, idempotently — a provider that sends the same
 * callback three times must not produce three paid stamps.
 */
export async function applyProviderCallback(input: {
  readonly providerRef: string;
  readonly paid: boolean;
}): Promise<{ readonly applied: boolean }> {
  return await withTransaction(async (trx) => {
    const payment = await paymentRepo.findByProviderRef(trx, input.providerRef);
    if (payment === null) return { applied: false };

    // Already settled. `markPaid` would be harmless — it coalesces — but
    // saying so is what makes a replayed callback observable in a test.
    if (payment.state !== 'pending') return { applied: false };

    if (input.paid) {
      await paymentRepo.markPaid(trx, {
        paymentId: payment.id,
        providerRef: input.providerRef,
        at: new Date(),
      });
    } else {
      await paymentRepo.markFailed(trx, payment.id);
    }

    logger.info({ paymentId: payment.id, paid: input.paid }, 'provider callback applied');
    return { applied: true };
  });
}
