/**
 * The link a message carries, issued again (`FR-GST-05`; `DATABASE.md` §2.7;
 * plan H1).
 *
 * A tracking or status link is a credential: whoever holds it reads that
 * booking, that standby place, that bed request or that emergency alert
 * without signing in. It is put into the text that is sent and into nothing
 * that is kept; the table itself refuses a stored link (0035). So a message
 * sent from its stored row (after a restart, or in the morning after quiet
 * hours) has `{link}` where the link went and nothing to put there.
 *
 * What the row does keep is what the link was *for*: its kind, and the ids
 * the original was made from (`LINK_PARAMS`). None of those opens anything.
 * From them a fresh link is issued here, by the function that issued the
 * first, and it opens the same page.
 *
 * - **A booking's tracking link** is a new row in `guest_links`. A booking
 *   may hold several live links (migration 0041), so this does not cancel one
 *   that may already be in somebody's inbox.
 * - **A standby, bed-request and emergency link** is a stateless signed
 *   token: minting another stores nothing.
 * - **A report's link** is the Records page. It was never a credential; it is
 *   kept out of the row only because the row keeps no link of any kind.
 *
 * Where a link cannot be issued (the row was written before this, the booking
 * is gone, the number has no identity) the answer is null and the message is
 * failed, visibly. It is never sent with a hole where the link was: for a
 * guest the link is the message.
 */

import { patientLink } from '../config/links.js';
import * as bookingRepo from '../repositories/booking.repo.js';

import { bedRequestToken, bedRequestUrl } from './bedRequestLink.js';
import { emergencyCaseToken, emergencyCaseUrl } from './emergencyLink.js';
import * as portals from './portal.service.js';
import { standbyToken, standbyUrl } from './standbyLink.js';
import { mintTrackingToken } from './trackingLink.js';

/** What a link can be for. Stored on the row as `linkKind`. */
export const LINK_KINDS = [
  'booking',
  'standby',
  'bed_request',
  'emergency_case',
  'records',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * The parameters that say what a message's link was for. Ids and an origin:
 * kept on the row beside the words, and none of them a credential.
 */
export const LINK_PARAMS = {
  kind: 'linkKind',
  /** The origin the first link was in: a hospital's portal, or the network's app. */
  base: 'linkBase',
  /** Whose capability a stateless token is: a guest identity or a patient. */
  subject: 'linkSubject',
  standbyId: 'standbyId',
} as const;

function text(params: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = params[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/** The origin of a link, to issue its successor in the same place; null for none. */
export function originOf(link: string): string | null {
  try {
    return new URL(link).origin;
  } catch {
    return null;
  }
}

/**
 * Issues again the link a stored message carried.
 *
 * @param params the row's `params`.
 * @param phone the number the message goes to: a booking's link is issued to
 *   the identity behind it, as the first was.
 * @returns the link, or null where one cannot be issued.
 */
export async function reissueLink(
  params: Readonly<Record<string, unknown>>,
  phone: string | null,
): Promise<string | null> {
  // A row's own word for it: anything, or nothing, may be there.
  const kind: string = text(params, LINK_PARAMS.kind) ?? '';
  const base = text(params, LINK_PARAMS.base);

  switch (kind) {
    case 'booking': {
      const bookingId = text(params, 'bookingId');
      if (bookingId === null || phone === null) return null;
      const booking = await bookingRepo.findById(bookingId);
      if (booking === null) return null;
      try {
        const { token, hospitalId } = await mintTrackingToken({
          bookingId,
          sessionId: booking.sessionId,
          phone,
        });
        return patientLink(
          '/s',
          { b: bookingId, t: token },
          { hospitalOrigin: base ?? (await portals.hospitalLinkOrigin(hospitalId)) },
        );
      } catch {
        // No identity behind the number, or the chamber is gone.
        return null;
      }
    }

    case 'standby': {
      const standbyId = text(params, LINK_PARAMS.standbyId);
      const subject = text(params, LINK_PARAMS.subject);
      if (standbyId === null || subject === null) return null;
      return standbyUrl(await standbyToken(standbyId, subject), { hospitalOrigin: base });
    }

    case 'bed_request': {
      const requestId = text(params, 'bedRequestId');
      const subject = text(params, LINK_PARAMS.subject);
      if (requestId === null || subject === null) return null;
      return bedRequestUrl(await bedRequestToken(requestId, subject), { hospitalOrigin: base });
    }

    case 'emergency_case': {
      const caseId = text(params, 'emergencyCaseId');
      if (caseId === null) return null;
      return emergencyCaseUrl(await emergencyCaseToken(caseId), { hospitalOrigin: base });
    }

    case 'records':
      return patientLink('/records', {}, { hospitalOrigin: base });

    default:
      return null;
  }
}
