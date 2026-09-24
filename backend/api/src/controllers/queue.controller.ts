/**
 * Queue endpoints (BACKEND.md §7.4).
 *
 * Thin by rule: parse what the route validated, decide who the actor is, call
 * the service, shape the response. No SQL, no events, no broadcasts — a
 * controller that reached for any of those would be a second write path into
 * the log, and the whole argument of `queue.service` is that there is one.
 *
 * `POST /sessions/:id/next` is the only handler here with more than one line
 * of thought in it, and even that is only because "next" is two facts — one
 * patient finished, one patient called — that must be decided from a single
 * reading of the state.
 */

import { time } from '@platform/domain';
import type { QueueActor } from '@platform/domain';

import { AppError, forbiddenScope, notFound } from '../errors/AppError.js';
import * as queueService from '../services/queue.service.js';

import type {
  AppendEventResult,
  SessionSummary,
  BookingSummary,
} from '../services/queue.service.js';
import type { Principal } from '../types/express.js';
import type { Request, Response } from 'express';

/**
 * How long after an event it may still be undone (`GR-02`, BACKEND.md §7.4).
 *
 * Ten seconds is the window in which a receptionist realises she tapped the
 * wrong row. Past it, the patient has been called into the chamber and undoing
 * the record would be rewriting what happened rather than correcting a slip.
 */
const UNDO_WINDOW_MS = 10_000;

/** `GET /sessions/:id/queue` */
export async function getQueue(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);

  const [state, etas, bookings, cached] = await Promise.all([
    queueService.getState(sessionId),
    queueService.getEtas(sessionId),
    queueService.listBookings(sessionId),
    queueService.getCachedState(sessionId),
  ]);

  res.json({
    ok: true,
    data: {
      state,
      etas,
      bookings,
      // Every live figure carries its age (`FR-OFF-03`, CLAUDE.md §11.7). The
      // client renders <FreshnessLine> from this and never from its own clock.
      freshAt: (cached?.updatedAt ?? new Date()).toISOString(),
      serverTs: new Date().toISOString(),
    },
  });
}

