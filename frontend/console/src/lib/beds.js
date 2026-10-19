/**
 * The ward board's calls to the API (BACKEND.md §7.5).
 *
 * Kept out of the hook so the hook reads as a sequence of decisions, and so a
 * test could hand the hook a fake. Every write goes through `bedSender`,
 * which is also what the offline outbox flushes with — one path for a tap made
 * online and a tap replayed after an hour offline.
 */

import { ApiClient, ApiError, NetworkError } from '@platform/client';

export const API_BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000/api/v1';
export const SOCKET_URL = process.env['NEXT_PUBLIC_SOCKET_URL'] ?? 'http://localhost:4000';

export function bedApi(getToken) {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return {
    board: async (hospitalId) => await client.get(`/hospitals/${hospitalId}/beds`),
    panel: async (bedId) => await client.get(`/beds/${bedId}`),
    pending: async (hospitalId) => await client.get(`/hospitals/${hospitalId}/bed-requests`),
    respond: async (requestId, body) => {
      const clientEventId = crypto.randomUUID();
      await client.post(
        `/bed-requests/${requestId}/respond`,
        { ...body, clientEventId, clientTs: new Date().toISOString() },
        clientEventId,
      );
    },
  };
}

/**
 * Sends one queued ward action, and says what happened to it.
 *
 * The client event id doubles as the idempotency key: a replay after a
 * dropped connection carries both, and the server recognises it by the first
 * (`bed_events.client_event_id`, `SY-02`).
 *
 * A server error (5xx) counts as *unreachable*, not refused: nothing was
 * decided about the action, so it stays queued and is tried again.
 */
export function bedSender(getToken) {
  const client = new ApiClient({ baseUrl: API_BASE, getToken });

  return async (action) => {
    try {
      const answer = await client.post(
        action.path,
        { ...action.body, clientEventId: action.clientEventId, clientTs: action.clientTs },
        action.clientEventId,
      );
      // The beds the action changed, as they now stand (`SY-09`).
      return { kind: 'accepted', answer };
    } catch (error) {
      if (error instanceof NetworkError) return { kind: 'unreachable' };
      if (!(error instanceof ApiError)) return { kind: 'unreachable' };
      // A token to renew or a limit to wait out: the action is fine and stays
      // queued. Read as a refusal, an expired token after twenty minutes
      // offline dropped every bed action the ward had taken.
      if (error.status === 401 || error.status === 429) return { kind: 'unreachable' };
      if (error.status < 500) {
        const reason =
          typeof error.details?.['reason'] === 'string' ? error.details['reason'] : error.code;
        return { kind: 'refused', code: error.code, reason };
      }
      // The server's own fault. Kept and retried; set aside if it never clears.
      return { kind: 'failed', code: error.code };
    }
  };
}
