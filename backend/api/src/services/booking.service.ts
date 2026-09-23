/**
 * Booking — a patient's claim on a serial (BACKEND.md §7.3, `FR-PAT-20`…`25`).
 *
 * ## The whole thing happens inside one transaction
 *
 * A booking is three writes that must agree: an identity for whoever is
 * booking, a patient record for whoever is being seen, and the row that takes
 * a serial. Doing them separately means a crash between two of them leaves a
 * guest identity with no booking, or worse, a serial allocated to nobody.
 *
 * The serial itself is allocated under the session's lock, for the reason
 * `FR-QUE-53` exists: two people tapping confirm in the same second must get
 * different numbers, and only the database can promise that.
 *
 * ## What is deliberately not here
 *
 * `payments` is migration 0009 and the schema stops at 0006, so no payment row
 * is written and `bookings.payment_id` stays null. `PAYMENT_PROVIDER=mock`
 * succeeds — which CLAUDE.md §1.1 calls the correct implementation for this
 * version rather than a placeholder. The fee is still computed and itemised
 * (`FR-PAT-21`), because that part is code and not a commercial decision.
 *
 * No OTP is sent. `FR-GST-03` and `FR-GST-04` are deferred with the rest of
 * authentication (CLAUDE.md §4.1); under `DEMO_MODE` a guest booking mints its
 * tracking link directly.
 */

import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  id,
  time,
  type BookingId,
  type Eta,
  type QueueActor,
  type QueueState,
  type SessionId,
} from '@platform/domain';

import { logger } from '../config/logger.js';
import { env } from '../env.js';
import { AppError, notFound, validationFailed } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as notifications from './notification.service.js';
import * as payments from './payment.service.js';
import * as queueService from './queue.service.js';

import type { AppendEventResult } from './queue.service.js';

/** How the fee is shown to a patient (`FR-PAT-21`). */
export interface FeeBreakdown {
  readonly consultationPoisha: number;
  readonly platformFeePoisha: number;
  readonly totalPoisha: number;
  /**
   * What is still owed when the patient arrives.
   *
   * The whole total when they chose to pay at the hospital, zero when they
   * paid up front. Shown before confirming, because a person who thinks they
   * have paid and is then asked again at a counter has been misled.
   */
  readonly dueAtHospitalPoisha: number;
}

export type PaymentMethod = 'bkash' | 'nagad' | 'card' | 'at_hospital';

/**
 * Itemises a fee.
 *
 * Pure, and exported, so the confirm screen and the receipt cannot disagree
 * about what a booking costs.
 */
export function feeFor(consultationPoisha: number, method: PaymentMethod): FeeBreakdown {
  const platformFeePoisha = env.PLATFORM_FEE_POISHA;
  const totalPoisha = consultationPoisha + platformFeePoisha;

  return {
    consultationPoisha,
    platformFeePoisha,
    totalPoisha,
    dueAtHospitalPoisha: method === 'at_hospital' ? totalPoisha : 0,
  };
}

/** Who is booking. Exactly one of these, never both (`bookings_one_booker`). */
export type Booker =
  | { readonly kind: 'user'; readonly userId: string; readonly patientId: string }
  | {
      readonly kind: 'guest';
      readonly phone: string;
      readonly name: string;
      readonly ageYears: number;
      readonly sex: 'male' | 'female' | 'other';
    };

export interface CreateBookingInput {
  readonly sessionId: string;
  readonly booker: Booker;
  readonly method: PaymentMethod;
  readonly reason?: string | null;
  readonly intake?: Record<string, unknown> | undefined;
  /** Replay safety for the confirm button (`FR-QUE-51`). */
  readonly clientEventId?: string | null;
}

export interface BookingResult {
  readonly bookingId: string;
  readonly serial: number;
  readonly sessionId: string;
  readonly fee: FeeBreakdown;
  /**
   * The guest's tracking link (`FR-GST-05`), or null for an account holder.
   *
   * Returned once, here, and never again: only the hash is stored, so this is
   * the sole moment the token exists outside the SMS it goes into.
   */
  readonly trackingUrl: string | null;
  readonly paid: boolean;
}

