/**
 * The session channel client (FRONTEND.md §11.2, BACKEND.md §6).
 *
 * "`useSessionChannel(sessionId)` subscribes, handles reconnect with
 * exponential backoff, replays missed events by sequence number on reconnect,
 * and exposes `{ state, lastServerTs, isStale }`. `isStale` drives every
 * `<FreshnessLine>`."
 *
 * This is that, minus React — the socket lifecycle and the staleness rule as a
 * plain object, so both can be tested without rendering anything and so the
 * hook in `frontend/console` is a thin wrapper. Socket.IO already does the
 * reconnect backoff; what is ours is the resume handshake and deciding when a
 * number has been on screen too long to be trusted.
 */

import { io, type Socket } from 'socket.io-client';

import type { Eta, QueueState } from '@platform/domain';

/**
 * How long before a live figure is called stale.
 *
 * `hospital_settings.stale_threshold_minutes` defaults to 10 (`FR-OFF-04`) and
 * is the hospital's own setting; this is the fallback for a console that has
 * not loaded its settings yet. Erring short is correct: claiming data is stale
 * when it is fresh costs a glance, and the reverse costs trust.
 */
export const DEFAULT_STALE_AFTER_MS = 10 * 60_000;

export interface SessionSnapshot {
  readonly state: QueueState | null;
  readonly etas: readonly Eta[];
  /** The server's clock at the last update — what `<FreshnessLine>` renders. */
  readonly lastServerTs: string | null;
  /** The highest sequence folded, sent on reconnect to resume (`SY-01`). */
  readonly lastSeq: number;
  readonly connected: boolean;
}

export interface SessionChannelOptions {
  readonly url: string;
  readonly sessionId: string;
  readonly getToken: () => string | null;
  readonly onSnapshot: (snapshot: SessionSnapshot) => void;
  /** Raised when the server refuses something, e.g. a scope failure. */
  readonly onError?: (code: string, message: string) => void;
  readonly staleAfterMs?: number;
}

/**
 * Opens the channel and keeps a snapshot current.
 *
 * Returns a handle rather than taking over: the caller decides when to close
 * it, and `isStale(now)` is asked rather than pushed, so a component can
 * re-evaluate on its own tick without this file owning a timer.
 */
export function openSessionChannel(options: SessionChannelOptions): {
  readonly close: () => void;
  readonly snapshot: () => SessionSnapshot;
  readonly isStale: (now?: Date) => boolean;
  readonly socket: Socket;
} {
  let snapshot: SessionSnapshot = {
    state: null,
    etas: [],
    lastServerTs: null,
    lastSeq: 0,
    connected: false,
  };

  const publish = (next: Partial<SessionSnapshot>): void => {
    snapshot = { ...snapshot, ...next };
    options.onSnapshot(snapshot);
  };

  const socket = io(options.url, {
    auth: (cb: (data: Record<string, unknown>) => void) => {
      cb({ token: options.getToken() });
    },
    transports: ['websocket', 'polling'],

    /**
     * Each channel gets its own connection.
     *
     * `io(url)` otherwise caches a Manager per URL and hands the same one back
     * to the next caller. Closing a channel closes that shared Manager, so the
     * next `openSessionChannel` — after a session switch, or React's
     * development double-mount — inherits a dead engine and never finishes its
     * handshake. The browser reports it as "closed before the connection is
     * established", which says nothing about the cause.
     */
    forceNew: true,
    // Socket.IO's own backoff. Capped at ten seconds for the same reason the
    // queue's retry is capped: a console must notice the network returning
    // within a few seconds, not a few minutes.
    reconnection: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });

  socket.on('connect', () => {
    publish({ connected: true });
    // The resume handshake: tell the server how far we got and receive what
    // followed, in order, before any live event (`SY-01`). On a first connect
    // `lastSeq` is 0 and the server sends the state instead.
    socket.emit('session:subscribe', {
      sessionId: options.sessionId,
      lastSeq: snapshot.lastSeq > 0 ? snapshot.lastSeq : undefined,
    });
  });

  socket.on('disconnect', () => {
    // The state stays on screen. A console that blanks when the wifi drops is
    // useless precisely when a receptionist most needs the queue in front of
    // her — the freshness line is what tells her it has stopped moving
    // (`FR-OFF-02`, `PRD.md` §3.2).
    publish({ connected: false });
  });

  socket.on(
    'queue.updated',
    (message: { seq: number; serverTs: string; data: { state: QueueState; etas: Eta[] } }) => {
      publish({
        state: message.data.state,
        etas: message.data.etas,
        lastServerTs: message.serverTs,
        lastSeq: Math.max(snapshot.lastSeq, message.seq),
      });
    },
  );

  // Replayed events from the resume handshake. The authoritative state follows
  // them in a `queue.updated`, so what these advance is the cursor — which is
  // what a *second* reconnect will resume from.
  socket.on('queue.event', (message: { seq: number }) => {
    publish({ lastSeq: Math.max(snapshot.lastSeq, message.seq) });
  });

  socket.on('error.occurred', (message: { data: { code: string; message: string } }) => {
    options.onError?.(message.data.code, message.data.message);
  });

  return {
    close: () => {
      socket.disconnect();
    },
    snapshot: () => snapshot,
    isStale: (now = new Date()) =>
      isStale(snapshot.lastServerTs, now, options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS),
    socket,
  };
}

/**
 * Whether a figure last confirmed at `lastServerTs` should be labelled stale.
 *
 * Never having heard from the server counts as stale. That is the honest
 * answer — the number on screen is a guess until something confirms it — and
 * it is what stops a console showing yesterday's queue as though it were live
 * (`FR-OFF-03`, `FR-OFF-05`).
 */
export function isStale(lastServerTs: string | null, now: Date, staleAfterMs: number): boolean {
  if (lastServerTs === null) return true;

  const age = now.getTime() - new Date(lastServerTs).getTime();
  return age >= staleAfterMs;
}
