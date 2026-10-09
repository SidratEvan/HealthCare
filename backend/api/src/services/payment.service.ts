/**
 * Money: intents, refunds and settlements (BACKEND.md §7.7, §8; `FR-PAY-*`).
 *
 * ## The rule this file exists to keep
 *
 * **A client never says how much.** An intent names *what* is being paid for
 * and the amount is read from that thing's own row — `bookings.fee_poisha`,
 * copied on at booking time (`DB-P5`) so a later fee change cannot alter what
 * was charged. A refund names a *reason* and the amount is `refundFor` in
 * `shared/domain` (`FR-PAY-03`). Neither number is ever in a request body.
 *
 * ## And the second one (plan H3, `FR-PAY-09`)
 *
 * **Only the provider says a payment was made.** A patient's browser coming
 * back from bKash with "success" in its address proves nothing; the server
 * asks the provider, server to server, and records what it answers, the
 * amount included. Nothing else in this file marks a payment paid, except a
 * provider that settled on the spot when asked to charge.
 *
 * ## Every write runs the same way
 *
 *   1. **Lock** — the idempotency key for an intent, the payment row for a
 *      refund or a confirmation.
 *   2. **Decide** with the domain's pure functions.
 *   3. **Call the provider** outside the transaction: a network round trip
 *      must not hold a database connection.
 *   4. **Record** what the provider said, in its own short transaction, under
 *      the lock again, and decide against what is there by then.
 *
 * ## A serial held while it is paid for (`FR-PAY-08`, question 15)
 *
 * An online attempt carries a deadline (`hold_until`): the hospital's payment
 * hold from the booking's first online attempt; a second attempt keeps the
 * first's deadline, so retrying never holds a serial longer. When it runs out
 * (`expireHolds`, on a timer) the serial becomes pay-at-the-counter, or, for a
 * booking that had to be paid first, is released through the queue.
 *
 * ## `FR-PAY-06`, three deep
 *
 * The caller's key is unique in the database (`payments_idempotency_key`),
 * serialised by an advisory lock so a replay that races its original waits,
 * and the provider is given our payment's own id so even a retry that got past
 * both finds the same attempt. Money a provider reports for a serial already
 * paid is recorded and owed back (`FR-PAY-10`), never lost.
 */

import { createHash } from 'node:crypto';

import {
  readRefundPolicy,
  refundFor,
  settle,
  type PaymentMethod,
  type RefundReason,
  type Settlement,
  type Timestamp,
} from '@platform/domain';
import type { TemplateKey } from '@platform/i18n';

import {
  isOnline,
  mockProvider,
  payments as callbackProvider,
  providerFor,
  type ConfirmResult,
  type ReturnHint,
} from '../adapters/payments/index.js';
import { runInDbScope } from '../config/dbScope.js';
import { logger } from '../config/logger.js';
import { env } from '../env.js';
import { AppError, forbiddenScope, notFound } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as notificationRepo from '../repositories/notification.repo.js';
import * as paymentRepo from '../repositories/payment.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import { reissueLink } from './messageLink.service.js';
import * as notifications from './notification.service.js';

import type { PaymentView } from '../repositories/payment.repo.js';
import type { Tx } from '../repositories/transaction.js';

/**
 * Who is paying. Exactly one, matching `payments_one_payer`.
 *
 * `guestId` is a `guest_identities` row, which is what `payments_one_payer`
 * references — not the `patients` row the booking also names.
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

/** Where the patient's return comes back to (`S-A-07p`). */
export type ReturnTo = (paymentId: string) => string;

const PAID_STATES = new Set(['paid', 'partially_refunded', 'refunded']);

/**
 * `POST /payments/intent`, and the first payment `POST /bookings` makes.
 *
 * Only a booking is supported in this version. `bed_request_id`,
 * `test_order_id` and `ambulance_request_id` are columns on `payments`
 * because DATABASE.md §2.6 specifies them, and none of those three has a
 * price anybody has agreed (`CLAUDE.md` §1.2).
 *
 * Since plan H3 this is also a patient's second attempt, held to four rules:
 * a booking already paid takes no more (`PAYMENT_ALREADY_MADE`); an attempt
 * after the hold has run out is refused (`PAYMENT_HOLD_ENDED`); the counter is
 * refused to a booking that must be paid first (`PREPAYMENT_REQUIRED`); and a
 * method nobody here takes is refused (`PAYMENT_UNAVAILABLE`).
 */
