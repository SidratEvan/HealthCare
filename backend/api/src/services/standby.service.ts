/**
 * The patient's half of the standby list (`FR-PAT-25`, `FR-PAT-26`,
 * `FR-PAT-27`, `FR-QUE-30`; `BTN-A06D-STANDBY`, `S-A-08s`).
 *
 * The owner's ruling on STATUS decision 62, 2026-09-23. A chamber is full; a
 * patient joins its standby list from the app. If they pay when joining they
 * are seated on sight the moment a chair frees — `queue.service.offerFreedSlot`
 * does that in the same transaction as the offer. If they do not, the offer
 * reaches their phone and they say yes or no within the window; yes makes a
 * booking they pay for as any booking is paid for, no passes the chair on.
 *
 * Reception keeps its own button for somebody who rings the counter
 * (`POST /offers/:id/accept`), which is the same seat through the same
 * function.
 *
 * ## The credential is the link
 *
 * There are no accounts in this version (`CLAUDE.md` §4.1), so a place on the
 * list is held by a signed status token — the `standby` audience on the
 * guest-link secret, scoped to one row. It is stateless, so every message can
 * carry a fresh one; they all open the same place.
 */

import { randomUUID } from 'node:crypto';

import { id, type PaymentMethod } from '@platform/domain';

import { verifyToken } from '../config/jwt.js';
import { logger } from '../config/logger.js';
import { env } from '../env.js';
import { AppError, notFound } from '../errors/AppError.js';
import * as bookingRepo from '../repositories/booking.repo.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as notificationRepo from '../repositories/notification.repo.js';
import * as paymentRepo from '../repositories/payment.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';
import * as standbyRepo from '../repositories/standby.repo.js';
import { withTransaction } from '../repositories/transaction.js';

import * as bookings from './booking.service.js';
import * as payments from './payment.service.js';
import * as queueService from './queue.service.js';
import { standbyToken, standbyUrl } from './standbyLink.js';

export interface JoinStandbyInput {
  readonly sessionId: string;
  readonly guest: {
    readonly name: string;
    readonly phone: string;
    readonly ageYears: number;
    readonly sex: 'male' | 'female' | 'other';
  };
  /** A method to pay now and be seated on sight; null to be asked. */
  readonly prepay: 'bkash' | 'nagad' | 'card' | null;
  readonly clientEventId: string | null;
}

export interface JoinStandbyResult {
  readonly standbyId: string;
  readonly position: number;
  /** True once the prepayment has actually been taken (`FR-PAT-26`). */
  readonly prepaid: boolean;
  readonly token: string;
  readonly statusUrl: string;
  readonly duplicate: boolean;
}

/**
 * `POST /sessions/:id/standby` — join the list (`BTN-A06D-STANDBY`).
 *
 * Only a full chamber has a list (`FR-PAT-25`, `APP_FLOW.md` A3): a chamber
 * with a free serial is booked, not waited for. Taken under the session lock,
 * so the position cannot be claimed twice and a chamber that frees a serial
 * in the same instant is booked rather than queued for.
 */
export async function join(input: JoinStandbyInput): Promise<JoinStandbyResult> {
  const session = await queueService.requireSession(input.sessionId);
  if (session.status === 'ended' || session.status === 'cancelled') {
    throw guardFailed('SESSION_CLOSED', 'This chamber is no longer taking anybody.');
  }

  const joined = await withTransaction(async (trx) => {
    const locked = await sessionRepo.lockForUpdate(trx, input.sessionId);
    if (locked === null) throw notFound('session');

    // A replayed tap on a bad connection: the same place, not a second one.
    if (input.clientEventId !== null) {
      const existing = await standbyRepo.findByIdempotencyKey(trx, input.clientEventId);
      if (existing !== null) return { standbyId: existing, duplicate: true };
    }

    const roster = await bookingRepo.rosterFor(input.sessionId, trx);
    if (locked.capacity === null || roster.length < locked.capacity) {
      throw guardFailed(
        'SESSION_NOT_FULL',
        'This chamber still has serials free — book one instead of waiting.',
      );
    }

    const guestId = await guestRepo.findOrCreateIdentity(trx, {
      phone: input.guest.phone,
      displayName: input.guest.name,
    });
    const patientId = await guestRepo.findOrCreatePatient(trx, {
      guestId,
      fullName: input.guest.name,
      ageYears: input.guest.ageYears,
      sex: input.guest.sex,
      phone: input.guest.phone,
    });

    // Already holding a serial here: they are not waiting for one.
    if (roster.some((booking) => booking.patientId === patientId)) {
      throw guardFailed('ALREADY_BOOKED', 'This patient already has a serial in this chamber.');
    }

    // Already on the list: the same place, answered as a replay.
    const already = await standbyRepo.activeFor(trx, input.sessionId, patientId);
    if (already !== null) return { standbyId: already.id, duplicate: true };

    const inserted = await standbyRepo.insertStandby(trx, {
      sessionId: input.sessionId,
      patientId,
      guestId,
      contactPhone: input.guest.phone,
      idempotencyKey: input.clientEventId,
    });

    return { standbyId: inserted.id, duplicate: false };
  });

  const row = await standbyRepo.findStandby(joined.standbyId);
  if (row === null) throw notFound('standby');

  // The money, after the place is held — as a booking's is. A gateway that is
  // slow or says no leaves them on the list, asked rather than seated, which
  // is the honest outcome of a payment that did not happen (`PRD.md` §3.2).
  let prepaid = row.prepaid;
  if (!prepaid && input.prepay !== null && row.guestId !== null) {
    try {
      const result = await payments.createStandbyPrepayment(
        {
          standbyId: row.id,
          amountPoisha: session.feePoisha,
          method: input.prepay,
          idempotencyKey: input.clientEventId ?? randomUUID(),
          returnUrl: `${env.WEB_BASE_URL}/standby`,
        },
        { kind: 'guest', guestId: row.guestId },
      );
      prepaid = result.payment.state === 'paid';
    } catch (cause: unknown) {
      // The row, never the payer (`DB-P7`).
      logger.warn({ standbyId: row.id, err: cause }, 'standby prepayment did not complete');
    }
  }

  const token = await standbyToken(row.id, row.guestId ?? row.patientId);
  return {
    standbyId: row.id,
    position: row.position,
    prepaid,
    token,
    statusUrl: standbyUrl(token),
    duplicate: joined.duplicate,
  };
}

