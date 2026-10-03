/**
 * The console's transport to `/sync/events`.
 *
 * A thin adapter between `@platform/client`'s `PushTransport` shape and the
 * typed sync API, kept apart from the hook so the hook can be handed a fake in
 * a test without any of this being involved.
 */

import {
  ApiClient,
  ApiError,
  NetworkError,
  createQueueApi,
  createSyncApi,
  type PushTransport,
} from '@platform/client';

export function createSyncTransport(baseUrl: string, getToken: () => string | null): PushTransport {
  const api = createSyncApi(new ApiClient({ baseUrl, getToken }));

  return async (sessionId, events) => {
    const response = await api.push(
      sessionId,
      events.map((event) => ({
        clientEventId: event.clientEventId,
        type: event.type,
        payload: event.payload,
        clientTs: event.clientTs,
      })),
    );

    return { accepted: response.accepted, conflicts: response.conflicts };
  };
}

/** What became of asking the server to undo one event (`GR-02`). */
export type UndoSendOutcome = 'undone' | 'expired' | 'offline' | 'refused';

/**
 * The console's transport to `POST /events/:id/undo`.
 *
 * Returns what happened rather than throwing, because every outcome is one a
 * receptionist is told about in a sentence: it worked, the ten seconds were
 * up, there is no connection, or the server would not.
 */
export function createUndoTransport(
  baseUrl: string,
  getToken: () => string | null,
): (eventId: string) => Promise<UndoSendOutcome> {
  const api = createQueueApi(new ApiClient({ baseUrl, getToken }));

  return async (eventId) => {
    try {
      await api.undo(eventId, crypto.randomUUID());
      return 'undone';
    } catch (error) {
      if (error instanceof NetworkError) return 'offline';
      if (error instanceof ApiError && error.details?.['guard'] === 'UNDO_WINDOW_EXPIRED') {
        return 'expired';
      }
      return 'refused';
    }
  };
}
