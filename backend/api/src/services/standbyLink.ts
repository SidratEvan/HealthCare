/**
 * The standby status link (`FR-PAT-27`, `S-A-08s`).
 *
 * A signed capability for one place on one list, on the guest-link secret
 * with its own audience — the arrangement a bed request's status link has. It
 * is stateless: nothing is stored, so a fresh one can be minted for every
 * message (the join, an offer, a seat) and each opens the same place.
 *
 * Its own module because both `queue.service` (which sends the offer and the
 * seat) and `standby.service` (which answers the link) need it, and a service
 * importing the other would be a cycle.
 */

import { signToken } from '../config/jwt.js';
import { env } from '../env.js';

/** Mints a status token for one standby row. */
export async function standbyToken(standbyId: string, subject: string): Promise<string> {
  return await signToken({
    kind: 'standby',
    claims: { sub: subject, kind: 'guest', standbyId },
  });
}

/** The page in the patient app that answers it. */
export function standbyUrl(token: string): string {
  return `${env.WEB_BASE_URL}/standby?t=${encodeURIComponent(token)}`;
}

/** Both at once, for a message that carries the link. */
export async function standbyLinkFor(standbyId: string, subject: string): Promise<string> {
  return standbyUrl(await standbyToken(standbyId, subject));
}
