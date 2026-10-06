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
 * `serverState` is what the server last said, on the session channel or in
 * answer to a push. `state` is that with locally-queued events folded on top.
 * Keeping them apart is what makes a rollback possible: a conflicted event is
 * dropped from the pending list and the derived state simply stops including
 * it — no inverse operation, no attempt to subtract an event from a queue.
 *
 * ## An answered action leaves the fold as the server's queue arrives
 *
 * Step 4. The answer to a push carries the queue with the batch in it
 * (`SY-05`), and it is shown in the same redraw that stops folding those
 * actions on top. They used to be dropped when the answer came and the queue
 * left to arrive on the socket, which is another connection: whenever it was
 * the slower of the two, the counter was shown the queue *before* her tap
 * until it caught up, and with the socket silent she was left there.
 *
 * ## One action, shown once (`SY-08`, FRONTEND.md §11.1)
 *
 * The server states the result of a tap by two roads, the answer to the push
 * and a broadcast, and either can be first or missing. So an action of this
 * console's is drawn on top of the server's queue from the tap until **the
 * first statement that names it**, whichever road that comes by, and never
 * after:
 *
 * - the answer names it in `accepted` (or refuses it);
 * - a `queue.updated` names it in `applied`, and so does the catch-up after a
 *   subscribe, which is asked about the actions still unanswered.
 *
 * Taking the action off and showing the queue that contains it are one
 * redraw. Before this the broadcast named nothing: when it beat the answer —
 * and the answer waits for messages to be sent, so it usually did — the action
 * was on screen twice, once in the server's queue and once folded on top. A
 * doctor who declared thirty minutes was shown sixty until the answer came.
 *
 * `settledRef` is what makes "never after" hold across the store: a named
 * action is gone from the screen at once and from the outbox a moment later,
 * and nothing that reads the outbox in between may draw it again.
 *
 * ## A tap is recorded whole
 *
 * A tap can be two events (this patient done, the next one called). They are
 * written to the outbox one after the other, and nothing reads the outbox
 * between them (`tapRef`): not a redraw, which would show half a tap, and not
 * a push, which would send half of one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  OfflineQueue,
  openSessionChannel,
  readKept,
  retryDelayMs,
  type AppliedAction,
  type ConsoleStores,
  type PendingEvent,
  type QueueUpdatedMessage,
  type SessionSnapshot,
} from '@platform/client';
import {
  continueReplay,
  id,
  UNDO_WINDOW_SECONDS,
  type OfflineAction,
  type QueueEvent,
  type QueueState,
} from '@platform/domain';

import { consoleStores } from '@/lib/outbox';
import {
  createEndTransport,
  createPullTransport,
  createSyncTransport,
  createUndoTransport,
} from '@/lib/sync';

/**
 * What became of an undo (`GR-02`).
 *
 * `nothing` is an action the server had already refused, or no action at all:
 * there was nothing left to take back.
 */
export type UndoOutcome = 'undone' | 'nothing' | 'expired' | 'offline' | 'refused';

/**
 * What became of ending the chamber (`BTN-B02-END`).
 *
 * `in-chamber` is the server refusing because somebody is in the chamber —
 * which this screen did not show, or the control would have been off. By the
 * time it is returned the screen has been put right from the server.
 */
export type EndOutcome = 'ended' | 'in-chamber' | 'offline' | 'refused';

/** How many sent actions the console remembers the event ids of. */
const REMEMBERED_EVENTS = 200;

/**
 * How many named actions the console remembers not to draw again. Only the
 * moment between a statement and the outbox catching up matters, so this is
 * generous; it is bounded so that a long shift does not grow it for ever.
 */
const REMEMBERED_SETTLED = 1_000;