/**
 * `POST /bookings`.
 *
 * Ordered so that nothing irreversible happens before every rule has been
 * checked: capacity and the double-booking rule are settled inside the lock,
 * and the tracking link is minted only once the row exists.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  const session = await queueService.requireSession(input.sessionId);

  if (session.status === 'ended' || session.status === 'cancelled') {
    throw new AppError('QUEUE_GUARD_FAILED', {
      message: 'This chamber is no longer taking bookings.',
      details: { guard: 'SESSION_CLOSED' },
    });
  }

  const fee = feeFor(session.feePoisha, input.method);

  const created = await withTransaction(async (trx) => {
    // The lock the serial is allocated under. Everything below reads a queue
    // that cannot move while this transaction holds it.
    const locked = await sessionRepo.lockForUpdate(trx, input.sessionId);
    if (locked === null) throw notFound('session');

    const patientId = await resolvePatient(trx, input.booker);

    // `FR-PAT-24`: never the same profile with the same doctor on the same
    // day. The database enforces the same-session half as a unique index; the
    // other half spans two chambers — a morning and an evening — and can only
    // be checked here, against the doctor and the date.
    const duplicate = await bookingRepo.findSameDoctorSameDay(trx, {
      patientId,
      doctorId: locked.doctorId,
      sessionDate: locked.sessionDate,
    });

    if (duplicate !== null) {
      throw new AppError('BOOKING_DUPLICATE', {
        details: { bookingId: duplicate.id, serial: duplicate.serial },
      });
    }

    const roster = await bookingRepo.rosterFor(input.sessionId, trx);
    const live = roster.length;

    if (locked.capacity !== null && live >= locked.capacity) {
      throw new AppError('SESSION_FULL', {
        details: { capacity: locked.capacity, taken: live },
      });
    }

    const serial = roster.reduce((max, booking) => Math.max(max, booking.serial), 0) + 1;

    // Resolved once and carried out, because the payment needs the same
    // identity the booking was made with — a `guest_identities` row, which is
    // what `payments_one_payer` references and is not the `patients` row.
    const bookedByGuestId =
      input.booker.kind === 'guest' ? await guestIdFor(trx, input.booker) : null;

    const bookingId = await bookingRepo.insertBooking(trx, {
      sessionId: input.sessionId,
      patientId,
      serial,
      source: input.booker.kind === 'guest' ? 'guest_link' : 'app',
      feePoisha: session.feePoisha,
      bookedByUserId: input.booker.kind === 'user' ? input.booker.userId : null,
      bookedByGuestId,
      reasonText: input.reason ?? null,
      intake: { ...(input.intake ?? {}), demo: true },
    });

    const payer: payments.Payer =
      input.booker.kind === 'user'
        ? { kind: 'user', userId: input.booker.userId }
        : { kind: 'guest', guestId: bookedByGuestId ?? '' };

    return { bookingId, serial, patientId, payer };
  });

  // Outside the transaction: the link is derived from the row, and minting it
  // is not something to hold a session lock for.
  const trackingUrl =
    input.booker.kind === 'guest'
      ? await issueTrackingLink(created.bookingId, input.sessionId, input.booker.phone)
      : null;

  // The console's queue gains a row. `FR-QUE-52`: a booking made while a
  // console was offline arrives in its next seed rather than being dropped, so
  // this broadcast is what makes it arrive *now* for the ones that are online.
  await queueService.broadcastRoster(input.sessionId);

  // `FR-PAT-22`: confirmation in the app *and* by SMS, carrying hospital,
  // doctor, date, serial and the expected window.
  //
  // Queued after the booking transaction rather than inside it, unlike every
  // queue event. The reason is the tracking link: it is derived from a row
  // that has to exist first, and only its hash is stored (`FR-GST-05`), so
  // this is the one moment the message can be composed at all. There is
  // nothing to roll back by then — the booking is committed and the patient
  // has their serial.
  await queueBookingConfirmation(created.bookingId, input.sessionId, trackingUrl);

  // The money, recorded (step 18). Outside the booking transaction and after
  // the confirmation, deliberately: a patient who has a serial must not lose
  // it because a payment gateway was slow, and a booking that rolled back
  // over a charge would send them round to take a second one. So the booking
  // is the commitment and the payment is recorded against it — which is also
  // the order a settlement reads them in (`FR-PAY-05`).
  const paid = await recordBookingPayment(created, input);

  return {
    bookingId: created.bookingId,
    serial: created.serial,
    sessionId: input.sessionId,
    fee,
    trackingUrl,
    paid,
  };
}

/**
 * Writes the `payments` row a booking produced (`FR-PAY-01`, `FR-PAY-06`).
 *
 * Never throws. A failure here leaves a booking with no payment row, which is
 * recoverable — the patient holds a serial, the hospital can take the money at
 * the counter, and a settlement counts the booking with nothing against it.
 * Throwing would lose the serial instead, which is not.
 *
 * `at_hospital` records the intention and stays `pending` until somebody takes
 * the cash; everything else is charged through the provider, which under
 * `PAYMENT_PROVIDER=mock` settles inline (CLAUDE.md §1.1).
 */
