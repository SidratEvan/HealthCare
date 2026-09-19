/**
 * The console's transport to `/sync/events`.
 *
 * A thin adapter between `@platform/client`'s `PushTransport` shape and the
 * typed sync API, kept apart from the hook so the hook can be handed a fake in
 * a test without any of this being involved.
 */

import { ApiClient, createSyncApi, type PushTransport } from '@platform/client';

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