export interface SessionQueue {
  /** What the screen renders: server state plus anything queued locally. */
  readonly state: QueueState | null;
  readonly connected: boolean;
  readonly isStale: boolean;
  readonly lastServerTs: string | null;
  readonly pendingCount: number;
  /**
   * Actions the server answered and could not take. Set aside so they stop
   * blocking the ones behind them, kept until somebody decides (`FR-OFF-05`).
   */
  readonly stuckCount: number;
  /** Puts them back in line and tries again. */
  readonly retryStuck: () => Promise<void>;
  /** Drops them. Nothing is sent for them, ever. */
  readonly discardStuck: () => Promise<void>;
  /** False when this browser will not keep the outbox across a reload. */
  readonly durable: boolean;
  /** Raised when the server refused a locally-applied action (`SY-03`). */
  readonly lastConflict: string | null;
  readonly clearConflict: () => void;
  /**
   * Records an action, applies it locally, and syncs when it can. Returns the
   * keys it was recorded under, which is what `undo` takes.
   */
  readonly act: (
    type: OfflineAction,
    payload: Record<string, unknown>,
  ) => Promise<readonly string[]>;
  /**
   * Several actions from one tap, recorded and applied together, then sent in
   * one flush — so the last is on screen as soon as the first.
   */
  readonly actMany: (actions: readonly QueueAction[]) => Promise<readonly string[]>;
  /**
   * Takes back the actions recorded under these keys (`GR-02`).
   *
   * One still waiting to be sent is simply never sent. One the server has is
   * undone through `POST /events/:id/undo` by the event it became — newest
   * first, so a tap that finished one patient and called the next unwinds in
   * the order that leaves nobody in the chamber twice.
   */
  readonly undo: (clientEventIds: readonly string[]) => Promise<UndoOutcome>;
  /** The same, for whatever this console did last, inside the window (`FR-REC-16`). */
  readonly undoLast: () => Promise<UndoOutcome>;
  /**
   * Ends the chamber. Not an action that can be queued: an end the server has
   * not been told is not an end, so this asks at once and says what came back.
   * The answer is shown from the answer itself, as a push's is.
   */
  readonly end: () => Promise<EndOutcome>;
  readonly loading: boolean;
}

/**
 * One action as a console takes it.
 *
 * Only what `POST /sync/events` replays (`OFFLINE_ACTION_ROLES`): an undo, a
 * walk-in or an offer has a route of its own and cannot be queued here — which
 * is how the old Undo, an `ACTION_UNDONE` put into this queue, can no longer
 * be written.
 */
export interface QueueAction {
  readonly type: OfflineAction;
  readonly payload: Record<string, unknown>;
}

export interface SessionQueueOptions {
  readonly sessionId: string;
  readonly apiBaseUrl: string;
  readonly socketUrl: string;
  readonly getToken: () => string | null;
  /** Injected by the tests; the browser uses the real thing. */
  readonly now?: () => Date;
}