async function recordBookingPayment(
  created: { readonly bookingId: string; readonly payer: payments.Payer },
  input: CreateBookingInput,
): Promise<boolean> {
  try {
    const result = await payments.createIntent(
      {
        bookingId: created.bookingId,
        method: input.method,
        // The booking's own client event id where there is one, so a retried
        // confirm makes one payment and not two (`FR-PAY-06`, `FR-QUE-51`).
        idempotencyKey: input.clientEventId ?? randomUUID(),
        returnUrl: `${env.WEB_BASE_URL}/s/${created.bookingId}`,
      },
      created.payer,
    );
    return result.payment.state === 'paid';
  } catch (cause: unknown) {
    // The booking id, never the payer (`DB-P7`).
    logger.error({ bookingId: created.bookingId, err: cause }, 'could not record the payment');
    return false;
  }
}

/**
 * Writes and sends the confirmation.
 *
 * Failure here is logged and swallowed. A patient who has a serial and did not
 * get a text is worse off than one who got both, but a booking that *reports*
 * failure because an SMS gateway was down would have them book again and take
 * a second serial — which is the worse outcome by some distance.
 */
async function queueBookingConfirmation(
  bookingId: string,
  sessionId: string,
  trackingUrl: string | null,
): Promise<void> {
  try {
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          sessionId,
          notifications.planBookingConfirmed(bookingId, trackingUrl),
        ),
    );
    await notifications.dispatch(batch);
  } catch (error: unknown) {
    logger.error({ err: error, sessionId }, 'booking confirmation could not be queued');
  }
}

/**
 * The patient this booking is for.
 *
 * An account holder names a profile they already own. A guest is identified by
 * phone — `FR-GST-12` means a second booking from the same number reuses the
 * identity rather than asking again — and a patient record is created against
 * it, because every booking attaches to a patient and never to an account
 * (`FR-PAT-03`).
 */
async function resolvePatient(trx: Tx, booker: Booker): Promise<string> {
  if (booker.kind === 'user') {
    const owned = await bookingRepo.patientBelongsTo(trx, booker.patientId, booker.userId);
    if (!owned) throw validationFailed({ field: 'patientId', reason: 'not_yours' });
    return booker.patientId;
  }

  const guestId = await guestIdFor(trx, booker);
  return await guestRepo.findOrCreatePatient(trx, {
    guestId,
    fullName: booker.name,
    ageYears: booker.ageYears,
    sex: booker.sex,
    phone: booker.phone,
  });
}

/** The guest identity for this phone, created on first use (`FR-GST-04`). */
async function guestIdFor(trx: Tx, booker: Extract<Booker, { kind: 'guest' }>): Promise<string> {
  return await guestRepo.findOrCreateIdentity(trx, {
    phone: booker.phone,
    displayName: booker.name,
  });
}

