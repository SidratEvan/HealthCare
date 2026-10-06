'use client';

/**
 * The ward board's one stateful hook (`S-B-06`, FRONTEND.md §11.1).
 *
 * The same optimistic shape `useSessionQueue` implements for the queue, for
 * beds:
 *
 *   1. put the action in the outbox with a client timestamp and event id
 *   2. apply it to the board at once with `applyLocal` from `shared/domain` —
 *      the state machine the server guards with, not a copy of it
 *   3. send it when there is a network; on success the beds the server
 *      answers with replace the optimistic tile, in the same redraw
 *   4. on refusal drop it, which rolls the tile back, and say why (`SY-03`)
 *   5. on no network leave it applied and counted as pending (`FR-OFF-01`)
 *
 * ## Two boards, one screen
 *
 * `server` is what the API last said. `beds` is that with the outbox folded on
 * top. `<CapacityMirror>` compares the *published* figure with a tally of
 * `beds`, so an admit taken offline shows up as the difference between what
 * the ward knows and what the public is being told (`FR-BED-06`).
 *
 * ## What needs a connection and what does not
 *
 * Every change to a bed works offline. Two things do not, deliberately: the
 * bed panel's patient name and the pending list. Both are reads of a named
 * patient that the server audits (`DB-P7`), and a copy cached on a shared
 * ward computer would be a read nobody logged. Answering a request needs the
 * connection too, because answering it is telling a family.
 *
 * ## One action, shown once, and the newest statement wins (`SY-09`)
 *
 * The server states a change to a bed by two roads, the answer to the request
 * and a `bed.updated`, and either can be first or missing. Three things make
 * the board right in every order:
 *
 * - every bed carries a `version` the database raises on each change, and the
 *   board keeps, per bed, the statement with the highest one (`newestBeds`,
 *   `boardAfterRead`) — never whichever arrived last;
 * - its own action is drawn from the tap until the first statement that names
 *   it, the answer or the broadcast (`settle`), and never after;
 * - the answer's beds go on screen in the redraw that takes the drawing off.
 *
 * The board used to drop its drawing when the answer came and then read the
 * whole board again: for the length of that read the tile showed the bed
 * before the tap, and with the socket silent and the read slow it stayed
 * there.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BedOutbox,
  openHospitalChannel,
  retryDelayMs,
  type PendingBedAction,
} from '@platform/client';
import {
  applyLocal,
  boardAfterRead,
  newestBeds,
  type BedView,
  type LocalBedChange,
  type PublicCapacity,
} from '@platform/domain';

import {
  SOCKET_URL,
  bedApi,
  bedSender,
  type BoardResponse,
  type PendingHandoff,
  type PendingRequest,
} from '@/lib/beds';
import { consoleStores } from '@/lib/outbox';

export interface BedBoard {
  readonly board: BoardResponse | null;
  /** The server's beds with the outbox applied on top. */
  readonly beds: readonly BedView[];
  readonly published: PublicCapacity | null;
  /** Beds with a change still waiting to reach the server. */
  readonly pendingBedIds: ReadonlySet<string>;
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
  readonly connected: boolean;
  /** The server's clock at the last thing it told the board. */
  readonly lastServerTs: string | null;
  readonly loading: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
  /** The last thing the server refused, as its reason code. */
  readonly lastRefusal: string | null;
  readonly clearRefusal: () => void;
  readonly requests: readonly PendingRequest[] | null;
  /** The ER half of the pending list (`BTN-B07-ADMIT`, `FR-BED-07`). */
  readonly handoffs: readonly PendingHandoff[] | null;
  readonly requestsFailed: boolean;
  /** Takes a bed action: queued, applied, sent. */
  readonly act: (input: {
    readonly bedId: string;
    readonly route: string;
    readonly body: Record<string, unknown>;
    readonly change: Omit<LocalBedChange, 'at' | 'bedId'> | null;
  }) => Promise<void>;
  /** Answers a request. Online only; rejects when it did not happen. */
  readonly respond: (requestId: string, body: Record<string, unknown>) => Promise<void>;
  readonly api: ReturnType<typeof bedApi>;
}

/** How many named actions the board remembers not to draw again. */
const REMEMBERED_SETTLED = 1_000;

/** A bed write's answer (`BedActionResult`), read without trusting its shape. */
function readAnswer(value: unknown): {
  readonly beds: readonly BedView[];
  readonly published: PublicCapacity | null;
  readonly serverTs: string;
} | null {
  if (typeof value !== 'object' || value === null) return null;
  const answer = value as { beds?: unknown; published?: unknown; serverTs?: unknown };
  if (!Array.isArray(answer.beds) || typeof answer.serverTs !== 'string') return null;
  return {
    beds: answer.beds as BedView[],
    published: (answer.published ?? null) as PublicCapacity | null,
    serverTs: answer.serverTs,
  };
}

/** The later of two server times; the freshness line never steps back. */
function later(held: string | null, next: string): string {
  return held === null || next > held ? next : held;
}

