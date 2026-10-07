/**
 * A hospital's own application (`FR-ONB-09`, `POST /hospital-applications`).
 *
 * Sent with no session: nobody is signed in, which is the point. The key is
 * made once for a form and kept for every retry of it, so a form whose
 * answer was lost on the way back is answered again and makes no second
 * workspace.
 */

import type { ApplicationBody } from '@platform/domain';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

export type ApplicationOutcome =
  | { readonly ok: true; readonly code: string; readonly adminEmail: string }
  | {
      readonly ok: false;
      /**
       * `paused`: too many applications are waiting for the platform.
       * `too_many`: this address has sent several already.
       * `invalid`: the server refused a field the screen let through.
       */
      readonly reason: 'offline' | 'paused' | 'too_many' | 'invalid' | 'weak_password' | 'failed';
    };

function isOffline(): boolean {
  return globalThis.navigator?.onLine === false;
}

export async function sendApplication(
  body: ApplicationBody,
  key: string,
): Promise<ApplicationOutcome> {
  if (isOffline()) return { ok: false, reason: 'offline' };

  let response: Response;
  try {
    response = await fetch(`${API}/hospital-applications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return { ok: false, reason: isOffline() ? 'offline' : 'failed' };
  }

  if (response.ok) {
    const answer = (await response.json()) as { data: { code: string; adminEmail: string } };
    return { ok: true, code: answer.data.code, adminEmail: answer.data.adminEmail };
  }

  let code = '';
  let reason: unknown;
  try {
    const refused = (await response.json()) as {
      error?: { code?: string; details?: { reason?: unknown } };
    };
    code = refused.error?.code ?? '';
    reason = refused.error?.details?.reason;
  } catch {
    // A refusal with no body is still a refusal.
  }

  if (response.status === 429) {
    return { ok: false, reason: reason === 'applications_paused' ? 'paused' : 'too_many' };
  }
  if (code === 'AUTH_PASSWORD_WEAK') return { ok: false, reason: 'weak_password' };
  if (response.status === 400 || response.status === 422) return { ok: false, reason: 'invalid' };
  return { ok: false, reason: 'failed' };
}