export async function createIntent(
  input: {
    readonly bookingId: string;
    readonly method: PaymentMethod;
    readonly idempotencyKey: string;
    readonly returnTo: ReturnTo;
  },
  payer: Payer,
): Promise<PaymentIntentResult> {
  const online = isOnline(input.method);
  if (online && providerFor(input.method) === null) {
    throw new AppError('PAYMENT_UNAVAILABLE', { details: { method: input.method } });
  }

  const { payment, duplicate } = await withTransaction(async (trx) => {
    await paymentRepo.lockIdempotencyKey(trx, input.idempotencyKey);

    const replayed = await paymentRepo.findByIdempotencyKey(trx, input.idempotencyKey);
    if (replayed !== null) return { payment: replayed, duplicate: true };

    // Inside the transaction, on the same connection: see `findDetail`. A
    // second pool connection here is how five concurrent intents deadlock.
    const booking = await bookingRepo.findDetail(input.bookingId, trx);
    if (booking === null) throw notFound('booking');

    const earlier = await paymentRepo.lockForBooking(trx, input.bookingId);
    if (earlier.some((row) => PAID_STATES.has(row.state))) {
      throw new AppError('PAYMENT_ALREADY_MADE');
    }
    if (!online && booking.prepaymentRequired) {
      throw new AppError('PREPAYMENT_REQUIRED');
    }

    // `FR-PAY-08`: the hold runs from the booking's first online attempt.
    const now = new Date();
    const firstDeadline = earlier
      .map((row) => row.holdUntil)
      .filter((value): value is Timestamp => value !== null)
      .sort()[0];
    if (online && firstDeadline !== undefined && Date.parse(firstDeadline) <= now.getTime()) {
      throw new AppError('PAYMENT_HOLD_ENDED');
    }
    const holdUntil = !online
      ? null
      : firstDeadline !== undefined
        ? new Date(firstDeadline)
        : new Date(now.getTime() + booking.paymentHoldMinutes * 60_000);

    // The amount is the booking's, never the caller's (`DB-P5`).
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
      holdUntil,
    });
    await paymentRepo.recordEvent(trx, {
      paymentId: id,
      kind: 'created',
      detail: { method: input.method },
    });

    // Choosing the counter ends any online attempt still under way: the
    // patient has said how they will pay. Should one complete anyway, the
    // money is recorded and the counter's row stood down (`settlePaid`).
    if (!online) {
      for (const row of earlier) {
        if (row.state === 'pending' && isOnline(row.method)) {
          await paymentRepo.markFailed(trx, row.id, 'superseded');
          await paymentRepo.recordEvent(trx, { paymentId: row.id, kind: 'superseded' });
        }
      }
    }

    const created = await paymentRepo.findPayment(id, trx);
    if (created === null) throw notFound('payment');
    return { payment: created, duplicate: false };
  });

  return await charge(payment, duplicate, input.returnTo(payment.id));
}

/**
 * A standby prepayment (`FR-PAT-26`, migration 0023).
 *
 * Paid when joining, before there is a booking to pay for, so the standby row
 * is the subject until the person is seated — at which point
 * `queue.service` moves it onto the booking it bought. The amount is the
 * session's own fee, never the caller's. It carries no hold: a standby place
 * holds no serial.
 */
export async function createStandbyPrepayment(
  input: {
    readonly standbyId: string;
    readonly amountPoisha: number;
    readonly method: PaymentMethod;
    readonly idempotencyKey: string;
    readonly returnUrl: string;
  },
  payer: Payer,
): Promise<PaymentIntentResult> {
  if (isOnline(input.method) && providerFor(input.method) === null) {
    throw new AppError('PAYMENT_UNAVAILABLE', { details: { method: input.method } });
  }

  const { payment, duplicate } = await withTransaction(async (trx) => {
    await paymentRepo.lockIdempotencyKey(trx, input.idempotencyKey);

    const replayed = await paymentRepo.findByIdempotencyKey(trx, input.idempotencyKey);
    if (replayed !== null) return { payment: replayed, duplicate: true };

    const id = await paymentRepo.insertPayment(trx, {
      bookingId: null,
      bedRequestId: null,
      testOrderId: null,
      ambulanceRequestId: null,
      standbyId: input.standbyId,
      payerUserId: payer.kind === 'user' ? payer.userId : null,
      payerGuestId: payer.kind === 'guest' ? payer.guestId : null,
      amountPoisha: input.amountPoisha,
      platformFeePoisha: platformFeeWithin(input.amountPoisha),
      method: input.method,
      idempotencyKey: input.idempotencyKey,
      createdBy: null,
    });
    await paymentRepo.recordEvent(trx, {
      paymentId: id,
      kind: 'created',
      detail: { method: input.method },
    });

    const created = await paymentRepo.findPayment(id, trx);
    if (created === null) throw notFound('payment');
    return { payment: created, duplicate: false };
  });

  return await charge(payment, duplicate, input.returnUrl);
}

