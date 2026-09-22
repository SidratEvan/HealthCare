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
 *   3. send it when there is a network; on success the server's own
 *      `bed.updated` replaces the optimistic tile
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
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  BedOutbox,
  createMemoryBedStore,
  openHospitalChannel,
  type PendingBedAction,
} from '@platform/client';
import {
  applyLocal,
  type BedView,
  type LocalBedChange,
  type PublicCapacity,
} from '@platform/domain';

import { SOCKET_URL, bedApi, bedSender, type BoardResponse, type PendingRequest } from '@/lib/beds';

export interface BedBoard {
  readonly board: BoardResponse | null;
  /** The server's beds with the outbox applied on top. */
  readonly beds: readonly BedView[];
  readonly published: PublicCapacity | null;
  /** Beds with a change still waiting to reach the server. */
  readonly pendingBedIds: ReadonlySet<string>;
  readonly pendingCount: number;
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
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [requests, setRequests] = useState<readonly PendingRequest[] | null>(null);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const outboxRef = useRef<BedOutbox | null>(null);
  outboxRef.current ??= new BedOutbox(createMemoryBedStore());

  // --- reading ---------------------------------------------------------------

  const loadBoard = useCallback(async () => {
    try {
      const next = await api.board(hospitalId);
      setBoard(next);
      setServerBeds(next.beds);
      setPublished(next.published);
      setLastServerTs(next.serverTs);
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
      setRequests(await api.pending(hospitalId));
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

  const refreshPending = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox !== null) setPending(await outbox.pending());
  }, []);

  const flush = useCallback(async () => {
    const outbox = outboxRef.current;
    if (outbox === null) return;

    const outcome = await outbox.flush(hospitalId, send);
    if (outcome.refused.length > 0) setLastRefusal(outcome.refused[0]?.reason ?? null);
    await refreshPending();

    // The socket normally delivers the server's version of each change; a
    // re-read after a flush covers the case where it is the socket that was
    // down, so the board never shows an optimistic tile the server rejected.
    if (outcome.accepted.length > 0 || outcome.refused.length > 0) await loadBoardRef.current();
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
      onBeds: (beds, serverTs) => {
        setServerBeds((current) => {
          const changed = new Map(beds.map((bed) => [bed.id, bed]));
          const known = new Set(current.map((bed) => bed.id));
          return [
            ...current.map((bed) => changed.get(bed.id) ?? bed),
            ...beds.filter((bed) => !known.has(bed.id)),
          ];
        });
        setLastServerTs(serverTs);
      },
      onCapacity: (next, serverTs) => {
        if (next.hospitalId !== hospitalId) return;
        setPublished(next);
        setLastServerTs(serverTs);
      },
      onRequest: () => {
        void loadRequests();
      },
    });

    return () => {
      channel.close();
    };
  }, [getToken, hospitalId, flush, loadRequests]);

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

  const respond = useCallback<BedBoard['respond']>(
    async (requestId, body) => {
      await api.respond(requestId, body);
      await Promise.all([loadBoardRef.current(), loadRequests()]);
    },
    [api, loadRequests],
  );

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
    requestsFailed,
    act,
    respond,
    api,
  };
}