export type StandbyState = 'waiting' | 'offered' | 'seated' | 'left';

export interface StandbyStatus {
  readonly standbyId: string;
  readonly sessionId: string;
  readonly state: StandbyState;
  readonly doctorNameBn: string | null;
  readonly hospitalNameBn: string | null;
  readonly plannedStart: string | null;
  readonly feePoisha: number;
  /** Their place and how many are ahead, while they are waiting. */
  readonly position: number;
  readonly ahead: number;
  readonly prepaid: boolean;
  readonly offer: { readonly id: string; readonly expiresAt: string } | null;
  readonly seated: {
    readonly bookingId: string;
    readonly serial: number;
    /**
     * The live serial link, minted the first time this is asked after the
     * seat — and only then. A second mint would replace the first and kill
     * the link already in their SMS.
     */
    readonly trackingUrl: string | null;
  } | null;
  readonly serverTs: string;
}

/** `GET /standby/:token` — `S-A-08s`, polled while the patient waits. */
export async function status(token: string): Promise<StandbyStatus> {
  const standbyId = await standbyIdFrom(token);
  let row = await requireRow(standbyId);

  // Nothing sweeps on a timer in this version, so the read is the sweep: an
  // offer whose window closed is recorded as lapsed before it is described.
  if (row.removedAt === null) {
    await queueService.expireLapsedOffers(row.sessionId, {
      kind: 'system',
      job: 'standby_status',
    });
    row = await requireRow(standbyId);
  }

  const [chamber, session] = await Promise.all([
    notificationRepo.chamberFor(row.sessionId),
    queueService.requireSession(row.sessionId),
  ]);

  const now = new Date();
  const offer =
    row.removedAt === null
      ? await standbyRepo.openOfferFor(row.sessionId, row.patientId, now)
      : null;

  let seated: StandbyStatus['seated'] = null;
  if (row.seatedBookingId !== null) {
    const booking = await bookingRepo.findById(row.seatedBookingId);
    if (booking !== null) {
      const issued = await guestRepo.hasTrackingLink(booking.id);
      seated = {
        bookingId: booking.id,
        serial: booking.serial,
        trackingUrl: issued
          ? null
          : await bookings.issueTrackingLink(booking.id, row.sessionId, row.contactPhone),
      };
    }
  }

  const state: StandbyState =
    seated !== null
      ? 'seated'
      : row.removedAt !== null
        ? 'left'
        : offer !== null
          ? 'offered'
          : 'waiting';

  return {
    standbyId: row.id,
    sessionId: row.sessionId,
    state,
    doctorNameBn: chamber?.doctorNameBn ?? null,
    hospitalNameBn: chamber?.hospitalNameBn ?? null,
    plannedStart: session.plannedStart.toISOString(),
    feePoisha: session.feePoisha,
    position: row.position,
    ahead: row.removedAt === null ? await standbyRepo.aheadOf(row.sessionId, row.position) : 0,
    prepaid: row.prepaid,
    offer: offer === null ? null : { id: offer.id, expiresAt: offer.expiresAt.toISOString() },
    seated,
    serverTs: now.toISOString(),
  };
}

export interface AcceptResult {
  readonly bookingId: string;
  readonly serial: number;
  readonly trackingUrl: string | null;
  readonly paid: boolean;
}

/**
 * `POST /standby/:token/accept` — yes to the chair on offer (`FR-PAT-27`).
 *
 * The seat is the same one reception's button gives. The payment is then the
 * booking flow's (`FR-PAT-20`): the method they chose, charged against the
 * booking they now hold, after it exists — a patient with a serial does not
 * lose it because a gateway was slow.
 */
