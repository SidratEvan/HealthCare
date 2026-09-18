/**
 * The SMS tracking link (FR-GST-05).
 *
 * "Every guest booking produces a secure tracking link delivered by SMS.
 * Opening that link shows the live serial screen for that booking with no
 * login. The link is single-booking scoped, expires after the session ends
 * plus a grace period, and is revocable."
 *
 * This is the most exposed credential in the product. It arrives as a URL in a
 * text message, gets forwarded to relatives over WhatsApp, and sits in an SMS
 * inbox indefinitely — so it is scoped as narrowly as a credential can be: one
 * booking, read-only plus that booking's own actions, and expiring.
 *
 * Guest mode is a first-class path, not a downgrade (FR-GST-01). A guest with
 * a valid link can do everything an account holder can for that booking,
 * including declaring lateness and cancelling.
 */

import { verifyToken } from '../config/jwt.js';
import { AppError, authRequired, forbiddenScope, tokenInvalid } from '../errors/AppError.js';

import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Where a tracking-link token may arrive.
 *
 * The header is what the app sends. The query parameter exists because the
 * link itself is a URL a person taps in an SMS, and the first request is a
 * page load that cannot set a header.
 */
const HEADER = 'x-guest-token';
const QUERY_PARAM = 'token';

/**
 * Attaches a guest principal from a tracking-link token, if one is present.
 *
 * An expired link gets `GUEST_LINK_EXPIRED` (410) rather than a generic 401,
 * because the two mean different things to the person holding it: one says
 * "log in", the other says "this link has done its job, the session is over".
 */
export async function attachGuestFromLink(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readToken(req);
  if (token === null) {
    next();
    return;
  }

  const result = await verifyToken(token, 'guest');
  if (!result.ok) {
    next(
      result.reason === 'expired'
        ? new AppError('GUEST_LINK_EXPIRED')
        : tokenInvalid(`guest_link_${result.reason}`),
    );
    return;
  }

  const { sub, bookingId } = result.claims;
  if (typeof bookingId !== 'string' || bookingId === '') {
    // A guest token with no booking is a booking-flow token, not a tracking
    // link. It has no business authorising a read of a booking.
    next(tokenInvalid('guest_link_missing_booking_scope'));
    return;
  }

  // A principal already attached by `attachPrincipal` wins: a logged-in
  // patient who happens to open a forwarded link is still themselves.
  req.principal ??= { kind: 'guest', id: sub, bookingId };
  next();
}

/**
 * Requires that the caller may act on the booking this route is about.
 *
 * A tracking link is scoped to one booking, so a link for booking A must not
 * read booking B — which would otherwise turn one forwarded SMS into a way to
 * enumerate a hospital's queue.
 *
 * An account holder passes this guard; whether the booking is actually theirs
 * is an ownership question the service answers against the database, because
 * only the database knows which profiles an account owns (FR-PAT-03).
 */
export function requireBookingScope(param = 'bookingId'): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (principal === undefined) {
      next(authRequired());
      return;
    }

    if (principal.kind !== 'guest') {
      next();
      return;
    }

    const target = req.params[param];
    if (typeof target !== 'string' || target === '') {
      next(forbiddenScope({ reason: 'missing_booking_parameter', param }));
      return;
    }

    if (principal.bookingId === null) {
      next(forbiddenScope({ reason: 'guest_token_not_scoped_to_a_booking' }));
      return;
    }

    if (principal.bookingId !== target) {
      next(forbiddenScope({ reason: 'link_is_for_a_different_booking' }));
      return;
    }

    next();
  };
}

function readToken(req: Request): string | null {
  const header = req.get(HEADER);
  if (typeof header === 'string' && header !== '') return header;

  const query = req.query[QUERY_PARAM];
  if (typeof query === 'string' && query !== '') return query;

  return null;
}