/**
 * Mints the guest's tracking link (`FR-GST-05`).
 *
 * "Single-booking scoped, expires after the session ends plus a grace period,
 * and is revocable."
 *
 * Only the SHA-256 of the token is stored, so a database read cannot open
 * somebody's queue — the token itself exists in the SMS and nowhere else.
 *
 * ## Why the URL carries only the opaque token
 *
 * It used to carry a signed JWT beside it, for the socket handshake to verify.
 * That was wrong twice over. An access token lives fifteen minutes
 * (`JWT_ACCESS_TTL`) while this link has to work until the chamber closes plus
 * a day, so the socket would have been refused a quarter of an hour after
 * booking — and a bearer token in an SMS sits in an inbox, and gets forwarded
 * to relatives, long after anybody needs it.
 *
 * So the durable credential is the opaque token, which is revocable by
 * deleting a row, and `GET /guest/link/:token` exchanges it for a short-lived
 * access token when the screen opens. What leaks from a forwarded SMS is then
 * something the hospital can switch off.
 */
export async function issueTrackingLink(
  bookingId: string,
  sessionId: string,
  phone: string,
): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const guestId = await guestRepo.identityIdForPhone(phone);
  if (guestId === null) throw notFound('guest identity');

  const session = await queueService.requireSession(sessionId);

  // Session end plus a day. A patient reads the SMS on the way home as often
  // as on the way in, and a link that died the moment the chamber closed would
  // be useless exactly then (DATABASE.md §8 keeps the row for 30 days).
  const expiresAt = new Date(new Date(session.plannedEnd).getTime() + 24 * 3_600_000);

  await guestRepo.insertTrackingLink({ bookingId, guestId, tokenHash, expiresAt });

  const url = new URL('/s', env.WEB_BASE_URL);
  url.searchParams.set('b', bookingId);
  url.searchParams.set('t', token);
  return url.toString();
}

// ---------------------------------------------------------------------------
// The live serial screen (`S-A-08`)
// ---------------------------------------------------------------------------

/**
 * What one patient sees: their booking, its chamber, and the queue around it.
 *
 * The queue state and the ETAs are the same values the session channel
 * broadcasts, read once so the screen has something true to paint before the
 * socket has finished its handshake (`FR-PAT-31` is two seconds from a
 * reception tap, not two seconds from opening the app).
 */
export interface BookingView {
  readonly booking: bookingRepo.BookingDetail;
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  /**
   * What was paid for this booking, if anything (`FR-PAY-03`).
   *
   * `MOD-A08-CANCEL` has to state the refund **before** the patient confirms,
   * and the refund depends on what was actually taken — a pay-at-hospital
   * booking gets nothing back because nothing was given. The screen runs
   * `refundIfCancelledNow` over this and the hospital's policy, which is the
   * same function the server refunds with, so the sentence a patient reads
   * and the amount they receive cannot disagree.
   *
   * Never carries `provider_ref` (CLAUDE.md §7).
   */
  readonly payment: {
    readonly amountPoisha: number;
    readonly platformFeePoisha: number;
    readonly refundedPoisha: number;
    readonly paidAt: string | null;
  } | null;
  /** The age of the figures on screen, for `<FreshnessLine>` (`FR-PAT-35`). */
  readonly freshAt: string;
  readonly serverTs: string;
}

/** `GET /bookings/:id` (BACKEND.md §7.3). */
export async function bookingView(bookingId: string): Promise<BookingView> {
  const booking = await bookingRepo.findDetail(bookingId);
  if (booking === null) throw notFound('booking');

  const [state, etas, cached, paid] = await Promise.all([
    queueService.getState(booking.sessionId),
    queueService.getEtas(booking.sessionId),
    queueService.getCachedState(booking.sessionId),
    payments.forBooking(bookingId),
  ]);

  // The newest payment that actually took money. A booking may hold several
  // rows — a failed attempt then a successful one — and the refund is about
  // the one that succeeded.
  const settled =
    paid.find((entry) => entry.paidAt !== null && entry.refundedPoisha < entry.amountPoisha) ??
    null;

  return {
    booking,
    state,
    etas,
    payment:
      settled === null
        ? null
        : {
            amountPoisha: settled.amountPoisha,
            platformFeePoisha: settled.platformFeePoisha,
            refundedPoisha: settled.refundedPoisha,
            paidAt: settled.paidAt,
          },
    // The cache's own timestamp, never this server's clock: a figure is as old
    // as the last event that moved it, and saying otherwise would make every
    // freshness line read "just now" forever (`FR-OFF-03`).
    freshAt: (cached?.updatedAt ?? new Date()).toISOString(),
    serverTs: new Date().toISOString(),
  };
}

