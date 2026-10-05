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
  type QueueUpdatedMessage,
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

    return {
      accepted: response.accepted,
      conflicts: response.conflicts,
      // The queue with this batch in it (`SY-05`). The console shows it at
      // once instead of waiting to be told the same thing on the socket.
      update: {
        seq: response.seq,
        serverTs: response.serverTs,
        data: { state: response.state, etas: response.etas },
      },
    };
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

/** What became of asking the server to end a chamber (`BTN-B02-END`). */
export type EndSendOutcome =
  /** Ended, and here is the queue as the server now holds it. */
  | { readonly kind: 'ended'; readonly update: QueueUpdatedMessage }
  /** Refused: a patient is in the chamber. This screen was behind. */
  | { readonly kind: 'in-chamber' }
  /** Refused: somebody else had already ended it. This screen was behind. */
  | { readonly kind: 'already-ended' }
  | { readonly kind: 'offline' }
  | { readonly kind: 'refused' };

/**
 * The console's transport to `POST /sessions/:id/end`.
 *
 * Returns what happened rather than throwing, as the undo transport does:
 * each outcome is something the person at the counter is told in a sentence.
 * The two refusals that mean "your screen is out of date" are told apart from
 * the rest, because the answer to them is to fetch the queue again
 * (`createPullTransport`), not to try again.
 */
export function createEndTransport(
  baseUrl: string,
  getToken: () => string | null,
): (sessionId: string) => Promise<EndSendOutcome> {
  const api = createQueueApi(new ApiClient({ baseUrl, getToken }));

  return async (sessionId) => {
    try {
      const answer = await api.end(sessionId, crypto.randomUUID());
      return {
        kind: 'ended',
        update: {
          seq: answer.seq,
          serverTs: answer.serverTs,
          data: { state: answer.state, etas: answer.etas },
        },
      };
    } catch (error) {
      if (error instanceof NetworkError) return { kind: 'offline' };
      if (error instanceof ApiError) {
        const guard = error.details?.['guard'];
        if (guard === 'PATIENT_IN_CHAMBER') return { kind: 'in-chamber' };
        if (guard === 'SESSION_ENDED') return { kind: 'already-ended' };
      }
      return { kind: 'refused' };
    }
  };
}

/**
 * The queue as the server holds it now, asked for outright
 * (`GET /sync/session/:id`).
 *
 * For the moment a console learns its screen is behind — the server refused
 * something the screen said was allowed. The broadcast that would have told it
 * may be late or lost, which is how it came to be behind, so it does not wait
 * for one. Null when the server could not be asked.
 */
export function createPullTransport(
  baseUrl: string,
  getToken: () => string | null,
): (sessionId: string, sinceSeq: number) => Promise<QueueUpdatedMessage | null> {
  const api = createSyncApi(new ApiClient({ baseUrl, getToken }));

  return async (sessionId, sinceSeq) => {
    try {
      const answer = await api.pull(sessionId, sinceSeq, null);
      return {
        seq: answer.seq,
        serverTs: answer.serverTs,
        data: { state: answer.state, etas: answer.etas },
      };
    } catch {
      return null;
    }
  };
}
