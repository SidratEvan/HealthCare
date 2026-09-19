/**
 * The SMS tracking link, opened (`FR-GST-05`, BACKEND.md §7.1).
 *
 * "Every guest booking produces a secure tracking link delivered by SMS.
 * Opening that link shows the live serial screen for that booking with no
 * login. The link is single-booking scoped, expires after the session ends plus
 * a grace period, and is revocable."
 *
 * ## Why this exchanges a token rather than just returning data
 *
 * The link is the only credential a guest has, and it has to work for a day
 * past the chamber closing. A JWT that lived that long, in an SMS that gets
 * forwarded to relatives and then sits in an inbox, is a credential nobody can
 * take back. So the durable half is the opaque token — thirty-two random bytes
 * whose SHA-256 is all the database keeps, revocable by deleting one row — and
 * this endpoint trades it for a short-lived access token the socket handshake
 * and the late/cancel calls can use.
 *
 * Revoking a link therefore stops the next exchange, and the worst a stolen
 * link buys after that is the remainder of one access token's fifteen minutes.
 *
 * ## This is not authentication
 *
 * CLAUDE.md §4.1 defers authentication to Supabase Auth and this is not it: no
 * account is created, no password exists, and the token names one booking and
 * nothing else. It is a capability, held by whoever is standing in the
 * corridor with the phone the SMS went to.
 */

import { createHash } from 'node:crypto';

import { signToken } from '../config/jwt.js';
import { AppError } from '../errors/AppError.js';
import * as guestRepo from '../repositories/guest.repo.js';

import * as bookingService from './booking.service.js';

import type { BookingView } from './booking.service.js';

/** What the screen behind a tracking link is given. */
export interface TrackingLinkView extends BookingView {
  /**
   * A short-lived access token for this one booking.
   *
   * The screen uses it for the socket handshake and for the two things a
   * patient may do — declare lateness and cancel (`APP_FLOW.md` A1.5: guest
   * gets the same controls, not fewer). It is never stored anywhere but in
   * the open tab.
   */
  readonly token: string;
  /** Seconds until that token needs exchanging again. */
  readonly expiresInSeconds: number;
}

/**
 * How long the issued access token lasts, in seconds.
 *
 * Mirrors `JWT_ACCESS_TTL`'s fifteen minutes rather than reading it, because
 * this number is told to a client so it can refresh *before* expiry, and a
 * client that refreshed exactly on the boundary would reconnect its socket
 * during the one second the server no longer accepts it.
 */
const TOKEN_TTL_SECONDS = 15 * 60;

/**
 * `GET /guest/link/:token`.
 *
 * A token that does not resolve gets `GUEST_LINK_EXPIRED` (410) whether it was
 * expired, revoked or never real. The three are deliberately indistinguishable
 * from outside: telling an unknown caller that a token *would* have been valid
 * is how a guessing attack learns it is getting warmer. The person holding a
 * genuine link reads the same sentence either way — this link has done its job.
 */
export async function openTrackingLink(token: string): Promise<TrackingLinkView> {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const link = await guestRepo.resolveTrackingToken(tokenHash);

  if (link === null) throw new AppError('GUEST_LINK_EXPIRED');

  const view = await bookingService.bookingView(link.bookingId);

  return {
    ...view,
    token: await signToken({
      kind: 'access',
      // `bookingId` is what scopes it: `requireBookingScope` refuses this
      // principal on any other booking, so one forwarded SMS cannot be walked
      // through a hospital's queue.
      claims: { sub: link.guestId, kind: 'guest', bookingId: link.bookingId },
    }),
    expiresInSeconds: TOKEN_TTL_SECONDS,
  };
}