export function useBedBoard(options: {
  readonly hospitalId: string;
  readonly getToken: () => string | null;
}): BedBoard {
  const { hospitalId } = options;

  // Held in a ref for the reason `useSessionQueue` gives: an inline
  // `getToken` would otherwise reopen the socket on every render.
  const getTokenRef = useRef(options.getToken);
  getTokenRef.current = options.getToken;
  const getToken = useCallback(() => getTokenRef.current(), []);

  const api = useMemo(() => bedApi(getToken), [getToken]);
  const send = useMemo(() => bedSender(getToken), [getToken]);

  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [serverBeds, setServerBeds] = useState<readonly BedView[]>([]);
  const [published, setPublished] = useState<PublicCapacity | null>(null);
  const [lastServerTs, setLastServerTs] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [socketUp, setSocketUp] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(true);
  const [pending, setPending] = useState<PendingBedAction[]>([]);
  const [stuck, setStuck] = useState<PendingBedAction[]>([]);
  const [durable, setDurable] = useState(true);
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [requests, setRequests] = useState<readonly PendingRequest[] | null>(null);
  const [handoffs, setHandoffs] = useState<readonly PendingHandoff[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const outboxRef = useRef<BedOutbox | null>(null);
  // Kept in IndexedDB, in this person's own database (`lib/outbox.ts`): a
  // reload or a power cut loses no bed action that was waiting (`FR-OFF-01`).
  outboxRef.current ??= new BedOutbox(consoleStores().beds);

  // --- reading ---------------------------------------------------------------

  const loadBoard = useCallback(async () => {
    try {
      const next = await api.board(hospitalId);
      setBoard(next);
      // Every bed there is, but not newer than a statement merely for having
      // been asked for later (`SY-09`).
      setServerBeds((held) => boardAfterRead(held, next.beds));
      setPublished(next.published);
      setLastServerTs((held) => later(held, next.serverTs));
      setFailed(false);
    } catch {
      // A board already on screen stays there, ageing honestly; only a board
      // that never loaded is an error (`GR-03`).
      setFailed((previous) => previous || board === null);
    } finally {
      setLoading(false);
    }
  }, [api, hospitalId, board]);

  const loadRequests = useCallback(async () => {
    try {
      const pending = await api.pending(hospitalId);
      setRequests(pending.requests);
      setHandoffs(pending.handoffs);
      setRequestsFailed(false);
    } catch {
      setRequestsFailed(true);
    }
  }, [api, hospitalId]);

  // `board` in `loadBoard`'s dependencies would re-run this on every load, so
  // the effect keys on the hospital and on an explicit retry instead.
  const loadBoardRef = useRef(loadBoard);
  loadBoardRef.current = loadBoard;
  useEffect(() => {
    void loadBoardRef.current();
    void loadRequests();
  }, [hospitalId, attempt, loadRequests]);

  // --- sending ---------------------------------------------------------------

  /** Actions a statement from the server has named: done, never drawn again (`SY-09`). */
  const settledRef = useRef(new Set<string>());
  /** This board's unanswered actions, to know a broadcast that names one of them. */
  const waitingRef = useRef<readonly string[]>([]);
  waitingRef.current = pending.map((action) => action.clientEventId);

  /**
   * A statement has named this action. If it is one this board is waiting on,
   * it comes off the board's own drawing now — in the same turn as the beds
   * that contain it are set, so the two are one redraw — and out of the
   * outbox, where there is nothing left to send.
   */
  const settle = useCallback((clientEventId: string) => {
    if (!waitingRef.current.includes(clientEventId)) return;

    const settled = settledRef.current;
    settled.add(clientEventId);
    for (const key of settled) {
      if (settled.size <= REMEMBERED_SETTLED) break;
      settled.delete(key);
    }
    setPending((held) => held.filter((action) => !settled.has(action.clientEventId)));
    void outboxRef.current?.discard([clientEventId]).catch(() => undefined);
  }, []);

  const refreshPending = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    // Nothing a statement has already named: the outbox may hold it a moment
    // longer than the board may draw it.
    const settled = settledRef.current;
    const here = (action: PendingBedAction): boolean =>
      action.hospitalId === hospitalId && !settled.has(action.clientEventId);
    setPending((await outbox.pending()).filter(here));
    setStuck((await outbox.stuck()).filter(here));
    setDurable(consoleStores().durable());
  }, [hospitalId]);

  // What was queued before this page loaded is on the board again at once.
  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  const flush = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    const outcome = await outbox.flush(hospitalId, send);
    if (outcome.refused.length > 0) setLastRefusal(outcome.refused[0]?.reason ?? null);

    // What the server answered goes on the board in the redraw that takes
    // the answered actions off it (`SY-09`): the beds each one changed, as
    // they stand after the commit, kept where they are the newer.
    const answers = outcome.answers.flatMap((entry) => {
      const answer = readAnswer(entry.answer);
      return answer === null ? [] : [answer];
    });
    if (answers.length > 0) {
      setServerBeds((held) =>
        answers.reduce<readonly BedView[]>((beds, answer) => newestBeds(beds, answer.beds), held),
      );
      const last = answers[answers.length - 1];
      if (last !== undefined) {
        if (last.published !== null) setPublished(last.published);
        setLastServerTs((held) => later(held, last.serverTs));
      }
    }
    const answered = new Set([
      ...outcome.accepted,
      ...outcome.refused.map((entry) => entry.clientEventId),
    ]);
    if (answered.size > 0) {
      setPending((held) => held.filter((action) => !answered.has(action.clientEventId)));
    }
    await refreshPending();

    // A refusal means the board this console drew on was behind, and an
    // accepted action with no answer to read came from a server that sent
    // none: either way, read the board. Not otherwise: the answer was enough.
    if (outcome.refused.length > 0 || outcome.accepted.length > answers.length) {
      await loadBoardRef.current();
    }
  }, [hospitalId, send, refreshPending]);

  // --- the channel -----------------------------------------------------------

  useEffect(() => {
    const channel = openHospitalChannel({
      url: SOCKET_URL,
      getToken,
      onConnection: (connected) => {
        setSocketUp(connected);
        if (connected) {
          // Catch up on whatever happened while the channel was down, then
          // send what this console did in the meantime.
          void loadBoardRef.current();
          void flush();
        }
      },
      onBeds: (beds, serverTs, clientEventId) => {
        // The broadcast names the action behind it. If it is this board's,
        // the drawing comes off in the redraw that shows these beds.
        if (clientEventId !== null) settle(clientEventId);
        // Per bed, the higher version: a broadcast delivered late does not
        // put a bed back (`SY-09`).
        setServerBeds((held) => newestBeds(held, beds));
        setLastServerTs((held) => later(held, serverTs));
      },
      onCapacity: (next, serverTs) => {
        if (next.hospitalId !== hospitalId) return;
        setPublished(next);
        setLastServerTs((held) => later(held, serverTs));
      },
      onRequest: () => {
        void loadRequests();
      },
      onHandoff: () => {
        void loadRequests();
      },
    });

    return () => {
      channel.close();
    };
  }, [getToken, hospitalId, flush, loadRequests, settle]);

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

  // --- acting ----------------------------------------------------------------

  const act = useCallback<BedBoard['act']>(
    async ({ bedId, route, body, change }) => {
      const outbox = outboxRef.current;
      if (outbox === null) return;

      const at = new Date().toISOString();
      await outbox.enqueue({
        clientEventId: crypto.randomUUID(),
        hospitalId,
        bedId,
        path: `/beds/${bedId}/${route}`,
        body,
        clientTs: at,
        change: change === null ? null : ({ ...change, bedId, at } as LocalBedChange),
      });

      // On the screen before anything touches the network (`NFR-02`).
      await refreshPending();
      await flush();
    },
    [hospitalId, refreshPending, flush],
  );

  const retryStuck = useCallback(async () => {
    await outboxRef.current?.retryStuck();
    await refreshPending();
    await flush();
  }, [refreshPending, flush]);

  const discardStuck = useCallback(async () => {
    await outboxRef.current?.discard(stuck.map((action) => action.clientEventId));
    await refreshPending();
  }, [stuck, refreshPending]);

  const respond = useCallback<BedBoard['respond']>(
    async (requestId, body) => {
      await api.respond(requestId, body);
      await Promise.all([loadBoardRef.current(), loadRequests()]);
    },
    [api, loadRequests],
  );

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
    if (!(socketUp && browserOnline)) return undefined;

    const timer = setTimeout(() => {
      retriesRef.current += 1;
      void flush();
    }, retryDelayMs(retriesRef.current));
    return () => {
      clearTimeout(timer);
    };
  }, [pending, socketUp, browserOnline, flush]);

  // --- deriving --------------------------------------------------------------

  const beds = useMemo(
    () =>
      pending.reduce<readonly BedView[]>(
        (current, action) =>
          action.change === null ? current : applyLocal(current, action.change),
        serverBeds,
      ),
    [serverBeds, pending],
  );

  const pendingBedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const action of pending) {
      ids.add(action.bedId);
      if (action.change?.toBedId !== undefined && action.change.toBedId !== null) {
        ids.add(action.change.toBedId);
      }
    }
    return ids;
  }, [pending]);

  return {
    board,
    beds,
    published,
    pendingBedIds,
    pendingCount: pending.length,
    stuckCount: stuck.length,
    retryStuck,
    discardStuck,
    durable,
    connected: socketUp && browserOnline,
    lastServerTs,
    loading,
    failed,
    retry: () => {
      setLoading(true);
      setFailed(false);
      setAttempt((value) => value + 1);
    },
    lastRefusal,
    clearRefusal: () => {
      setLastRefusal(null);
    },
    requests,
    handoffs,
    requestsFailed,
    act,
    respond,
    api,
  };
}
