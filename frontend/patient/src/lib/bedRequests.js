'use client';

const KEY = 'patient.bed-requests';

/** A family asks for a bed and hears within hours; a week is plenty to keep one. */
const KEEP_DAYS = 7;

export function savedBedRequests() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = raw === null || raw === undefined ? [] : JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    return parsed
      .filter((entry) => typeof entry?.requestId === 'string' && typeof entry.token === 'string')
      .filter((entry) => Date.parse(entry.savedAt) > cutoff)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  }
}

export function rememberBedRequest(request) {
  try {
    const kept = savedBedRequests().filter((entry) => entry.requestId !== request.requestId);
    globalThis.localStorage?.setItem(KEY, JSON.stringify([request, ...kept]));
  } catch {
    // A phone that cannot remember still sent the request; the ward has it,
    // and the answer's SMS carries the link.
  }
}
