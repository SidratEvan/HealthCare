/**
 * Booking controllers (BACKEND.md §3, §7.3).
 *
 * The one decision made here is *who is booking*, because that depends on the
 * principal the middleware attached rather than on anything in the body. A
 * request that carries a guest block while authenticated as an account holder
 * is refused rather than guessed at: booking somebody into a queue under the
 * wrong identity is not a thing to resolve by preference order.
 */

import { createBookingBody } from '@platform/domain';

import { validationFailed } from '../errors/AppError.js';
import * as booking from '../services/booking.service.js';

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
