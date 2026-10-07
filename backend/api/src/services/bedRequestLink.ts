/**
 * The bed request's status link (`FR-PAT-52`, `S-A-11r`).
 *
 * A signed capability for one request, on the guest-link secret with its own
 * audience. Stateless: nothing is stored, so one can be minted again for any
 * message about the request and each opens the same page.
 *
 * Its own module, as `standbyLink.ts` is: `bed.service` mints it when the
 * ward answers, and the notification sender mints it again for a message it
 * sends from the stored row, which has no link (plan H1). A service importing
 * the other would be a cycle.
 */

import { signToken } from '../config/jwt.js';
import { patientLink } from '../config/links.js';

/** Mints a status token for one bed request. */
export async function bedRequestToken(requestId: string, subject: string): Promise<string> {
  return await signToken({
    kind: 'bed_request',
    claims: { sub: subject, kind: 'guest', bedRequestId: requestId },
  });
}

/** The family's status page in the patient app. */
export function bedRequestUrl(
  token: string,
  at: { readonly hospitalOrigin?: string | null } = {},
): string {
  return patientLink('/beds/request', { t: token }, at);
}
