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

import { randomUUID } from 'node:crypto';

import {
  arrivalWindowAt,
  bookingStanding,
  id,
  patientViewOf,
  prepaymentReason,
  time,
  type BookingId,
  type BookingStanding,
  type Eta,
  type QueueActor,
  type QueueState,
  type SessionId,
} from '@platform/domain';

import { availableMethods } from '../adapters/payments/index.js';
import { asQueue } from '../config/dbScope.js';
import { patientLink } from '../config/links.js';
import { logger } from '../config/logger.js';
import { ticketFor, ticketsIn } from '../config/serialTicket.js';
import { env } from '../env.js';
import { AppError, notFound, validationFailed } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as patientAuthRepo from '../repositories/patientAuth.repo.js';
import * as paymentRepo from '../repositories/payment.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as modules from './modules.service.js';
import * as notifications from './notification.service.js';
import * as payments from './payment.service.js';
import * as portals from './portal.service.js';
import * as queueService from './queue.service.js';
import { mintTrackingToken } from './trackingLink.js';

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
  /** `CHIP-A07C-WINDOW` (`FR-PAT-28`): the preferred hour's start, if one was chosen. */
  readonly arrivalWindowStart?: string | undefined;
  /**
   * The request's Idempotency-Key (`FR-QUE-51`). The same request sent again
   * — a confirm whose answer was lost on the way — is answered with the
   * booking it already made, and makes nothing new: no second serial, no
   * second message, no second charge.
   */
  readonly clientEventId?: string | null;
}

/** What a booking's own payment looks like to the patient who made it. */
export interface BookingPayment {
  readonly id: string;
  readonly method: string;
  readonly state: string;
  readonly redirectUrl: string | null;
  readonly holdUntil: string | null;
  /** What happens to the serial if the hold runs out (`FR-PAY-08`), said before it does. */
  readonly afterHold: 'counter' | 'released';
}

export interface BookingResult {
  readonly bookingId: string;
  readonly serial: number;
  readonly sessionId: string;
  readonly fee: FeeBreakdown;
  /**
   * The link to this booking's live screen (`FR-GST-05`): a guest's, and
   * since plan F1 an account holder's too.
   *
   * Only its hash is stored, so this answer and the SMS are the two places
   * the token exists. An account holder who needs it again, on another
   * phone, asks for a new one (`POST /me/bookings/:id/link`).
   */
  readonly trackingUrl: string | null;
  readonly paid: boolean;
  /**
   * The payment this booking started (plan H3): where the patient goes to pay
   * and until when the serial is held for it, or null when none was written.
   */
  readonly payment: BookingPayment | null;
  /** True when this request had already made the booking and is being answered again. */
  readonly duplicate: boolean;
}

/**
 * `POST /bookings`.
 *
 * Ordered so that nothing irreversible happens before every rule has been
 * checked: capacity and the double-booking rule are settled inside the lock,
 * and the tracking link is minted only once the row exists.
 */