/**
 * Takes the money for a payment row that now exists (`FR-PAY-01`).
 *
 * Shared by every subject: what a payment is *for* decides how the row is
 * written, and nothing about how the provider is called.
 */
async function charge(
  payment: PaymentView,
  duplicate: boolean,
  returnUrl: string,
): Promise<PaymentIntentResult> {
  const serverTs = new Date().toISOString();

  // A replay is answered with what the first attempt produced, and the
  // provider is not called again — which is the whole of `FR-PAY-06`.
  if (duplicate) return { payment, redirectUrl: null, duplicate: true, serverTs };

  // Paying at the counter is an intention, not a charge. The row exists so a
  // settlement can count it (`FR-PAY-05`) and `paid_at` stays null until
  // somebody takes the cash.
  const provider = providerFor(payment.method);
  if (provider === null) return { payment, redirectUrl: null, duplicate: false, serverTs };

  const charged = await provider.charge({
    paymentId: payment.id,
    amountPoisha: payment.amountPoisha,
    // The provider's key is our payment's id, not the caller's key: bKash's
    // merchant invoice number is unique per merchant forever, and a uuid v7
    // is the only one of the two guaranteed to be.
    idempotencyKey: payment.id,
    returnUrl,
  });

  if (!charged.ok) {
    await withTransaction(async (trx) => {
      await paymentRepo.markFailed(trx, payment.id, 'provider_error');
      await paymentRepo.recordEvent(trx, {
        paymentId: payment.id,
        kind: 'failed',
        detail: { reason: 'provider_error', provider: provider.name },
      });
    });
    throw new AppError('PAYMENT_FAILED', { details: { reason: charged.error } });
  }

  const after = await withTransaction(async (trx) => {
    await paymentRepo.setCheckout(trx, payment.id, charged.checkoutId);
    if (charged.settled) {
      await paymentRepo.markPaid(trx, {
        paymentId: payment.id,
        providerRef: charged.providerRef ?? charged.checkoutId,
        at: new Date(),
      });
      await paymentRepo.recordEvent(trx, { paymentId: payment.id, kind: 'paid' });
    } else {
      await paymentRepo.recordEvent(trx, {
        paymentId: payment.id,
        kind: 'redirected',
        detail: { provider: provider.name },
      });
    }
    return await paymentRepo.findPayment(payment.id, trx);
  });

  return {
    payment: after ?? payment,
    redirectUrl: charged.settled ? null : charged.redirectUrl,
    duplicate: false,
    serverTs,
  };
}

/**
 * The platform's share of one fee (`FR-PAY-04`).
 *
 * Capped at the amount, because `payments_platform_fee_within_amount` refuses
 * more. With `PLATFORM_FEE_POISHA=0` this is always zero, and the line is
 * itemised as zero rather than hidden.
 */
function platformFeeWithin(amountPoisha: number): number {
  return Math.min(env.PLATFORM_FEE_POISHA, amountPoisha);
}

// --- The patient's return, and asking the provider (FR-PAY-09) -------------

/** What became of the serial a payment was for, as the patient is told it. */
export type SerialStanding = 'held' | 'confirmed' | 'counter' | 'released' | 'cancelled';

export interface ConfirmAnswer {
  readonly payment: PaymentView;
  readonly serial: SerialStanding;
  /** Whether the counter may be chosen instead (`FR-PAY-02`): not where it must be paid first. */
  readonly counterAllowed: boolean;
  readonly serverTs: string;
}

