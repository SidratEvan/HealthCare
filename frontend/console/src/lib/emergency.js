/**
 * The ER console's calls to the API (BACKEND.md §7.5).
 *
 * Kept out of the hook for the reason `lib/beds.js` gives: the hook reads as a
 * sequence of decisions, and every write goes through `erSender` — which is
 * also what the offline outbox flushes with, so a tap made online and a tap
 * replayed after an hour offline take one path.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';

import { API_BASE } from '@/lib/beds';

export function erApi(getToken) {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return {
    board: async (hospitalId) => await client.get(`/hospitals/${hospitalId}/emergency`),
    contact: async (caseId) => (await client.get(`/emergency/cases/${caseId}/contact`)).phone,
    suggestions: async (hospitalId, problem, need) => {
      const query = new URLSearchParams({ from: hospitalId, problem });
      if (need !== undefined && need.capability !== null) query.set('capability', need.capability);
      if (need !== undefined && need.bedKind !== null) query.set('bedKind', need.bedKind);
      return (await client.get(`/emergency/search?${query.toString()}`)).results;
    },
  };
}

/**
 * Sends one queued ER action, and says what happened to it.
 *
 * The client event id doubles as the idempotency key. A server error (5xx)
 * counts as unreachable, not refused: nothing was decided about the action,
 * so it stays queued and is tried again.
 */
export function erSender(getToken) {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return async (action) => {
    const body = { ...action.body, clientEventId: action.clientEventId, clientTs: action.clientTs };
    try {
      // What the server says the action produced: the case as it now stands,
      // or the capabilities (`SY-09`).
      const answer =
        action.method === 'PATCH'
          ? await client.patch(action.path, body, action.clientEventId)
          : action.method === 'PUT'
            ? await client.put(action.path, body, action.clientEventId)
            : await client.post(action.path, body, action.clientEventId);
      return { kind: 'accepted', answer };
    } catch (error) {
      if (error instanceof NetworkError) return { kind: 'unreachable' };
      if (!(error instanceof ApiError)) return { kind: 'unreachable' };
      // "Not now", as in `lib/beds.js`: the action stays queued.
      if (error.status === 401 || error.status === 429) return { kind: 'unreachable' };
      if (error.status < 500) {
        const reason =
          typeof error.details?.['guard'] === 'string'
            ? error.details['guard']
            : typeof error.details?.['reason'] === 'string'
              ? error.details['reason']
              : error.code;
        return { kind: 'refused', code: error.code, reason };
      }
      return { kind: 'failed', code: error.code };
    }
  };
}
