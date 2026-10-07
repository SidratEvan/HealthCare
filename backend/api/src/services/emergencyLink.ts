/**
 * The "I'm on my way" status link (`FR-EMG-06`, `S-A-10c`).
 *
 * A signed capability for one emergency case, on the guest-link secret with
 * its own audience. Stateless: nothing is stored, so one can be minted again
 * for any message about the case and each opens the same page.
 *
 * Its own module, as `standbyLink.ts` is: `emergency.service` mints it when
 * the alert is filed and when the ER answers, and the notification sender
 * mints it again for a message it sends from the stored row, which has no
 * link (plan H1). A service importing the other would be a cycle.
 */

import { signToken } from '../config/jwt.js';
import { patientLink } from '../config/links.js';

/** Mints a status token for one emergency case. */
export async function emergencyCaseToken(caseId: string): Promise<string> {
  return await signToken({
    kind: 'emergency_case',
    claims: { sub: caseId, kind: 'guest', emergencyCaseId: caseId },
  });
}

/** The family's status page in the patient app (`S-A-10c`). */
export function emergencyCaseUrl(
  token: string,
  at: { readonly hospitalOrigin?: string | null } = {},
): string {
  return patientLink('/emergency/onway', { t: token }, at);
}
