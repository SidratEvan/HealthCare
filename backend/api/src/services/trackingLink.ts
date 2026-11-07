/**
 * The token behind a booking's tracking link (`FR-GST-05`).
 *
 * "Single-booking scoped, expires after the session ends plus a grace period,
 * and is revocable." Only the SHA-256 of the token is stored, so a database
 * read cannot open somebody's queue: the token exists in the SMS and nowhere
 * else. Why the link carries this opaque token and not a signed one is told
 * where the link is put together (`booking.service` `issueTrackingLink`).
 *
 * Its own module because two things mint one: `booking.service`, when a
 * booking is made or its link is asked for again, and the notification
 * sender, for a confirmation it sends from the stored row, which has no link
 * (plan H1). A booking may hold several live links (migration 0041), so the
 * second does not cancel the one that may already be in somebody's inbox.
 */

import { createHash, randomBytes } from 'node:crypto';

import { notFound } from '../errors/AppError.js';
import * as guestRepo from '../repositories/guest.repo.js';
import * as sessionRepo from '../repositories/session.repo.js';

/** How long after its chamber's planned end a link still opens. */
const GRACE_MS = 24 * 3_600_000;

/**
 * A link printed on paper is view-only (`FR-REC-21`, `FR-GST-05`).
 *
 * An SMS link reaches the patient's own phone, so it may show what was
 * written at the visit and cancel the booking. A token slip can be left in a
 * waiting room or a bin, so its link shows the live serial and nothing else:
 * no visit record, no report, no cancelling or lateness, and it lapses two
 * hours after the chamber's end rather than a day.
 *
 * Marked by its length (33 random bytes, 44 characters, against 32 and 43),
 * so no column is needed: the stored hash is of the whole token, and a link's
 * holder cannot turn one kind into the other.
 */
const VIEW_ONLY_BYTES = 33;
const VIEW_ONLY_GRACE_MS = 2 * 3_600_000;

/** Whether a tracking token is a printed slip's view-only one. */
export function isViewOnlyToken(token: string): boolean {
  return token.length === Math.ceil((VIEW_ONLY_BYTES * 4) / 3);
}

/**
 * Mints a tracking token for one booking and stores its hash.
 *
 * @returns the token, to be put in a link and handed over once, and the
 *   hospital the chamber is at, which decides whose portal the link is in.
 */
export async function mintTrackingToken(input: {
  readonly bookingId: string;
  readonly sessionId: string;
  readonly phone: string;
  /** A printed slip's link: view-only, and shorter-lived. */
  readonly viewOnly?: boolean;
}): Promise<{ readonly token: string; readonly hospitalId: string }> {
  const viewOnly = input.viewOnly === true;
  const token = randomBytes(viewOnly ? VIEW_ONLY_BYTES : 32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  const guestId = await guestRepo.identityIdForPhone(input.phone);
  if (guestId === null) throw notFound('guest identity');

  const session = await sessionRepo.findById(input.sessionId);
  if (session === null) throw notFound('session');

  // Session end plus a day. A patient reads the SMS on the way home as often
  // as on the way in, and a link that died the moment the chamber closed would
  // be useless exactly then (DATABASE.md §8 keeps the row for 30 days).
  const expiresAt = new Date(
    new Date(session.plannedEnd).getTime() + (viewOnly ? VIEW_ONLY_GRACE_MS : GRACE_MS),
  );

  await guestRepo.insertTrackingLink({ bookingId: input.bookingId, guestId, tokenHash, expiresAt });

  return { token, hospitalId: session.hospitalId };
}
