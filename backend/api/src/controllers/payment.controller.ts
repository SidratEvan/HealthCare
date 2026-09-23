/**
 * Payment endpoints (BACKEND.md §7.7, `FR-PAY-*`).
 *
 * Thin by rule: read what the route validated, name the actor, call
 * `payment.service`, shape the response.
 */

import type { PaymentIntentBody, RefundBody, SettlementQuery } from '@platform/domain';

import { env } from '../env.js';
import { forbiddenScope, notFound, validationFailed } from '../errors/AppError.js';
import * as payments from '../services/payment.service.js';

import type { Payer } from '../services/payment.service.js';
import type { Request, Response } from 'express';

/** `POST /payments/intent` (`FR-PAY-06`). */
export async function intent(req: Request, res: Response): Promise<void> {
  const body = req.body as PaymentIntentBody;

  // Only a booking is chargeable in this version — see `payment.service`.
  if (body.bookingId === undefined) {
    throw validationFailed({
      field: 'bookingId',
      reason: 'only a booking can be paid for in this version',
    });
  }

  // A tracking link pays for its own booking and no other. `requireBookingScope`
  // cannot do this: BACKEND.md §7.7 puts the booking in the *body* and that
  // middleware reads the path. Without the check, a forwarded SMS would be a
  // way to attach one guest's payment to another patient's serial.
  const principal = req.principal;
  if (principal?.kind === 'guest' && principal.bookingId !== body.bookingId) {
    throw forbiddenScope({ reason: 'link_is_for_a_different_booking' });
  }

  const result = await payments.createIntent(
    {
      bookingId: body.bookingId,
      method: body.method,
      idempotencyKey: body.idempotencyKey,
      // Where a real provider sends the patient back to. The app's own
      // serial screen, because that is where they were going anyway.
      returnUrl: `${env.WEB_BASE_URL}/s/${body.bookingId}`,
    },
    payerOf(req),
  );

  res.status(result.duplicate ? 200 : 201).json({ ok: true, data: result });
}

/** `POST /payments/:id/refund` — an administrator returns money. */
export async function refund(req: Request, res: Response): Promise<void> {
  const body = req.body as RefundBody;
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });

  res.json({
    ok: true,
    data: await payments.refund(
      {
        paymentId: param(req),
        reason: body.reason,
        note: body.note,
        idempotencyKey: body.idempotencyKey,
      },
      { hospitalId: principal.hospitalId },
    ),
  });
}

/** `GET /bookings/:id/payments` — what was charged against one booking. */
export async function forBooking(req: Request, res: Response): Promise<void> {
  res.json({ ok: true, data: { payments: await payments.forBooking(param(req)) } });
}

/** `GET /hospitals/:hospitalId/settlement?from=&to=` (`FR-PAY-05`). */
export async function settlement(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as SettlementQuery;
  const principal = req.principal;
  if (principal?.kind !== 'staff') throw forbiddenScope({ reason: 'staff_only' });

  const hospitalId = req.params['hospitalId'];
  if (typeof hospitalId !== 'string' || hospitalId === '') throw notFound('route parameter');

  res.json({
    ok: true,
    data: await payments.settlement(
      { hospitalId, from: query.from, to: query.to },
      { hospitalId: principal.hospitalId },
    ),
  });
}

function param(req: Request): string {
  const value = req.params['id'];
  if (typeof value !== 'string' || value === '') throw notFound('route parameter');
  return value;
}

/**
 * Who is paying.
 *
 * A guest pays as often as an account holder does (`FR-GST-01`). The check
 * that their link is for *this* booking is above, in `intent`, because that
 * is where both halves of the comparison are.
 */
function payerOf(req: Request): Payer {
  const principal = req.principal;
  if (principal?.kind === 'guest') return { kind: 'guest', guestId: principal.id };
  if (principal?.kind === 'patient') return { kind: 'user', userId: principal.id };
  throw forbiddenScope({ reason: 'patient_or_guest_only' });
}