export async function createBooking(input: CreateBookingInput): Promise<BookingResult> {
  return await asQueue(async () => {
    const session = await queueService.requireSession(input.sessionId);
    // A hospital that does not run serials takes none (`FR-BRD-11`).
    await modules.requireOn(session.hospitalId, 'queue');

    if (session.status === 'ended' || session.status === 'cancelled') {
      throw new AppError('QUEUE_GUARD_FAILED', {
        message: 'This chamber is no longer taking bookings.',
        details: { guard: 'SESSION_CLOSED' },
      });
    }

    // `FR-ONB-06`, `FR-NET-03`: a hospital that is not live — never approved,
    // or suspended — takes no booking from the public, even at a chamber whose
    // id somebody still holds. Its own counter is a different route and is not
    // refused: the staff of a suspended hospital can still work.
    if (!(await sessionRepo.hospitalIsLive(input.sessionId))) {
      throw new AppError('QUEUE_GUARD_FAILED', {
        message: 'This hospital is not taking bookings here at the moment.',
        details: { guard: 'HOSPITAL_NOT_LIVE' },
      });
    }

    const fee = feeFor(session.feePoisha, input.method);

    const created = await withTransaction(async (trx) => {
      // The lock the serial is allocated under. Everything below reads a queue
      // that cannot move while this transaction holds it.
      const locked = await sessionRepo.lockForUpdate(trx, input.sessionId);
      if (locked === null) throw notFound('session');

      const patientId = await resolvePatient(trx, input.booker);

      // `FR-QUE-51`: the same request, sent again. Looked for under the lock,
      // so a retry that overlaps the first attempt waits for it and then finds
      // what it made. Its booking is the answer, whatever has happened since.
      const key = input.clientEventId ?? null;
      if (key !== null) {
        const made = await bookingRepo.findByIdempotencyKey(trx, key);
        if (made !== null) {
          // A key names one request. Under it, a different chamber or a
          // different patient is not a retry.
          if (made.sessionId !== input.sessionId || made.patientId !== patientId) {
            throw new AppError('IDEMPOTENCY_KEY_REUSED');
          }
          return {
            bookingId: made.id,
            serial: made.serial,
            patientId,
            payer: await payerOf(trx, input.booker),
            replayed: true,
          };
        }
      }

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

      // `FR-GST-14`: a number with no account behind it may ask for only so
      // many serials in a day. Counted here, under the lock, against the guest
      // identity the number resolves to; cancelling does not give one back.
      if (bookedByGuestId !== null) {
        const since = new Date(Date.now() - 24 * 3_600_000);
        const made = await bookingRepo.countGuestBookingsSince(trx, bookedByGuestId, since);
        if (made >= env.GUEST_BOOKINGS_PER_PHONE_PER_DAY) {
          throw new AppError('BOOKING_LIMIT_REACHED', {
            details: { limit: env.GUEST_BOOKINGS_PER_PHONE_PER_DAY, windowHours: 24 },
          });
        }
      }

      // `FR-PAY-02`, `FR-PAY-08`: whether this serial must be paid for first,
      // decided now and kept on the row. Only where an online method exists: a
      // deployment that can take no payment never turns anybody away for it.
      // Since plan F3 also `FR-GST-14`: a number with three no-shows here in
      // the hospital's window, where the hospital has turned that on.
      const rules = await paymentRepo.prepaymentRules(trx, locked.hospitalId);
      const noShows =
        bookedByGuestId !== null && rules.noShowRuleOn
          ? await bookingRepo.countNoShowsAt(trx, {
              guestId: bookedByGuestId,
              hospitalId: locked.hospitalId,
              since: dhakaDaysAgo(rules.windowDays),
            })
          : 0;
      const prepayment = prepaymentReason({
        onlinePaymentTaken: availableMethods().length > 0,
        hospitalPaysFirst: rules.paysFirst,
        guest: bookedByGuestId !== null,
        noShowRuleOn: rules.noShowRuleOn,
        noShows,
      });
      const prepaymentRequired = prepayment !== null;
      if (prepayment !== null && input.method === 'at_hospital') {
        throw new AppError('PREPAYMENT_REQUIRED', { details: { reason: prepayment } });
      }

      // `FR-PAT-28` (plan R1): a preferred hour, only where the hospital
      // offers one and only one of the chamber's own. A preference: nothing
      // after this line, and nothing in the queue, reads it.
      let arrivalWindowStart: string | null = null;
      if (input.arrivalWindowStart !== undefined) {
        const window = (await bookingRepo.offersArrivalWindows(trx, locked.hospitalId))
          ? arrivalWindowAt(
              locked.plannedStart.toISOString(),
              locked.plannedEnd.toISOString(),
              input.arrivalWindowStart,
            )
          : null;
        if (window === null) throw new AppError('ARRIVAL_WINDOW_NOT_OFFERED');
        arrivalWindowStart = window.start;
      }

      const bookingId = await bookingRepo.insertBooking(trx, {
        sessionId: input.sessionId,
        patientId,
        serial,
        source: input.booker.kind === 'guest' ? 'guest_link' : 'app',
        feePoisha: session.feePoisha,
        bookedByUserId: input.booker.kind === 'user' ? input.booker.userId : null,
        bookedByGuestId,
        reasonText: input.reason ?? null,
        // Stamped as demonstration data only where the server is one
        // (`FR-DEM-07`). It used to be stamped on every booking, a real
        // hospital's included (handover finding 26).
        intake: { ...(input.intake ?? {}), ...(env.DEMO_MODE ? { demo: true } : {}) },
        idempotencyKey: key,
        prepaymentRequired,
        arrivalWindowStart,
      });

      const payer: payments.Payer =
        input.booker.kind === 'user'
          ? { kind: 'user', userId: input.booker.userId }
          : { kind: 'guest', guestId: bookedByGuestId ?? '' };

      return { bookingId, serial, patientId, payer, replayed: false };
    });

    // Outside the transaction: the link is derived from the row, and minting it
    // is not something to hold a session lock for.
    //
    // An account holder is given one too (plan F1). The live serial screen is
    // opened by a link, on this phone and on any other, and the confirmation
    // message carries it for the person without the app in their hand
    // (`FR-PAT-22`, `FR-PAT-37`).
    const trackingUrl =
      input.booker.kind === 'guest'
        ? await issueTrackingLink(created.bookingId, input.sessionId, input.booker.phone)
        : await issueAccountLink(input.booker.userId, created.bookingId, input.sessionId);

    // Answered again, not made again. The link is minted afresh because only
    // its hash is ever stored (`FR-GST-05`): the one the first answer carried
    // cannot be read back, and the patient who never received that answer needs
    // one that works. Nobody is told twice and nothing is charged twice: the
    // payment below is keyed by the same request and finds its own row.
    if (created.replayed) {
      const payment = await recordBookingPayment(created, input);
      return {
        bookingId: created.bookingId,
        serial: created.serial,
        sessionId: input.sessionId,
        fee,
        trackingUrl,
        paid: payment?.state === 'paid',
        payment,
        duplicate: true,
      };
    }

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
    //
    // The money is recorded first (step 18; since plan H3 before the message,
    // because the message depends on it). Outside the booking transaction,
    // deliberately: a patient who has a serial must not lose it because a
    // payment gateway was slow, so the booking is the commitment and the
    // payment is recorded against it (`FR-PAY-05`). A payment still under way
    // at the provider makes the message `booking.held`, with the minutes the
    // serial is held for (`FR-PAY-08`); the confirmation follows when the
    // provider says it was paid.
    const payment = await recordBookingPayment(created, input);
    const held = payment !== null && payment.state === 'pending' && payment.holdUntil !== null;
    await queueBookingConfirmation(
      created.bookingId,
      input.sessionId,
      trackingUrl,
      held && payment.holdUntil !== null
        ? Math.max(1, Math.round((Date.parse(payment.holdUntil) - Date.now()) / 60_000))
        : null,
    );

    return {
      bookingId: created.bookingId,
      serial: created.serial,
      sessionId: input.sessionId,
      fee,
      trackingUrl,
      paid: payment?.state === 'paid',
      payment,
      duplicate: false,
    };
  });
}