export async function accept(
  token: string,
  input: { readonly method: PaymentMethod; readonly clientEventId: string | null },
): Promise<AcceptResult> {
  const standbyId = await standbyIdFrom(token);
  const row = await requireRow(standbyId);

  let bookingId = row.seatedBookingId;
  let serial: number | null = null;

  if (bookingId === null) {
    const offer = await standbyRepo.openOfferFor(row.sessionId, row.patientId, new Date());
    if (offer === null) {
      throw guardFailed('NO_OPEN_OFFER', 'There is no chair on offer to you right now.');
    }

    const seat = await queueService.acceptSlotDetailed({
      offerId: offer.id,
      actor: (newBookingId) => ({ kind: 'guest', bookingId: id(newBookingId) }),
      clientEventId: input.clientEventId,
    });

    bookingId = seat.newBookingId ?? (await requireRow(standbyId)).seatedBookingId;
    serial = seat.serial;
  }

  if (bookingId === null) throw notFound('booking');
  const booking = await bookingRepo.findById(bookingId);
  if (booking === null) throw notFound('booking');

  // Paid already if they prepaid — the payment moved with the seat.
  const existing = await paymentRepo.listForBooking(booking.id);
  let paid = existing.some((payment) => payment.state === 'paid');

  if (existing.length === 0 && row.guestId !== null) {
    try {
      const result = await payments.createIntent(
        {
          bookingId: booking.id,
          method: input.method,
          idempotencyKey: input.clientEventId ?? randomUUID(),
          returnUrl: `${env.WEB_BASE_URL}/s/${booking.id}`,
        },
        { kind: 'guest', guestId: row.guestId },
      );
      paid = result.payment.state === 'paid';
    } catch (cause: unknown) {
      logger.error({ bookingId: booking.id, err: cause }, 'could not record the payment');
    }
  }

  const issued = await guestRepo.hasTrackingLink(booking.id);
  return {
    bookingId: booking.id,
    serial: serial ?? booking.serial,
    trackingUrl: issued
      ? null
      : await bookings.issueTrackingLink(booking.id, row.sessionId, row.contactPhone),
    paid,
  };
}

/** `POST /standby/:token/decline` — no to this chair; it goes to the next person. */
export async function decline(token: string): Promise<void> {
  const standbyId = await standbyIdFrom(token);
  const row = await requireRow(standbyId);

  const offer = await standbyRepo.openOfferFor(row.sessionId, row.patientId, new Date());
  if (offer === null) {
    throw guardFailed('NO_OPEN_OFFER', 'There is no chair on offer to you right now.');
  }

  await queueService.declineSlot({
    offerId: offer.id,
    actor: { kind: 'system', job: 'standby_declined' },
  });
}

/**
 * `POST /standby/:token/leave` — off the list, without a chair.
 *
 * A prepayment for a chair that never came is owed back in full
 * (`standby_unseated`), marked now rather than at the end of the session. An
 * offer they were holding is declined first, so the chair goes on to the next
 * person instead of sitting on somebody who has left.
 */
export async function leave(token: string): Promise<{ readonly refundOwed: boolean }> {
  const standbyId = await standbyIdFrom(token);
  const row = await requireRow(standbyId);
  if (row.removedAt !== null) return { refundOwed: false };

  const offer = await standbyRepo.openOfferFor(row.sessionId, row.patientId, new Date());
  if (offer !== null) {
    await queueService.declineSlot({
      offerId: offer.id,
      actor: { kind: 'system', job: 'standby_left' },
    });
  }

  return await withTransaction(async (trx) => {
    const left = await standbyRepo.leave(trx, standbyId, new Date());
    if (!left) return { refundOwed: false };

    const paymentId = await paymentRepo.paidForStandby(trx, standbyId);
    if (paymentId === null) return { refundOwed: false };

    const owed = await paymentRepo.markRefundOwed(trx, {
      paymentIds: [paymentId],
      reason: 'standby_unseated',
    });
    return { refundOwed: owed > 0 };
  });
}

async function standbyIdFrom(token: string): Promise<string> {
  const verified = await verifyToken(token, 'standby');
  if (!verified.ok) {
    throw verified.reason === 'expired'
      ? new AppError('GUEST_LINK_EXPIRED')
      : new AppError('AUTH_TOKEN_INVALID', { details: { reason: verified.reason } });
  }

  const standbyId = verified.claims.standbyId;
  if (standbyId === undefined) {
    throw new AppError('AUTH_TOKEN_INVALID', { details: { reason: 'no_standby' } });
  }
  return standbyId;
}

async function requireRow(standbyId: string): Promise<standbyRepo.StandbyRecord> {
  const row = await standbyRepo.findStandby(standbyId);
  if (row === null) throw notFound('standby');
  return row;
}

function guardFailed(guard: string, message: string): AppError {
  return new AppError('QUEUE_GUARD_FAILED', { message, details: { guard } });
}
