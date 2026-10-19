const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';

function isOffline() {
  return globalThis.navigator?.onLine === false;
}

export async function sendApplication(body, key) {
  if (isOffline()) return { ok: false, reason: 'offline' };

  let response;
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
    const answer = await response.json();
    return { ok: true, code: answer.data.code, adminEmail: answer.data.adminEmail };
  }

  let code = '';
  let reason;
  try {
    const refused = await response.json();
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
