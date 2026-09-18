'use client';

/**
 * The console's one stateful hook (FRONTEND.md §11.1, §11.2).
 *
 * Everything the reception screen does goes through here, and it implements
 * the optimistic mutation shape §11.1 lays out, in that order:
 *
 *   1. append the event to the local queue with a client timestamp
 *   2. apply the reducer to local state immediately — under 100 ms (`NFR-02`)
 *   3. show the undo toast          (the screen does this from the return value)
 *   4. sync; on success reconcile with the server's authoritative state
 *   5. on rejection roll the row back with an explanation (`FR-QUE-53`)
 *   6. on network failure leave it applied and raise the pending count
 *
 * ## The reducer is not reimplemented here
 *
 * Step 2 calls `reduce` from `@platform/domain` — literally the function the
 * server runs over the same log. That is the mechanism behind `FR-QUE-05`: the
 * console and the API cannot disagree about what an event means, because there
 * is only one definition of it (CLAUDE.md §7).
 *
 * ## Why optimistic state is a separate value from server state
 *
 * `serverState` is what the last `queue.updated` said. `state` is that with
 * locally-queued events folded on top. Keeping them apart is what makes a
 * rollback possible: a conflicted event is dropped from the pending list and
 * the derived state simply stops including it — no inverse operation, no
 * attempt to subtract an event from a queue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  OfflineQueue,
  createMemoryStore,
  openSessionChannel,
  type PendingEvent,
  type SessionSnapshot,
} from '@platform/client';
import {
  continueReplay,
  id,
  type QueueEvent,
  type QueueState,
  type QueueEventType,
} from '@platform/domain';

import { createSyncTransport } from '@/lib/sync';

export interface ReceptionQueue {
  /** What the screen renders: server state plus anything queued locally. */
  readonly state: QueueState | null;
  readonly connected: boolean;
  readonly isStale: boolean;
  readonly lastServerTs: string | null;
  readonly pendingCount: number;
  /** Raised when the server refused a locally-applied action (`SY-03`). */
  readonly lastConflict: string | null;
  readonly clearConflict: () => void;
  /** Records an action, applies it locally, and syncs when it can. */
  readonly act: (type: QueueEventType, payload: Record<string, unknown>) => Promise<void>;
  readonly loading: boolean;
}

export interface ReceptionQueueOptions {
  readonly sessionId: string;
  readonly apiBaseUrl: string;
  readonly socketUrl: string;
  readonly getToken: () => string | null;
  /** Injected by the tests; the browser uses the real thing. */
  readonly now?: () => Date;
}

export function useReceptionQueue(options: ReceptionQueueOptions): ReceptionQueue {
  const { sessionId, apiBaseUrl, socketUrl, getToken } = options;
  const now = options.now ?? (() => new Date());

  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    state: null,
    etas: [],
    lastServerTs: null,
    lastSeq: 0,
    connected: false,
  });
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [lastConflict, setLastConflict] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // The queue outlives any render. A memory store here rather than Dexie's:
  // the Dexie store is swapped in by the app shell once IndexedDB has opened,
  // and the hook does not care which it was given.
  const queueRef = useRef<OfflineQueue | null>(null);
  queueRef.current ??= new OfflineQueue(createMemoryStore());

  const transport = useMemo(
    () => createSyncTransport(apiBaseUrl, getToken),
    [apiBaseUrl, getToken],
  );

  const refreshPending = useCallback(async () => {
    const queue = queueRef.current;
    if (queue === null) return;
    setPending(await queue.pending());
  }, []);

  /**
   * Pushes whatever is queued, and reports anything the server refused.
   *
   * A conflict is surfaced once, as a sentence, rather than as a list: a
   * receptionist mid-shift needs to know the queue moved under her, not to
   * audit five rejected keys.
   */
  const flush = useCallback(async () => {
    const queue = queueRef.current;
    if (queue === null) return;

    const outcome = await queue.flush(sessionId, transport);
    if (outcome.conflicted.length > 0) {
      setLastConflict(outcome.conflicted[0]?.reason ?? null);
    }
    await refreshPending();
  }, [sessionId, transport, refreshPending]);

  // --- the session channel -------------------------------------------------
  useEffect(() => {
    const channel = openSessionChannel({
      url: socketUrl,
      sessionId,
      getToken,
      onSnapshot: (next) => {
        setSnapshot(next);
        if (next.state !== null) setLoading(false);
      },
    });

    return () => {
      channel.close();
    };
  }, [sessionId, socketUrl, getToken]);

  // --- flush on reconnect --------------------------------------------------
  //
  // The moment the socket says it is connected, whatever the console did while
  // it was not gets sent. This is the "sync on reconnect" half of step 8's
  // definition of done.
  useEffect(() => {
    if (!snapshot.connected) return;
    void flush();
  }, [snapshot.connected, flush]);

  // --- and whenever the browser itself notices the network ------------------
  useEffect(() => {
    const onOnline = (): void => {
      void flush();
    };
    globalThis.addEventListener?.('online', onOnline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
    };
  }, [flush]);

  /**
   * Takes an action.
   *
   * The key is generated here, once, and travels with both the optimistic
   * state and the queued event — which is what lets a later conflict be
   * matched back to the row it belongs to (`SY-02`).
   */
  const act = useCallback(
    async (type: QueueEventType, payload: Record<string, unknown>) => {
      const queue = queueRef.current;
      if (queue === null) return;

      await queue.enqueue({
        clientEventId: crypto.randomUUID(),
        sessionId,
        type,
        payload,
        clientTs: now().toISOString(),
      });

      // Applied to the screen before anything touches the network. A
      // receptionist's tap must answer instantly whether or not there is a
      // server to hear about it (`NFR-02`, `FR-OFF-01`).
      await refreshPending();
      await flush();
    },
    [sessionId, now, refreshPending, flush],
  );

  /**
   * Server state with the locally-queued events folded on top.
   *
   * `continueReplay` rather than `reduce` in a loop: it is the same fold, and
   * it handles an `ACTION_UNDONE` in the pending batch correctly, which a
   * per-event loop cannot.
   */
  const state = useMemo(() => {
    if (snapshot.state === null) return null;
    if (pending.length === 0) return snapshot.state;

    return continueReplay(snapshot.state, pending.map(toDomainEvent(snapshot.lastSeq)));
  }, [snapshot.state, snapshot.lastSeq, pending]);

  return {
    state,
    connected: snapshot.connected,
    isStale: snapshot.lastServerTs === null,
    lastServerTs: snapshot.lastServerTs,
    pendingCount: pending.length,
    lastConflict,
    clearConflict: () => {
      setLastConflict(null);
    },
    act,
    loading,
  };
}

/**
 * Shapes a queued event the way the reducer expects one.
 *
 * The sequence numbers are provisional — the server assigns the real ones — so
 * they continue from the last one seen. The reducer only needs them to be
 * increasing, and when the server's echo arrives it replaces this state
 * entirely rather than merging with it.
 */
function toDomainEvent(lastSeq: number): (event: PendingEvent, index: number) => QueueEvent {
  return (event, index) =>
    ({
      id: id(event.clientEventId),
      sessionId: id(event.sessionId),
      seq: lastSeq + index + 1,
      serverTs: id(event.clientTs),
      clientTs: id(event.clientTs),
      clientEventId: id(event.clientEventId),
      actor: { kind: 'system', job: 'console-optimistic' },
      type: event.type,
      payload: event.payload,
    }) as QueueEvent;
}