/** The Dhaka calendar date a number of days ago: where a rolling window starts (`FR-GST-14`). */
function dhakaDaysAgo(days: number): string {
  return time.toDhakaDate(time.addMinutes(time.fromDate(new Date()), -days * 24 * 60));
}

/** Who pays for a booking: the account, or the guest identity behind the number. */
async function payerOf(trx: Tx, booker: Booker): Promise<payments.Payer> {
  return booker.kind === 'user'
    ? { kind: 'user', userId: booker.userId }
    : { kind: 'guest', guestId: await guestIdFor(trx, booker) };
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
 * `PAYMENT_PROVIDER=mock` settles inline (CLAUDE.md §1.1), and otherwise
 * answers where the patient goes to pay (plan H3).
 */
async function recordBookingPayment(
  created: { readonly bookingId: string; readonly payer: payments.Payer },
  input: CreateBookingInput,
): Promise<BookingPayment | null> {
  try {
    const result = await payments.createIntent(
      {
        bookingId: created.bookingId,
        method: input.method,
        // The booking's own client event id where there is one, so a retried
        // confirm makes one payment and not two (`FR-PAY-06`, `FR-QUE-51`).
        idempotencyKey: input.clientEventId ?? randomUUID(),
        // Where bKash or Nagad sends the patient back to (`S-A-07p`).
        returnTo: (paymentId) =>
          patientLink('/pay/return', { payment: paymentId, booking: created.bookingId }),
      },
      created.payer,
    );
    const detail = await bookingRepo.findDetail(created.bookingId);
    return {
      id: result.payment.id,
      method: result.payment.method,
      state: result.payment.state,
      redirectUrl: result.redirectUrl,
      holdUntil: result.payment.holdUntil,
      afterHold: detail?.prepaymentRequired === true ? 'released' : 'counter',
    };
  } catch (cause: unknown) {
    // The booking id, never the payer (`DB-P7`).
    logger.error({ bookingId: created.bookingId, err: cause }, 'could not record the payment');
    return null;
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
  /** Minutes the serial is held for its payment, or null when it is not held. */
  heldMinutes: number | null = null,
): Promise<void> {
  try {
    const batch = await withTransaction(
      async (trx) =>
        await notifications.queueFor(
          trx,
          sessionId,
          notifications.planBookingConfirmed(bookingId, trackingUrl, heldMinutes),
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
 * The token is minted in `trackingLink.ts`, which the notification sender
 * also asks when it sends a confirmation from the stored row (plan H1).
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
  const { token, hospitalId } = await mintTrackingToken({ bookingId, sessionId, phone });

  // Inside a portal the link is that portal's (`config/links.ts`). Issued by a
  // counter or a worker, it goes to the hospital's own domain if it has one.
  return patientLink(
    '/s',
    { b: bookingId, t: token },
    { hospitalOrigin: await portals.hospitalLinkOrigin(hospitalId) },
  );
}

/**
 * A link for an account holder's own booking (plan F1).
 *
 * A link is issued to the identity behind a phone number (`guest_links`), and
 * an account is a phone number that has been proved (`FR-PAT-01`), so the
 * link goes to that number's identity, made here if the number never booked
 * as a guest. It opens the one booking and nothing else of the account, like
 * any link (`FR-GST-05`).
 */
async function issueAccountLink(
  userId: string,
  bookingId: string,
  sessionId: string,
): Promise<string> {
  const user = await patientAuthRepo.userById(userId);
  if (user === null) throw notFound('account');
  const booking = await bookingRepo.findDetail(bookingId);
  if (booking === null) throw notFound('booking');

  await withTransaction(async (trx) => {
    await guestRepo.findOrCreateIdentity(trx, {
      phone: user.phone,
      displayName: booking.patientName,
    });
  });
  return await issueTrackingLink(bookingId, sessionId, user.phone);
}

// ---------------------------------------------------------------------------
// An account's own serials (`S-A-09`, plan F1)
// ---------------------------------------------------------------------------

/** One of an account's bookings, with where it stands. */
export interface MyBooking extends bookingRepo.AccountBooking {
  /**
   * Current or past, by the session's state and the booking's own and never
   * by the date (`FR-PAT-39`): the same function the phone used to work out
   * for itself, one tracking link at a time.
   */
  readonly standing: BookingStanding;
}

/**
 * `GET /me/bookings`: the serials of every profile the account owns, on
 * whichever phone it is signed in.
 *
 * Read from the rows, which hold what the reducer last produced
 * (`saveProjections`), so nothing is replayed to draw a list. `serverTs` is
 * what the screen's freshness line is measured from (`FR-PAT-35`).
 */
export async function myBookings(
  userId: string,
): Promise<{ readonly bookings: readonly MyBooking[]; readonly serverTs: string }> {
  const rows = await bookingRepo.listForAccount(userId);
  return {
    bookings: rows.map((row) => ({
      ...row,
      standing: bookingStanding(row.sessionStatus, row.status),
    })),
    serverTs: new Date().toISOString(),
  };
}

/** How long after its chamber's planned end a link still opens (`issueTrackingLink`). */
const LINK_GRACE_MS = 24 * 3_600_000;

/**
 * `POST /me/bookings/:id/link`: a link to the live screen of one of the
 * account's own bookings, for a phone that does not hold one.
 *
 * A booking that is not for one of the account's profiles does not exist for
 * it. One whose chamber closed more than a day ago has no live screen to
 * open, and is answered as a link that has run out is. Only a few links per
 * booking stay live (`MAX_LIVE_LINKS_PER_BOOKING`); the phone keeps the one
 * it is given and does not ask again.
 */
export async function linkForMyBooking(
  userId: string,
  bookingId: string,
): Promise<{ readonly url: string }> {
  const owned = await bookingRepo.ownedByAccount(bookingId, userId);
  if (owned === null) throw notFound('booking');
  if (owned.plannedEnd.getTime() + LINK_GRACE_MS <= Date.now()) {
    throw new AppError('GUEST_LINK_EXPIRED');
  }
  return { url: await issueAccountLink(userId, bookingId, owned.sessionId) };
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
  /**
   * The patients' copy of the queue for anybody but staff (plan I2c,
   * `shared/domain` `queue/patientView`): no booking or patient is named
   * in it, and each row carries a ticket in place of its booking.
   */
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  /**
   * What stands for this booking in `state`: its ticket in the patients'
   * copy, its own id in the staff's. The screen finds its row by this.
   */
  readonly ticket: string;
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

/** Who a booking's view is for: a member of staff is shown the queue as reception holds it. */
export type ViewAudience = 'staff' | 'patient';

/** `GET /bookings/:id` (BACKEND.md §7.3). */
export async function bookingView(bookingId: string, audience: ViewAudience): Promise<BookingView> {
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

  const seen =
    audience === 'staff'
      ? { state, etas, ticket: booking.id }
      : {
          ...patientViewOf(state, etas, ticketsIn(booking.sessionId)),
          ticket: ticketFor(booking.sessionId, booking.id),
        };

  return {
    booking,
    ...seen,
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