/**
 * What is recorded against a cancellation nobody gave a reason for.
 *
 * `bookings.cancelled_reason` is NOT NULL for a cancelled row, and
 * `MOD-A08-CANCEL` asks the patient nothing but "are you sure" — so the reason
 * is who did it, in the same Bangla the seeded history uses. It is a category
 * the refund rule (`FR-PAY-03`) and the admin loss figure (`FR-ADM-03`) read,
 * not prose anybody typed.
 */
const CANCELLED_BY = {
  patient: 'রোগী অ্যাপে বাতিল করেছেন',
  counter: 'কাউন্টার থেকে বাতিল করা হয়েছে',
} as const;

export interface CancelBookingInput {
  readonly bookingId: string;
  readonly actor: QueueActor;
  readonly reason?: string | null;
  readonly clientEventId?: string | null;
  readonly clientTs?: string | null;
}

/**
 * `POST /bookings/:id/cancel` (`FR-PAT-23`, BACKEND.md §7.3).
 *
 * Appends `BOOKING_CANCELLED` through the queue service like every other fact
 * about a queue — there is one write path into the log and this is not an
 * exception to it (BACKEND.md §4). The serial is freed by the partial unique
 * index rather than by anything here, which is what lets it be reissued to a
 * standby patient (`FR-QUE-30`).
 *
 * Refund eligibility is not computed: `payments` is migration 0009 and step 18
 * owns the money. What exists now is the record the refund will be decided
 * from — who cancelled, when, and against which fee.
 */
export async function cancelBooking(input: CancelBookingInput): Promise<AppendEventResult> {
  // Before the state guard, not after it. A patient on a bad connection
  // re-sends the same `clientEventId`, and "already cancelled" is the right
  // answer to a second attempt but the wrong one to a retry of the first —
  // which would leave the app showing an error for a cancellation that
  // worked (`FR-QUE-51`, `SY-02`).
  const replayed = await queueService.findReplay(input.clientEventId ?? null);
  if (replayed !== null) return replayed;

  const booking = await queueService.requireBooking(input.bookingId);

  if (booking.status === 'cancelled') {
    // Not an error worth a stack trace: a patient double-tapping confirm on a
    // bad connection means it once. The current state is the honest answer.
    throw new AppError('QUEUE_GUARD_FAILED', {
      message: 'This booking is already cancelled.',
      details: { guard: 'BOOKING_ALREADY_CANCELLED' },
    });
  }

  if (booking.status === 'done') {
    throw new AppError('QUEUE_GUARD_FAILED', {
      message: 'This visit has already happened.',
      details: { guard: 'BOOKING_ALREADY_DONE' },
    });
  }

  const stated = input.reason?.trim();

  return await queueService.appendEvent({
    sessionId: booking.sessionId,
    type: 'BOOKING_CANCELLED',
    payload: {
      bookingId: booking.id,
      reason:
        stated !== undefined && stated !== ''
          ? stated
          : input.actor.kind === 'staff'
            ? CANCELLED_BY.counter
            : CANCELLED_BY.patient,
    },
    actor: input.actor,
    clientEventId: input.clientEventId ?? null,
    clientTs: input.clientTs ?? null,
  });
}

/** Branding helpers used where a row's string becomes a domain id. */
export function asBookingId(value: string): BookingId {
  return id<BookingId>(value);
}

export function asSessionId(value: string): SessionId {
  return id<SessionId>(value);
}

/** The instant a booking was made, for the confirmation copy. */
export function bookedAt(): string {
  return time.fromDate(new Date());
}
