/**
 * Booking controllers (BACKEND.md §3, §7.3).
 *
 * The one decision made here is *who is booking*, because that depends on the
 * principal the middleware attached rather than on anything in the body. A
 * request that carries a guest block while authenticated as an account holder
 * is refused rather than guessed at: booking somebody into a queue under the
 * wrong identity is not a thing to resolve by preference order.
 */

import { cancelBookingBody, createBookingBody, idParams } from '@platform/domain';

import { validationFailed } from '../errors/AppError.js';
import * as booking from '../services/booking.service.js';

import { actorOf, assertBookingScope } from './queue.controller.js';

import type { Booker } from '../services/booking.service.js';
import type { Request, Response } from 'express';

export async function createBooking(req: Request, res: Response): Promise<void> {
  const body = createBookingBody.parse(req.body);

  const result = await booking.createBooking({
    sessionId: body.sessionId,
    booker: bookerFrom(req, body),
    method: body.method,
    reason: body.reason ?? null,
    intake: body.intake,
  });

  res.status(201).json({ ok: true, data: result });
}

/**
 * Who this booking is for.
 *
 * An authenticated patient names a profile they own; anybody else gives guest
 * details. `FR-GST-01` makes the guest path first-class, so there is no login
 * wall here — the absence of a token simply means the shorter form was used.
 */
function bookerFrom(req: Request, body: ReturnType<typeof createBookingBody.parse>): Booker {
  const principal = req.principal;

  if (principal?.kind === 'patient') {
    if (body.patientId === undefined) {
      throw validationFailed({ field: 'patientId', reason: 'required_when_signed_in' });
    }
    return { kind: 'user', userId: principal.id, patientId: body.patientId };
  }

  if (body.guest === undefined) {
    throw validationFailed({ field: 'guest', reason: 'required_without_an_account' });
  }

  return {
    kind: 'guest',
    phone: body.guest.phone,
    name: body.guest.name,
    ageYears: body.guest.ageYears,
    sex: body.guest.sex,
  };
}

/**
 * `GET /bookings/:id` — the live serial screen's first paint (`S-A-08`).
 *
 * Owner or staff. A guest holding a tracking link has already been narrowed to
 * one booking by `requireBookingScope` on the route, so what is checked here is
 * the other half: that an *account holder* asking for a booking is asking for
 * one of theirs. Without it, any signed-in patient could read any serial in the
 * country by id.
 */
export async function getBooking(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  await assertBookingScope(req);

  res.json({ ok: true, data: await booking.bookingView(id) });
}

/**
 * `POST /bookings/:id/cancel` (`FR-PAT-23`, `MOD-A08-CANCEL`).
 *
 * The same endpoint for a patient cancelling in the app and a receptionist
 * cancelling at the counter, because it is the same fact. Which of them it was
 * is recorded on the event's actor (`FR-QUE-04`) and decides the reason written
 * against the row.
 */
export async function cancelBooking(req: Request, res: Response): Promise<void> {
  const { id } = idParams.parse(req.params);
  const body = cancelBookingBody.parse(req.body);

  await assertBookingScope(req);

  const result = await booking.cancelBooking({
    bookingId: id,
    actor: actorOf(req),
    reason: body.reason,
    clientEventId: body.clientEventId ?? null,
    clientTs: body.clientTs ?? null,
  });

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
