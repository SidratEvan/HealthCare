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

import { createHash, randomBytes } from 'node:crypto';

import { id, time, type BookingId, type SessionId } from '@platform/domain';

import { signToken } from '../config/jwt.js';
import { env } from '../env.js';
import { AppError, notFound, validationFailed } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import { withTransaction, type Tx } from '../repositories/transaction.js';

import * as queueService from './queue.service.js';

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

    const bookingId = await bookingRepo.insertBooking(trx, {
      sessionId: input.sessionId,
      patientId,
      serial,
      source: input.booker.kind === 'guest' ? 'guest_link' : 'app',
      feePoisha: session.feePoisha,
      bookedByUserId: input.booker.kind === 'user' ? input.booker.userId : null,
      bookedByGuestId: input.booker.kind === 'guest' ? await guestIdFor(trx, input.booker) : null,
      reasonText: input.reason ?? null,
      intake: { ...(input.intake ?? {}), demo: true },
    });

    return { bookingId, serial, patientId };
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

  return {
    bookingId: created.bookingId,
    serial: created.serial,
    sessionId: input.sessionId,
    fee,
    trackingUrl,
    // `PAYMENT_PROVIDER=mock` always succeeds (CLAUDE.md §1.1). Nothing is
    // recorded: `payments` is migration 0009.
    paid: input.method !== 'at_hospital',
  };
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
 * somebody's queue — the token itself exists in the SMS and nowhere else. The
 * URL carries a signed JWT as well as the opaque token: the JWT is what the
 * socket handshake verifies, and the token is what makes the link revocable
 * by deleting a row.
 */
async function issueTrackingLink(
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

  const jwt = await signToken({
    kind: 'access',
    claims: { sub: guestId, kind: 'guest', bookingId },
  });

  const url = new URL('/s', env.WEB_BASE_URL);
  url.searchParams.set('b', bookingId);
  url.searchParams.set('t', token);
  url.searchParams.set('k', jwt);
  return url.toString();
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