export function useSessionQueue(options: SessionQueueOptions): SessionQueue {
  const { sessionId, apiBaseUrl, socketUrl } = options;

  /**
   * Callbacks live in refs, and never in a dependency array.
   *
   * A caller passing `getToken={() => …}` inline — which is the natural way to
   * write it — creates a new function on every render. With that in the
   * socket effect's dependencies the channel tears down and reopens on every
   * render, and the connection never survives long enough to finish its
   * handshake. The symptom is a console stuck on "loading" with the server
   * reporting nothing at all, because nothing ever reached it.
   */
  const getTokenRef = useRef(options.getToken);
  getTokenRef.current = options.getToken;
  const getToken = useCallback(() => getTokenRef.current(), []);

  const nowRef = useRef(options.now);
  nowRef.current = options.now;
  const now = useCallback(() => nowRef.current?.() ?? new Date(), []);

  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    state: null,
    etas: [],
    lastServerTs: null,
    lastSeq: 0,
    connected: false,
  });
  const [pending, setPending] = useState<PendingEvent[]>([]);
  const [stuck, setStuck] = useState<PendingEvent[]>([]);
  // True until the browser shows otherwise, so the first paint and the
  // server's agree; `refreshPending` asks the store.
  const [durable, setDurable] = useState(true);
  const [lastConflict, setLastConflict] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * What the browser itself says about the network.
   *
   * Tracked separately from the socket because the socket finds out far too
   * late. A dropped wifi does not close an established WebSocket — the
   * connection simply stops carrying anything, and Socket.IO only notices when
   * its ping times out, up to a minute later. A console that says "সংযুক্ত"
   * for a minute after the network died is telling a receptionist something
   * false at exactly the moment it matters (`PRD.md` §3.2, `FR-OFF-01`).
   *
   * `navigator.onLine` is the earliest signal available and is authoritative
   * in the direction that matters: when it says offline, it is.
   */
  const [browserOnline, setBrowserOnline] = useState(true);

  // The queue outlives any render, and the page: it is kept in IndexedDB, in
  // a database of this person's own (`lib/outbox.ts`), so a reload, a crashed
  // tab or a power cut loses nothing that was waiting to go (`FR-OFF-01`).
  const storesRef = useRef<ConsoleStores | null>(null);
  storesRef.current ??= consoleStores();
  const queueRef = useRef<OfflineQueue | null>(null);
  queueRef.current ??= new OfflineQueue(storesRef.current.queue);

  const transport = useMemo(
    () => createSyncTransport(apiBaseUrl, getToken),
    [apiBaseUrl, getToken],
  );
  const sendUndo = useMemo(() => createUndoTransport(apiBaseUrl, getToken), [apiBaseUrl, getToken]);
  const sendEnd = useMemo(() => createEndTransport(apiBaseUrl, getToken), [apiBaseUrl, getToken]);
  const pull = useMemo(() => createPullTransport(apiBaseUrl, getToken), [apiBaseUrl, getToken]);

  /** The event each sent action became, by the console's own key (`GR-02`). */
  const sentRef = useRef(new Map<string, string>());
  /** What this console did last, and when, for `Ctrl+Z`. */
  const lastActionRef = useRef<{ readonly ids: readonly string[]; readonly at: number } | null>(
    null,
  );
  /** Pushes on their way, so an undo can wait to learn what became of them. */
  const flushesRef = useRef(new Set<Promise<void>>());
  /**
   * Where a push's answer goes to be shown, and the chamber it is open for —
   * kept beside it so that an answer about one chamber can never be folded
   * into another's screen.
   */
  const channelRef = useRef<{
    readonly sessionId: string;
    readonly fold: (message: QueueUpdatedMessage) => void;
  } | null>(null);

  /** Actions a statement from the server has named: in the log, never drawn again (`SY-08`). */
  const settledRef = useRef(new Set<string>());
  /** The taps being written to the outbox. Nothing reads it until they are whole. */
  const tapRef = useRef<Promise<void>>(Promise.resolve());
  /** This chamber's unanswered actions, for the next subscribe to ask about. */
  const unansweredRef = useRef<readonly string[]>([]);
  unansweredRef.current = pending.map((event) => event.clientEventId);

  const refreshPending = useCallback(async () => {
    const queue = queueRef.current;
    if (queue === null) return;

    // Never half a tap (see the header).
    await tapRef.current;

    // This chamber's only. After a reload the store may still hold another
    // chamber's unsent work, and folding that into this queue would draw
    // patients who are not in it. And nothing a statement has already named:
    // the outbox may hold it a moment longer than the screen may show it.
    const settled = settledRef.current;
    const here = (event: PendingEvent): boolean =>
      event.sessionId === sessionId && !settled.has(event.clientEventId);
    setPending((await queue.pending()).filter(here));
    setStuck((await queue.stuck()).filter(here));
    setDurable(storesRef.current?.durable() ?? false);
  }, [sessionId]);

  /**
   * A statement of the queue has named these actions: they are in the log.
   *
   * Called in the same turn as the snapshot that contains them is set, so the
   * two are one redraw (`SY-08`). Only keys this console is still waiting on
   * are acted on; a statement names every counter's actions, and the others
   * are nothing to this one.
   */
  const settle = useCallback((applied: readonly AppliedAction[]) => {
    const waiting = new Set(unansweredRef.current);
    const mine = applied.filter((entry) => waiting.has(entry.clientEventId));
    if (mine.length === 0) return;

    const settled = settledRef.current;
    const sent = sentRef.current;
    for (const entry of mine) {
      settled.add(entry.clientEventId);
      // What an undo names. The answer may never arrive to say it.
      sent.set(entry.clientEventId, entry.eventId);
    }
    for (const key of settled) {
      if (settled.size <= REMEMBERED_SETTLED) break;
      settled.delete(key);
    }
    for (const key of sent.keys()) {
      if (sent.size <= REMEMBERED_EVENTS) break;
      sent.delete(key);
    }

    setPending((held) => held.filter((event) => !settled.has(event.clientEventId)));

    // And out of the outbox: there is nothing left to send. A push already on
    // its way is answered "accepted" as a replay, which changes nothing.
    void queueRef.current?.discard(mine.map((entry) => entry.clientEventId)).catch(() => undefined);
  }, []);

  // What was queued before this page loaded is on the screen again at once,
  // and goes with the first flush after the channel connects.
  useEffect(() => {
    if (sessionId === '') return;
    void refreshPending();
  }, [sessionId, refreshPending]);

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

    const run = (async (): Promise<void> => {
      // A tap is sent whole or not yet (see the header).
      await tapRef.current;
      const outcome = await queue.flush(sessionId, transport);

      // The answer is the queue with these actions in it, and it goes on
      // screen in the same redraw that stops folding them on top (see the
      // header). Both updates are made here, together, so there is no redraw
      // with one and not the other.
      const channel = channelRef.current;
      if (outcome.update !== null && channel?.sessionId === sessionId) {
        channel.fold(outcome.update);
      }
      const answered = new Set([
        ...outcome.accepted,
        ...outcome.conflicted.map((entry) => entry.clientEventId),
      ]);
      if (answered.size > 0) {
        setPending((held) => held.filter((event) => !answered.has(event.clientEventId)));
      }

      const sent = sentRef.current;
      for (const entry of outcome.acceptedEvents) sent.set(entry.clientEventId, entry.eventId);
      // A shift is hundreds of taps and only the last few can still be undone.
      for (const key of sent.keys()) {
        if (sent.size <= REMEMBERED_EVENTS) break;
        sent.delete(key);
      }

      if (outcome.conflicted.length > 0) {
        setLastConflict(outcome.conflicted[0]?.reason ?? null);
      }

      // Left behind by an earlier page: another chamber's unsent work, taken
      // by this same person. It goes now. Anything refused there is dropped,
      // because nobody is looking at that queue to be told.
      for (const other of await queue.sessions()) {
        if (other !== sessionId) await queue.flush(other, transport);
      }

      await refreshPending();
    })();

    flushesRef.current.add(run);
    try {
      await run;
    } finally {
      flushesRef.current.delete(run);
    }
  }, [sessionId, transport, refreshPending]);

  // --- the session channel -------------------------------------------------
  useEffect(() => {
    // The session id arrives after mount (it is read from the URL), so the
    // first render has none. Opening a channel for an empty session would be a
    // connection the server refuses and the console then has to retry.
    if (sessionId === '') return undefined;

    let closed = false;
    let channel: ReturnType<typeof openSessionChannel> | null = null;
    let held: typeof channelRef.current = null;
    const snapshots = storesRef.current?.snapshots ?? null;

    void (async () => {
      // What this device was last told about this chamber, if it kept
      // anything. With no network it is all there is to open on: it goes on
      // screen with the server's own timestamp, so the freshness line says
      // how old it is, and the channel starts from it (`FR-OFF-01`,
      // `FR-OFF-03`).
      const kept = snapshots === null ? null : await readKept(snapshots, sessionId, new Date());
      if (closed) return;
      let keptStamp = kept?.lastServerTs ?? null;

      if (kept !== null) {
        setSnapshot({
          state: kept.state,
          etas: kept.etas,
          lastServerTs: kept.lastServerTs,
          lastSeq: kept.lastSeq,
          connected: false,
        });
        setLoading(false);
      }

      channel = openSessionChannel({
        url: socketUrl,
        sessionId,
        getToken,
        ...(kept === null
          ? {}
          : {
              initial: {
                state: kept.state,
                etas: kept.etas,
                lastServerTs: kept.lastServerTs,
                lastSeq: kept.lastSeq,
              },
            }),
        unanswered: () => unansweredRef.current,
        onSnapshot: (next, applied) => {
          // What the statement named comes off this console's own drawing in
          // the same redraw that shows the queue containing it (`SY-08`).
          if (applied !== undefined && applied.length > 0) settle(applied);
          setSnapshot(next);
          if (next.state === null) return;
          setLoading(false);

          // Kept for the next time this page has to open without a server.
          // The reduced state only: ids, serials and times, no names. Only
          // when the server has said something new: a reconnect that repeats
          // what was already held must not make an old queue look newly kept.
          if (next.lastServerTs === keptStamp) return;
          keptStamp = next.lastServerTs;
          void snapshots
            ?.put({
              sessionId,
              state: next.state,
              etas: next.etas,
              lastServerTs: next.lastServerTs,
              lastSeq: next.lastSeq,
              keptAt: new Date().toISOString(),
            })
            .catch(() => undefined);
        },
      });
      held = { sessionId, fold: channel.fold };
      channelRef.current = held;
    })();

    return () => {
      closed = true;
      channel?.close();
      if (channelRef.current === held) channelRef.current = null;
    };
  }, [sessionId, socketUrl, getToken, settle]);

  // --- flush on reconnect --------------------------------------------------
  //
  // The moment both the socket and the browser agree there is a network,
  // whatever the console did while there was not gets sent. This is the "sync
  // on reconnect" half of step 8's definition of done.
  useEffect(() => {
    if (!snapshot.connected || !browserOnline) return;
    void flush();
  }, [snapshot.connected, browserOnline, flush]);

  // --- and whenever the browser itself notices the network ------------------
  useEffect(() => {
    setBrowserOnline(globalThis.navigator?.onLine ?? true);

    const onOnline = (): void => {
      setBrowserOnline(true);
      void flush();
    };
    const onOffline = (): void => {
      setBrowserOnline(false);
    };

    globalThis.addEventListener?.('online', onOnline);
    globalThis.addEventListener?.('offline', onOffline);
    return () => {
      globalThis.removeEventListener?.('online', onOnline);
      globalThis.removeEventListener?.('offline', onOffline);
    };
  }, [flush]);

  /**
   * Takes an action.
   *
   * The key is generated here, once, and travels with both the optimistic
   * state and the queued event — which is what lets a later conflict be
   * matched back to the row it belongs to (`SY-02`).
   */
  const actMany = useCallback(
    async (actions: readonly QueueAction[]) => {
      const queue = queueRef.current;
      if (queue === null) return [];

      // The server orders a batch by client time and breaks a tie on the
      // random key (`SY-01`), so actions from one tap — made in the same
      // millisecond — are a millisecond apart, in the order they were taken.
      const at = now().getTime();
      const ids = actions.map(() => crypto.randomUUID());

      // Written one after the other, behind any tap still being written, and
      // with nothing reading the outbox in between: a tap is drawn whole and
      // sent whole (see the header).
      const recorded = tapRef.current.then(async () => {
        for (const [index, action] of actions.entries()) {
          await queue.enqueue({
            clientEventId: ids[index] ?? crypto.randomUUID(),
            sessionId,
            type: action.type,
            payload: action.payload,
            clientTs: new Date(at + index).toISOString(),
          });
        }
      });
      tapRef.current = recorded.catch(() => undefined);
      await recorded;
      lastActionRef.current = { ids, at };

      // Applied to the screen before anything touches the network. A
      // receptionist's tap must answer instantly whether or not there is a
      // server to hear about it (`NFR-02`, `FR-OFF-01`) — every action the tap
      // made, not only the first: one flush for all of them, in order.
      await refreshPending();
      await flush();
      return ids;
    },
    [sessionId, now, refreshPending, flush],
  );

  const act = useCallback(
    async (type: OfflineAction, payload: Record<string, unknown>) =>
      await actMany([{ type, payload }]),
    [actMany],
  );

  const undo = useCallback(
    async (clientEventIds: readonly string[]): Promise<UndoOutcome> => {
      const queue = queueRef.current;
      if (queue === null || clientEventIds.length === 0) return 'nothing';

      // A push on its way still holds these in the store. Dropping them now
      // would take them off the screen while the server keeps them.
      await Promise.allSettled([...flushesRef.current]);

      // Never sent: simply never send it. No event is written for an action
      // that was taken back before the server heard of it. An action a
      // statement has named is in the log, whatever the outbox still holds for
      // a moment, and is undone below by the event it became.
      const settled = settledRef.current;
      const unsent = await queue.discard(clientEventIds.filter((key) => !settled.has(key)));
      if (unsent.length > 0) await refreshPending();
      let outcome: UndoOutcome = unsent.length > 0 ? 'undone' : 'nothing';

      // Already in the log: compensate each by the event it became, newest
      // first. The server's answer comes back on the session channel.
      const sent = sentRef.current;
      for (const key of [...clientEventIds].reverse()) {
        const eventId = sent.get(key);
        if (eventId === undefined) continue;

        const result = await sendUndo(eventId);
        if (result !== 'undone') return result;
        sent.delete(key);
        outcome = 'undone';
      }

      return outcome;
    },
    [refreshPending, sendUndo],
  );

  const retryStuck = useCallback(async () => {
    await queueRef.current?.retryStuck();
    await refreshPending();
    await flush();
  }, [refreshPending, flush]);

  const discardStuck = useCallback(async () => {
    const queue = queueRef.current;
    if (queue === null) return;
    await queue.discard(stuck.map((event) => event.clientEventId));
    await refreshPending();
  }, [stuck, refreshPending]);

  const undoLast = useCallback(async (): Promise<UndoOutcome> => {
    const last = lastActionRef.current;
    if (last === null) return 'nothing';
    if (now().getTime() - last.at > UNDO_WINDOW_SECONDS * 1000) return 'expired';

    // Once: a second Ctrl+Z does not reach back to the action before.
    lastActionRef.current = null;
    return await undo(last.ids);
  }, [now, undo]);

  /**
   * `BTN-B02-END`.
   *
   * The server's answer is the ended queue, and it is shown from the answer
   * (see the header: the broadcast is another connection and may be late).
   *
   * A refusal that means *this screen is behind* — somebody is in the chamber
   * after all, or another counter has already ended it — is answered by
   * fetching the queue outright, for the same reason: the broadcast that
   * should have brought this screen up to date is the thing that did not
   * arrive.
   */
  const lastSeqRef = useRef(0);
  lastSeqRef.current = snapshot.lastSeq;
  const end = useCallback(async (): Promise<EndOutcome> => {
    const show = (update: QueueUpdatedMessage): void => {
      const channel = channelRef.current;
      if (channel?.sessionId === sessionId) channel.fold(update);
    };

    const outcome = await sendEnd(sessionId);
    if (outcome.kind === 'ended') {
      show(outcome.update);
      return 'ended';
    }
    if (outcome.kind === 'in-chamber' || outcome.kind === 'already-ended') {
      const truth = await pull(sessionId, lastSeqRef.current);
      if (truth !== null) show(truth);
      return outcome.kind === 'in-chamber' ? 'in-chamber' : 'ended';
    }
    return outcome.kind;
  }, [sessionId, sendEnd, pull]);

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

  // Both have to agree before the console claims it is connected. Either one
  // saying otherwise is enough to say so on screen.
  const connected = snapshot.connected && browserOnline;

  // --- and again, by itself, while something is still waiting ----------------
  //
  // FRONTEND.md §11.1 step 6: "retry with backoff". A push that failed while
  // the socket stayed up — a server restarting, a token being renewed — has no
  // reconnect to prompt the next attempt, and used to wait for somebody's next
  // tap. Offline needs no timer: the reconnect sends at once.
  const retriesRef = useRef(0);
  useEffect(() => {
    if (pending.length === 0) {
      retriesRef.current = 0;
      return undefined;
    }
    if (!connected) return undefined;

    const timer = setTimeout(() => {
      retriesRef.current += 1;
      void flush();
    }, retryDelayMs(retriesRef.current));
    return () => {
      clearTimeout(timer);
    };
  }, [pending, connected, flush]);

  return {
    state,
    connected,
    isStale: snapshot.lastServerTs === null,
    lastServerTs: snapshot.lastServerTs,
    pendingCount: pending.length,
    stuckCount: stuck.length,
    retryStuck,
    discardStuck,
    durable,
    lastConflict,
    clearConflict: () => {
      setLastConflict(null);
    },
    act,
    actMany,
    undo,
    undoLast,
    end,
    // Waiting for a server that cannot be reached is not loading. With no
    // network and nothing kept for this chamber the screen says so instead
    // (`ReceptionConsole`), and opens by itself when the connection returns.
    loading: loading && browserOnline,
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