/** `POST /sessions/:id/arrived` — the doctor is in the chamber (`FR-REC-02`). */
export async function declareArrived(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  const session = await assertSessionScope(req, sessionId);

  const arrivedAt = time.fromDate(new Date());
  const minutesLate = time.differenceInMinutes(arrivedAt, time.fromDate(session.plannedStart));

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'DOCTOR_ARRIVED',
      // Stamped here, not sent: the punctuality figure an administrator sees
      // (`FR-ADM-05`) must not be something a console can round in its favour.
      payload: { arrivedAt, minutesLate },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/delay` (`FR-REC-03`). */
export async function declareDelay(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);
  const body = req.body as { minutes: number; reason: string | null; declaredBy: string };

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'DELAY_DECLARED',
      payload: { minutes: body.minutes, reason: body.reason, declaredBy: body.declaredBy },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/pause` (`FR-REC-05`). */
export async function pauseSession(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);
  const body = req.body as { reason: string | null };

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'SESSION_PAUSED',
      payload: { reason: body.reason },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/resume` */
export async function resumeSession(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'SESSION_RESUMED',
      payload: {},
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/end` (`FR-REC-06`). */
export async function endSession(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);
  const body = req.body as { reason: string | null };

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'SESSION_ENDED',
      payload: { reason: body.reason },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/**
 * `POST /sessions/:id/next` — the most-used control in the product.
 *
 * Both facts — one consultation ended, one patient called — are decided by the
 * service inside the session lock. A controller that worked out who was next
 * and then asked for it would be making that decision outside the lock, and
 * two counters tapping at once would pick the same patient (`FR-QUE-53`).
 */
export async function callNext(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);

  send(
    res,
    await queueService.callNext({
      sessionId,
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /bookings/:id/done` */
export async function markDone(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);
  const state = await queueService.getState(sessionId);
  const entry = state.entries.find((candidate) => candidate.bookingId === booking.id);
  const calledAt = entry?.calledAt ?? null;

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PATIENT_DONE',
      payload: {
        bookingId: booking.id,
        consultSeconds:
          calledAt === null
            ? 0
            : Math.max(0, time.differenceInSeconds(time.fromDate(new Date()), calledAt)),
      },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/**
 * `POST /bookings/:id/late` (`FR-QUE-21`, `FR-PAT-33`).
 *
 * Reachable by the receptionist at the counter and by the patient in the app.
 * The actor distinguishes them, which is why `actorOf` reads the principal
 * rather than assuming staff: an audit trail that cannot say whether a patient
 * or a counter moved the queue is not an audit trail (`FR-QUE-04`).
 */
export async function markLate(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);
  const body = req.body as { expectedMinutes: number };

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PATIENT_LATE',
      payload: {
        bookingId: booking.id,
        expectedMinutes: body.expectedMinutes,
        // The hospital's configured k (`FR-QUE-21`). Per-facility settings land
        // with the hospital service; the documented default holds until then.
        reinsertAfter: 3,
      },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /bookings/:id/no-show` (`FR-QUE-20`). */
export async function markNoShow(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);
  const state = await queueService.getState(sessionId);
  const entry = state.entries.find((candidate) => candidate.bookingId === booking.id);

  const graceUsedMinutes =
    entry?.late === null || entry?.late === undefined
      ? 0
      : time.differenceInMinutes(time.fromDate(new Date()), entry.late.declaredAt);

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PATIENT_NO_SHOW',
      payload: { bookingId: booking.id, graceUsedMinutes },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/**
 * `POST /bookings/:id/check-in` — the patient is at the counter, and has been
 * told roughly how long they will wait (`FR-REC-18`, `BTN-B02-CHECKIN`).
 *
 * The quote comes from the console because reception may have changed the
 * pre-filled figure; the arrival time is the event's own `serverTs`.
 */
export async function checkIn(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);
  const body = req.body as { readonly quotedWaitMinutes: number };

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PATIENT_ARRIVED',
      payload: { bookingId: booking.id, quotedWaitMinutes: body.quotedWaitMinutes },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /bookings/:id/reinstate` — a late patient turned up (`FR-QUE-21`). */
export async function reinstate(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);
  const state = await queueService.getState(sessionId);

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PATIENT_REINSERTED',
      payload: {
        bookingId: booking.id,
        // Back into the line behind the people who waited, not at the front.
        newPosition: state.entries.filter((entry) => entry.status === 'in_chamber').length + 1,
      },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/walkin` (`FR-REC-13`, `FR-REC-14`). */
export async function addWalkin(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  const session = await assertSessionScope(req, sessionId);
  const body = req.body as {
    patientId: string;
    position: 'end' | 'index';
    index: number | null;
    reason: string | null;
  };

  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });

  const bookingId = await queueService.createWalkinBooking({
    sessionId,
    patientId: body.patientId,
    feePoisha: session.feePoisha,
    staffUserId: principal.id,
  });

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'WALKIN_ADDED',
      payload: {
        bookingId,
        position: body.position,
        index: body.index,
        reason: body.reason,
      },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /sessions/:id/reorder` — priority, with a mandatory reason (`FR-REC-15`). */
export async function reorder(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);
  const body = req.body as { bookingId: string; toIndex: number; reason: string };

  const state = await queueService.getState(sessionId);
  const fromIndex = state.entries.findIndex((entry) => entry.bookingId === body.bookingId);
  if (fromIndex === -1) throw notFound('booking');

  send(
    res,
    await queueService.appendEvent({
      sessionId,
      type: 'PRIORITY_REORDERED',
      payload: {
        bookingId: body.bookingId,
        fromIndex,
        toIndex: body.toIndex,
        reason: body.reason,
      },
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/**
 * `POST /events/:id/undo` (`GR-02`).
 *
 * Only the person who did it, and only within ten seconds. Undo appends a
 * compensating `ACTION_UNDONE`; nothing is deleted, and the original event
 * stays in the log with a pointer to what cancelled it.
 */
export async function undo(req: Request, res: Response): Promise<void> {
  const eventId = param(req, 'id');
  const original = await queueService.requireEvent(eventId);

  await assertSessionScope(req, original.sessionId);

  const age = Date.now() - Date.parse(original.serverTs);
  if (age > UNDO_WINDOW_MS) {
    throw new AppError('QUEUE_GUARD_FAILED', {
      message: 'That action is past the undo window.',
      details: { guard: 'UNDO_WINDOW_EXPIRED', windowMs: UNDO_WINDOW_MS },
    });
  }

  const actor = actorOf(req);
  if (!sameActor(original.actor, actor)) {
    throw forbiddenScope({ reason: 'undo_requires_original_actor' });
  }

  send(
    res,
    await queueService.appendEvent({
      sessionId: original.sessionId,
      type: 'ACTION_UNDONE',
      payload: { undoneEventId: eventId },
      actor,
      ...envelope(req),
    }),
  );
}

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

/**
 * `POST /bookings/:id/offer-slot` — hand an empty chair to the standby list
 * (`FR-QUE-30`, `FR-REC-30`, `BTN-B02-OFFER`).
 *
 * The route names the freed *booking*, not the session, because a receptionist
 * acts on the row in front of her: she has just marked serial 14 a no-show and
 * the offer is about that chair. The session comes off the booking.
 */
export async function offerSlot(req: Request, res: Response): Promise<void> {
  const { booking, sessionId } = await assertBookingScope(req);

  send(
    res,
    await queueService.offerFreedSlot({
      sessionId,
      freedBookingId: booking.id,
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/** `POST /offers/:id/accept` — the standby patient said yes (`FR-QUE-30`). */
export async function acceptOffer(req: Request, res: Response): Promise<void> {
  const offerId = param(req, 'id');
  const offer = await queueService.requireOffer(offerId);
  await assertSessionScope(req, offer.sessionId);

  send(
    res,
    await queueService.acceptSlot({
      offerId,
      actor: actorOf(req),
      ...envelope(req),
    }),
  );
}

/**
 * `GET /sessions/:id/standby` — who is waiting, and what has been offered.
 *
 * Expires anything whose window has closed before answering. Nothing runs on a
 * timer in this version, so this read *is* the sweep (`expireLapsedOffers`):
 * the console asking "what is outstanding" is exactly the moment the answer
 * needs to be current, and an offer already unacceptable by the clock should
 * not be shown as live.
 */
export async function getStandby(req: Request, res: Response): Promise<void> {
  const sessionId = param(req, 'id');
  await assertSessionScope(req, sessionId);

  await queueService.expireLapsedOffers(sessionId, actorOf(req));
  const standby = await queueService.standbyFor(sessionId);

  res.json({
    ok: true,
    data: {
      waiting: standby.waiting.map((row) => ({
        id: row.id,
        patientId: row.patientId,
        position: row.position,
        // Paid when joining (`FR-PAT-26`): offering them a chair seats them.
        prepaid: row.prepaid,
      })),
      offers: standby.offers.map((offer) => ({
        id: offer.id,
        freedBookingId: offer.freedBookingId,
        offeredToPatientId: offer.offeredToPatientId,
        offeredAt: offer.offeredAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
        acceptedAt: offer.acceptedAt?.toISOString() ?? null,
        recoveredValuePoisha: offer.recoveredValuePoisha,
      })),
      serverTs: new Date().toISOString(),
    },
  });
}

function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

/** The success envelope from BACKEND.md §7, plus the freshness stamp. */
function send(res: Response, result: AppendEventResult): void {
  res.json({
    ok: true,
    data: {
      state: result.state,
      etas: result.etas,
      seq: result.seq,
      duplicate: result.duplicate,
      serverTs: result.serverTs,
    },
  });
}

/** `clientEventId` and `clientTs` off the validated body. */
function envelope(req: Request): { clientEventId: string | null; clientTs: string | null } {
  const body = req.body as { clientEventId?: string; clientTs?: string } | undefined;
  return {
    clientEventId: body?.clientEventId ?? null,
    clientTs: body?.clientTs ?? null,
  };
}

/** Who is acting, for `FR-QUE-04`. */
export function actorOf(req: Request): QueueActor {
  const principal = req.principal;
  if (principal === undefined) return { kind: 'system', job: 'anonymous' };

  switch (principal.kind) {
    case 'staff':
      return {
        kind: 'staff',
        staffUserId: principal.id as QueueActor extends { staffUserId: infer S } ? S : never,
        // The capacity they acted in. A person holding several roles
        // (`FR-ROLE-02`) acts in the first one that permitted the route.
        role: principal.roles[0] ?? 'receptionist',
      };
    case 'patient':
      return { kind: 'patient', userId: principal.id as never };
    case 'guest':
      return { kind: 'guest', bookingId: (principal.bookingId ?? '') as never };
    case 'national':
      // Unreachable through any queue route, every one of which requires a
      // hospital role. Refused rather than attributed to nobody (`FR-QUE-04`).
      throw forbiddenScope({ reason: 'national_role', was: principal.kind });
  }
}

/** True when two actors are the same person acting in the same capacity. */
function sameActor(a: QueueActor, b: QueueActor): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'staff' && b.kind === 'staff') return a.staffUserId === b.staffUserId;
  if (a.kind === 'patient' && b.kind === 'patient') return a.userId === b.userId;
  if (a.kind === 'guest' && b.kind === 'guest') return a.bookingId === b.bookingId;
  // A system event has no person behind it, so nobody can claim to be it.
  return false;
}

/**
 * Confirms the caller may act on this session, and returns it.
 *
 * Staff must belong to the hospital running it (`FR-ROLE-01`). Patients and
 * guests reach the queue only through their own booking, which is checked by
 * `assertBookingScope` — a patient has no route here that is not about a
 * booking they hold.
 */
async function assertSessionScope(req: Request, sessionId: string): Promise<SessionSummary> {
  const session = await queueService.requireSession(sessionId);

  const principal = req.principal;
  if (principal === undefined) throw forbiddenScope({ reason: 'no_principal' });

  if (principal.kind === 'staff' && principal.hospitalId !== session.hospitalId) {
    throw forbiddenScope({ reason: 'wrong_hospital' });
  }

  return session;
}

/**
 * The booking a `/bookings/:id/...` route is about, scope-checked.
 *
 * Exported because `booking.controller` asks the same question of the same
 * route parameter (`GET /bookings/:id`, `POST /bookings/:id/cancel`), and two
 * copies of an ownership rule is one copy that will eventually be the laxer.
 */
export async function assertBookingScope(
  req: Request,
): Promise<{ booking: BookingSummary; sessionId: string }> {
  const bookingId = param(req, 'id');
  const booking = await queueService.requireBooking(bookingId);

  const session = await assertSessionScope(req, booking.sessionId);

  // A patient or a guest may only act on their own booking (`FR-PAT-33`).
  const principal = req.principal;
  if (principal !== undefined && principal.kind !== 'staff') {
    const owner = await queueService.bookingOwner(bookingId);
    if (owner === null || !ownsBooking(principal, owner, bookingId)) {
      throw forbiddenScope({ reason: 'not_your_booking' });
    }
  }

  return { booking, sessionId: session.id };
}

function ownsBooking(
  principal: Principal,
  owner: { userId: string | null; guestId: string | null },
  bookingId: string,
): boolean {
  if (principal.kind === 'patient') return owner.userId === principal.id;
  if (principal.kind === 'guest') {
    // A tracking link names exactly one booking (`FR-GST-05`).
    return principal.bookingId === bookingId || owner.guestId === principal.id;
  }
  return false;
}