/**
 * `POST /bookings/:id/payments/:paymentId/confirm` — the patient's return
 * from the provider (`S-A-07p`).
 *
 * The route has already held the caller to the booking. From here the work is
 * the server's own (it writes messages and may mint a link), so it runs in the
 * `system` scope, as a signed provider callback does (migration 0056).
 */
export async function confirmForBooking(input: {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly hint: ReturnHint | null;
}): Promise<ConfirmAnswer> {
  return await runInDbScope({ kind: 'system' }, async () => {
    const payment = await paymentRepo.findPayment(input.paymentId);
    if (payment?.bookingId !== input.bookingId) throw notFound('payment');

    await ask(payment, input.hint);

    return await withTransaction(async (trx) => {
      const after = await paymentRepo.findPayment(input.paymentId, trx);
      if (after === null) throw notFound('payment');
      const booking = await bookingRepo.findDetail(input.bookingId, trx);
      return {
        payment: after,
        serial: await standingOf(trx, input.bookingId),
        counterAllowed: booking !== null && !booking.prepaymentRequired,
        serverTs: new Date().toISOString(),
      };
    });
  });
}

/** What the patient's serial now is, from the booking and its payments. */
async function standingOf(trx: Tx, bookingId: string): Promise<SerialStanding> {
  const booking = await bookingRepo.findDetail(bookingId, trx);
  const rows = await paymentRepo.lockForBooking(trx, bookingId);
  if (booking === null) return 'cancelled';
  if (booking.status === 'cancelled') {
    return rows.some((row) => row.failureReason === 'expired') ? 'released' : 'cancelled';
  }
  if (rows.some((row) => PAID_STATES.has(row.state))) return 'confirmed';
  if (rows.some((row) => row.state === 'pending' && !isOnline(row.method))) return 'counter';
  return 'held';
}

/**
 * Asks the provider about one attempt and records the answer.
 *
 * Settled payments are not asked again; an attempt the provider has no id for
 * (it never began) cannot be.
 */
async function ask(payment: PaymentView, hint: ReturnHint | null): Promise<void> {
  if (PAID_STATES.has(payment.state)) return;
  if (payment.failureReason === 'amount_mismatch' || payment.failureReason === 'provider_error') {
    return;
  }
  const provider = providerFor(payment.method);
  if (provider === null) return;

  const refs = await withTransaction(async (trx) => await paymentRepo.refsOf(trx, payment.id));
  if (refs.checkoutId === null) return;

  const answer = await provider.confirm({
    paymentId: payment.id,
    checkoutId: refs.checkoutId,
    amountPoisha: payment.amountPoisha,
    hint,
  });

  const tell = await withTransaction(
    async (trx) => await applyAnswer(trx, payment.id, answer, provider.name),
  );
  await tellPatient(tell);
}

/** A message the patient is to be sent once the transaction has committed. */
interface Telling {
  readonly bookingId: string;
  readonly sessionId: string;
  readonly templateKey: TemplateKey;
  readonly withLink: boolean;
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * Records what a provider said about an attempt, under the lock, against the
 * row as it stands by then.
 */
async function applyAnswer(
  trx: Tx,
  paymentId: string,
  answer: ConfirmResult,
  providerName: string,
): Promise<Telling | null> {
  const locked = await paymentRepo.lockPayment(trx, paymentId);
  if (locked === null) return null;
  const now = new Date();
  await paymentRepo.markChecked(trx, paymentId, now);

  switch (answer.status) {
    case 'paid':
      return await settlePaid(trx, locked, answer, providerName);

    case 'failed':
      if (locked.state === 'pending') {
        await paymentRepo.markFailed(trx, paymentId, answer.reason);
        await paymentRepo.recordEvent(trx, {
          paymentId,
          kind: 'failed',
          detail: { reason: answer.reason, provider: providerName },
        });
      }
      return null;

    case 'pending':
    case 'unreachable':
      await paymentRepo.recordEvent(trx, {
        paymentId,
        kind: 'asked',
        detail: { answer: answer.status, provider: providerName },
      });
      return null;
  }
}

/**
 * The provider says money moved. It is recorded whatever our row thought
 * (`FR-PAY-10`): a payment marked expired or superseded becomes paid, because
 * the patient's money did move. Then, if the serial was already paid for or
 * already released, it is owed back.
 */
async function settlePaid(
  trx: Tx,
  locked: PaymentView,
  answer: Extract<ConfirmResult, { status: 'paid' }>,
  providerName: string,
): Promise<Telling | null> {
  if (PAID_STATES.has(locked.state)) return null;

  // `FR-PAY-09`: the amount the provider took must be the amount asked for.
  // Anything else is not this payment, and is recorded for a person to look at.
  if (answer.amountPoisha !== locked.amountPoisha) {
    if (locked.state === 'pending') {
      await paymentRepo.markFailed(trx, locked.id, 'amount_mismatch');
    }
    await paymentRepo.recordEvent(trx, {
      paymentId: locked.id,
      kind: 'amount_mismatch',
      detail: { provider: providerName },
    });
    logger.error({ paymentId: locked.id }, 'provider reported a different amount');
    return null;
  }

  await paymentRepo.markPaid(trx, {
    paymentId: locked.id,
    providerRef: answer.providerRef,
    at: new Date(),
  });
  await paymentRepo.recordEvent(trx, {
    paymentId: locked.id,
    kind: 'paid',
    detail: { provider: providerName },
  });

  if (locked.bookingId === null) return null;
  const booking = await bookingRepo.findDetail(locked.bookingId, trx);
  if (booking === null) return null;
  const siblings = await paymentRepo.lockForBooking(trx, locked.bookingId);
  const alreadyPaid = siblings.some((row) => row.id !== locked.id && PAID_STATES.has(row.state));

  if (alreadyPaid || booking.status === 'cancelled') {
    await paymentRepo.markRefundOwed(trx, {
      paymentIds: [locked.id],
      reason: (alreadyPaid ? 'duplicate_payment' : 'paid_after_release') satisfies RefundReason,
    });
    await paymentRepo.recordEvent(trx, {
      paymentId: locked.id,
      kind: 'owed_back',
      detail: { reason: alreadyPaid ? 'duplicate_payment' : 'paid_after_release' },
    });
    return {
      bookingId: booking.id,
      sessionId: booking.sessionId,
      templateKey: 'payment.owed_back',
      withLink: false,
    };
  }

  // Paid: whatever else stood in for the payment stands down.
  for (const row of siblings) {
    if (row.id !== locked.id && row.state === 'pending') {
      await paymentRepo.markFailed(trx, row.id, 'superseded');
      await paymentRepo.recordEvent(trx, { paymentId: row.id, kind: 'superseded' });
    }
  }
  return {
    bookingId: booking.id,
    sessionId: booking.sessionId,
    templateKey: 'booking.confirmed',
    withLink: true,
  };
}

/**
 * Sends one message about a booking, with a fresh tracking link where it
 * needs one. Never throws: a payment recorded and a message lost is a smaller
 * failure than the reverse.
 */
async function tellPatient(telling: Telling | null): Promise<void> {
  if (telling === null) return;
  try {
    await runInDbScope({ kind: 'system' }, async () => {
      let link: string | null = null;
      if (telling.withLink) {
        const recipient = await withTransaction(async (trx) =>
          (await notificationRepo.recipientsForSession(trx, telling.sessionId)).find(
            (entry) => entry.bookingId === telling.bookingId,
          ),
        );
        link = await reissueLink(
          { linkKind: 'booking', bookingId: telling.bookingId },
          recipient?.phone ?? null,
        );
      }
      const batch = await withTransaction(
        async (trx) =>
          await notifications.queueFor(trx, telling.sessionId, [
            {
              bookingId: telling.bookingId,
              templateKey: telling.templateKey,
              params: {
                ...(telling.params ?? {}),
                ...(link === null ? {} : { link, linkKind: 'booking' }),
              },
            },
          ]),
      );
      await notifications.dispatch(batch);
    });
  } catch (cause: unknown) {
    logger.error({ bookingId: telling.bookingId, err: cause }, 'payment message not queued');
  }
}

// --- The hold, run out (FR-PAY-08), on a timer ------------------------------

/**
 * Deals with every booking whose online attempt has run out of time.
 *
 * For each: the provider is asked once about each attempt still pending;
 * money it reports is recorded and the booking is done with. Otherwise every
 * attempt is marked `expired`, and if the booking still stands and holds no
 * other way of paying, the serial becomes pay-at-the-counter, or, where it
 * had to be paid first, is released through the queue (`PAYMENT_RELEASED_REASON`).
 *
 * Runs as `system`. Returns how many bookings it dealt with.
 */
export async function expireHolds(now: Date = new Date()): Promise<number> {
  return await runInDbScope({ kind: 'system' }, async () => {
    const due = await paymentRepo.bookingsWithHoldsDue(now, 50);
    for (const bookingId of due) {
      try {
        await expireOne(bookingId, now);
      } catch (cause: unknown) {
        logger.error({ bookingId, err: cause }, 'payment hold could not be closed');
      }
    }
    return due.length;
  });
}

async function expireOne(bookingId: string, now: Date): Promise<void> {
  // First, the provider's last word on every attempt still pending.
  const pending = (await paymentRepo.listForBooking(bookingId)).filter(
    (row) => row.state === 'pending' && isOnline(row.method),
  );
  for (const row of pending) await ask(row, null);

  const outcome = await withTransaction(async (trx) => {
    const booking = await bookingRepo.findDetail(bookingId, trx);
    const rows = await paymentRepo.lockForBooking(trx, bookingId);
    if (booking === null) return null;

    for (const row of rows) {
      if (row.holdUntil === null || Date.parse(row.holdUntil) >= now.getTime()) continue;
      if (row.state === 'pending') await paymentRepo.markFailed(trx, row.id, 'expired');
      await paymentRepo.recordEvent(trx, { paymentId: row.id, kind: 'expired' });
    }

    const paid = rows.some((row) => PAID_STATES.has(row.state));
    const counter = rows.some((row) => row.state === 'pending' && !isOnline(row.method));
    const live = rows.some(
      (row) =>
        row.state === 'pending' &&
        row.holdUntil !== null &&
        Date.parse(row.holdUntil) >= now.getTime(),
    );
    // Still waiting to be seen. A patient already in the chamber, seen, or
    // gone is left alone: the counter settles with them.
    const standing =
      booking.status === 'booked' || booking.status === 'waiting' || booking.status === 'late';
    if (paid || counter || live || !standing) return null;

    const latest = rows.at(-1);
    if (latest === undefined) return null;

    if (booking.prepaymentRequired) {
      await paymentRepo.recordEvent(trx, { paymentId: latest.id, kind: 'released' });
      return { kind: 'release' as const, booking };
    }

    // The counter: an intention to pay there, as `at_hospital` always is.
    const counterId = await paymentRepo.insertPayment(trx, {
      bookingId,
      bedRequestId: null,
      testOrderId: null,
      ambulanceRequestId: null,
      ...(await paymentRepo.payerOf(trx, latest.id)),
      amountPoisha: booking.feePoisha,
      platformFeePoisha: platformFeeWithin(booking.feePoisha),
      method: 'at_hospital',
      idempotencyKey: `counter:${latest.id}`,
      createdBy: null,
    });
    await paymentRepo.recordEvent(trx, { paymentId: latest.id, kind: 'counter' });
    await paymentRepo.recordEvent(trx, {
      paymentId: counterId,
      kind: 'created',
      detail: { method: 'at_hospital', after: 'expired' },
    });
    return { kind: 'counter' as const, booking };
  });

  if (outcome === null) return;
  if (outcome.kind === 'counter') {
    await tellPatient({
      bookingId,
      sessionId: outcome.booking.sessionId,
      templateKey: 'payment.counter',
      withLink: true,
    });
    return;
  }

  // Released through the queue, the one write path into the log (BACKEND.md
  // §4): the serial is freed for the next person and every screen hears of
  // it; the patient is sent `payment.released` in place of the cancellation.
  const { cancelBooking } = await import('./booking.service.js');
  await cancelBooking({
    bookingId,
    actor: { kind: 'system', job: 'payment_holds' },
    reason: notifications.PAYMENT_RELEASED_REASON,
    // One release per booking, whichever process gets there: a key derived
    // from the booking, in the uuid shape the queue's log keys take.
    clientEventId: keyFor(`payment-release:${bookingId}`),
  });
}

/** A uuid-shaped key derived from a name, the same every time. */
function keyFor(name: string): string {
  const hex = createHash('sha256').update(name).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Asks once more about attempts that ran out within the last day (every
 * fifteen minutes each): Nagad in particular can complete after the patient
 * has gone, and that money is recorded and, where due, owed back.
 */
export async function askAgainAfterExpiry(now: Date = new Date()): Promise<number> {
  return await runInDbScope({ kind: 'system' }, async () => {
    const ids = await paymentRepo.expiredToAskAgain(now, 20);
    for (const id of ids) {
      const row = await paymentRepo.findPayment(id);
      if (row !== null) await ask(row, null).catch(() => undefined);
    }
    return ids.length;
  });
}

// --- Refunds (FR-PAY-03, FR-PAY-07, FR-PAY-12) ------------------------------

/** What a refund answers with. */
export interface RefundResult {
  readonly payment: PaymentView;
  readonly refundPoisha: number;
  readonly duplicate: boolean;
  /** True where it was recorded by hand, with no provider called (`FR-PAY-12`). */
  readonly byHand: boolean;
  readonly serverTs: string;
}

/**
 * `POST /payments/:id/refund` (`FR-PAY-03`, `FR-PAY-07`).
 *
 * The amount is computed, never supplied. An administrator chooses the
 * *reason*, and the reason chooses the rule.
 *
 * Since plan H3 the money goes back through the provider it came in by, given
 * that provider's own references. Where the provider takes no refund by API —
 * Nagad as published, and cash or the counter always — the refund is recorded
 * by hand and `note` must say under what reference it was made (`FR-PAY-12`).
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
      return { payment, decision: null, refs: null };
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

    return { payment, decision, refs: await paymentRepo.refsOf(trx, payment.id) };
  });

  const serverTs = new Date().toISOString();

  if (prepared.decision === null) {
    return {
      payment: prepared.payment,
      refundPoisha: 0,
      duplicate: true,
      byHand: false,
      serverTs,
    };
  }

  const { decision } = prepared;

  // The hospital has no policy, so there is nothing to enforce. Refusing is
  // more honest than returning zero as though a rule had decided it.
  if (!decision.stated) throw new AppError('REFUND_POLICY_UNKNOWN');

  if (decision.refundPoisha <= 0) {
    return {
      payment: prepared.payment,
      refundPoisha: 0,
      duplicate: false,
      byHand: false,
      serverTs,
    };
  }

  const provider = providerFor(prepared.payment.method);
  const byHand = !provider?.refundsByApi;
  if (byHand && (input.note === null || input.note.trim() === '')) {
    throw new AppError('REFUND_NOTE_REQUIRED');
  }

  if (provider !== null && !byHand) {
    const returned = await provider.refund({
      paymentId: prepared.payment.id,
      checkoutId: prepared.refs?.checkoutId ?? null,
      providerRef: prepared.refs?.providerRef ?? null,
      amountPoisha: decision.refundPoisha,
      idempotencyKey: input.idempotencyKey,
      reason: decision.reason,
    });
    if (!returned.ok) {
      logger.error({ paymentId: prepared.payment.id, err: returned.error }, 'refund failed');
      throw new AppError('PAYMENT_FAILED', { details: { reason: returned.error } });
    }
  }

  const after = await withTransaction(async (trx) => {
    await paymentRepo.recordRefund(trx, {
      paymentId: prepared.payment.id,
      amountPoisha: decision.refundPoisha,
      reason: input.note === null ? decision.reason : `${decision.reason}: ${input.note}`,
      at: new Date(),
    });
    await paymentRepo.recordEvent(trx, {
      paymentId: prepared.payment.id,
      kind: 'refunded',
      detail: { reason: decision.reason, by: byHand ? 'hand' : 'provider' },
    });
    return await paymentRepo.findPayment(prepared.payment.id, trx);
  });

  return {
    payment: after ?? prepared.payment,
    refundPoisha: decision.refundPoisha,
    duplicate: false,
    byHand,
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
 * would make ending a session fail when a gateway is slow.
 *
 * ## What counts as absence
 *
 * The session ended, and no `DOCTOR_ARRIVED` was ever appended to its log. A
 * session where the doctor came and simply did not reach everybody is
 * `session_ended` instead. Recorded as an open decision.
 */
export async function raiseRefundsForEndedSession(sessionId: string): Promise<{
  readonly eligible: number;
  readonly reason: RefundReason | null;
}> {
  return await withTransaction(async (trx) => {
    // `FR-PAT-26`: whoever paid to be seated from the standby list and never
    // was is owed all of it back, whatever else is true of the session.
    const standbyOwed = await paymentRepo.markRefundOwed(trx, {
      paymentIds: await paymentRepo.unseatedStandbyForSession(trx, sessionId),
      reason: 'standby_unseated' satisfies RefundReason,
    });
    if (standbyOwed > 0) logger.info({ sessionId, standbyOwed }, 'standby refunds owed');

    const owed = await paymentRepo.paidForSession(trx, sessionId);
    if (owed.length === 0) return { eligible: 0, reason: null };

    const arrived = await paymentRepo.doctorArrived(trx, sessionId);
    const reason: RefundReason = arrived ? 'session_ended' : 'doctor_absent';

    const eligible = await paymentRepo.markRefundOwed(trx, {
      paymentIds: owed.map((entry) => entry.paymentId),
      reason,
    });

    // The session, never a patient (`DB-P7`).
    logger.info({ sessionId, eligible, reason }, 'refund eligibility raised');

    return { eligible, reason };
  });
}

/** `GET /bookings/:id/payments`. Who may ask is the controller's question. */
export async function forBooking(bookingId: string): Promise<PaymentView[]> {
  return await paymentRepo.listForBooking(bookingId);
}

/** `GET /payments/:id/history` (`FR-PAY-11`): the hospital's administrator's. */
export async function history(
  paymentId: string,
  actor: { readonly hospitalId: string },
): Promise<{ readonly events: paymentRepo.PaymentEventView[] }> {
  const hospitalId = await paymentRepo.hospitalOf(paymentId);
  // Another hospital's payment is not there, as another hospital's rows never are.
  if (hospitalId === null || hospitalId !== actor.hospitalId) throw notFound('payment');
  return { events: await paymentRepo.historyOf(paymentId) };
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
 * Whether a callback really came from the provider. Fails closed: neither
 * bKash's checkout nor Nagad's sends a signed callback, so only the mock's
 * test hook can pass.
 */
export function verifyProviderSignature(rawBody: string, signature: string | undefined): boolean {
  return callbackProvider().verifyWebhook(rawBody, signature);
}

/**
 * A provider's signed callback (`POST /webhooks/bkash` | `/nagad`), found by
 * the reference it names. Kept for the mock's signed hook; recorded
 * idempotently, so the same callback three times is one paid stamp.
 */
export async function applyProviderCallback(input: {
  readonly providerRef: string;
  readonly paid: boolean;
}): Promise<{ readonly applied: boolean }> {
  return await runInDbScope({ kind: 'system' }, async () => await applyCallback(input));
}

async function applyCallback(input: {
  readonly providerRef: string;
  readonly paid: boolean;
}): Promise<{ readonly applied: boolean }> {
  return await withTransaction(async (trx) => {
    const payment = await paymentRepo.findByProviderRef(trx, input.providerRef);
    if (payment === null) return { applied: false };
    if (payment.state !== 'pending') return { applied: false };

    if (input.paid) {
      await paymentRepo.markPaid(trx, {
        paymentId: payment.id,
        providerRef: input.providerRef,
        at: new Date(),
      });
      await paymentRepo.recordEvent(trx, { paymentId: payment.id, kind: 'paid' });
    } else {
      await paymentRepo.markFailed(trx, payment.id, 'declined');
      await paymentRepo.recordEvent(trx, {
        paymentId: payment.id,
        kind: 'failed',
        detail: { reason: 'declined' },
      });
    }

    logger.info({ paymentId: payment.id, paid: input.paid }, 'provider callback applied');
    return { applied: true };
  });
}

// --- The simulated provider's page (plan H3) -------------------------------

/** What the simulated page shows for one attempt, or null for none. */
export function mockAttempt(
  checkoutId: string,
): { readonly amountPoisha: number; readonly outcome: string } | null {
  return mockProvider().attempt(checkoutId);
}

/** Records the button pressed on the simulated page; answers where to go back to. */
export function mockSettle(
  checkoutId: string,
  outcome: 'paid' | 'failed' | 'cancelled',
): string | null {
  return mockProvider().settle(checkoutId, outcome);
}
