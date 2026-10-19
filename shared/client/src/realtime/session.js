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

import { io } from 'socket.io-client';

import { reconnectIfDropped } from './reconnect.js';

/**
 * How long before a live figure is called stale.
 *
 * `hospital_settings.stale_threshold_minutes` defaults to 10 (`FR-OFF-04`) and
 * is the hospital's own setting; this is the fallback for a console that has
 * not loaded its settings yet. Erring short is correct: claiming data is stale
 * when it is fresh costs a glance, and the reverse costs trust.
 */
export const DEFAULT_STALE_AFTER_MS = 10 * 60_000;

/** The most keys a subscribe asks about; the server reads no more. */
export const MAX_UNANSWERED = 500;

/**
 * Whether a `queue.updated` has the shape the queue engine sends.
 *
 * TypeScript used to promise this at compile time, and it no longer can: the
 * client is JavaScript and the server answering it may be either API
 * (docs/django-migration/frontend-js.md). A statement that is not one is
 * dropped rather than folded, so the screen keeps the last state it could
 * trust and its freshness line ages honestly (`PRD.md` §3.2) instead of
 * drawing a queue from a malformed message.
 */
export function isQueueStatement(message) {
  return (
    typeof message === 'object' &&
    message !== null &&
    Number.isInteger(message.seq) &&
    message.seq >= 0 &&
    typeof message.serverTs === 'string' &&
    typeof message.data === 'object' &&
    message.data !== null &&
    typeof message.data.state === 'object' &&
    message.data.state !== null &&
    Array.isArray(message.data.etas) &&
    (message.applied === undefined || Array.isArray(message.applied))
  );
}

/** Whether a replayed `queue.event` carries the sequence the cursor needs. */
export function isQueueEvent(message) {
  return (
    typeof message === 'object' &&
    message !== null &&
    Number.isInteger(message.seq) &&
    message.seq >= 0
  );
}

/**
 * Takes one statement of the queue: what to show, and what it named.
 *
 * A statement older than the queue already held is not shown (`foldUpdate`),
 * but what it names is still reported. The queue held is newer than the
 * statement, so it already contains every action the statement names, and a
 * console may stop drawing them: the rule is "the first statement that names
 * the action" (`SY-08`), not "the first that is also the newest".
 */
export function takeStatement(snapshot, stateSeq, message) {
  const applied = message.applied ?? [];
  const folded = foldUpdate(snapshot, stateSeq, message);
  if (folded === null) return { snapshot, stateSeq, shown: false, applied };
  return { snapshot: folded.snapshot, stateSeq: folded.stateSeq, shown: true, applied };
}

/**
 * Folds a `queue.updated` into the snapshot, or refuses it when it is older
 * than the state already held.
 *
 * Two messages can arrive out of order on one socket. Joining a room and
 * reading the state to catch the client up are two steps on the server, and
 * a queue action that commits between them is broadcast to the room *before*
 * the catch-up — which was read a moment earlier and describes the queue
 * without it. Taken last-wins, the older state replaced the newer one and the
 * screen sat on the patient already sent out, until the next action happened
 * to correct it (`FR-QUE-05`: every device converges on the log). The state's
 * own sequence says which is newer, so the older one is dropped; its
 * `lastSeq` still counts, since it is never higher than what is held.
 */
export function foldUpdate(snapshot, stateSeq, message) {
  if (snapshot.state !== null && message.seq < stateSeq) return null;
  return {
    stateSeq: message.seq,
    snapshot: {
      ...snapshot,
      state: message.data.state,
      etas: message.data.etas,
      lastServerTs: message.serverTs,
      lastSeq: Math.max(snapshot.lastSeq, message.seq),
    },
  };
}

/**
 * Where a channel begins: with nothing, or with what the device kept.
 *
 * Never connected — the socket has not spoken yet, whatever is on the screen.
 * The kept state's own sequence is what an incoming `queue.updated` is
 * compared with, so a server catching the device up from an older point cannot
 * roll the screen back behind what it already showed.
 */
export function startingFrom(initial) {
  if (initial === undefined) {
    return {
      snapshot: { state: null, etas: [], lastServerTs: null, lastSeq: 0, connected: false },
      stateSeq: -1,
    };
  }
  return {
    snapshot: { ...initial, connected: false },
    stateSeq: initial.state?.lastSeq ?? -1,
  };
}

/**
 * Opens the channel and keeps a snapshot current.
 *
 * Returns a handle rather than taking over: the caller decides when to close
 * it, and `isStale(now)` is asked rather than pushed, so a component can
 * re-evaluate on its own tick without this file owning a timer.
 */
export function openSessionChannel(options) {
  const start = startingFrom(options.initial);
  let snapshot = start.snapshot;

  /** The sequence the held `state` describes — not `lastSeq`, which events also raise. */
  let stateSeq = start.stateSeq;

  const publish = (next) => {
    snapshot = { ...snapshot, ...next };
    options.onSnapshot(snapshot);
  };

  const socket = io(options.url, {
    auth: (cb) => {
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

  /** Set by `close`: a channel its owner has closed is never reopened. */
  let closed = false;

  socket.on('connect', () => {
    publish({ connected: true });
    // The resume handshake: tell the server how far we got and receive what
    // followed, in order, before any live event (`SY-01`). On a first connect
    // `lastSeq` is 0 and the server sends the state instead.
    const unanswered = (options.unanswered?.() ?? []).slice(0, MAX_UNANSWERED);
    socket.emit('session:subscribe', {
      sessionId: options.sessionId,
      lastSeq: snapshot.lastSeq > 0 ? snapshot.lastSeq : undefined,
      ...(unanswered.length === 0 ? {} : { unanswered }),
    });
  });

  socket.on('disconnect', (reason) => {
    // A close the server asked for is tried once more with the credential now
    // held: a console given a new sign-in comes back, a revoked one is refused
    // (`reconnect.js`, `FR-SEC-06`).
    reconnectIfDropped(socket, reason, () => closed);

    // The state stays on screen. A console that blanks when the wifi drops is
    // useless precisely when a receptionist most needs the queue in front of
    // her — the freshness line is what tells her it has stopped moving
    // (`FR-OFF-02`, `PRD.md` §3.2).
    publish({ connected: false });
  });

  const fold = (message) => {
    if (!isQueueStatement(message)) return;
    const taken = takeStatement(snapshot, stateSeq, message);
    // Nothing new to show and nothing named: a duplicate, and nobody is told.
    if (!taken.shown && taken.applied.length === 0) return;
    stateSeq = taken.stateSeq;
    snapshot = taken.snapshot;
    options.onSnapshot(snapshot, taken.applied);
  };

  socket.on('queue.updated', fold);

  // Replayed events from the resume handshake. The authoritative state follows
  // them in a `queue.updated`, so what these advance is the cursor — which is
  // what a *second* reconnect will resume from.
  socket.on('queue.event', (message) => {
    if (!isQueueEvent(message)) return;
    publish({ lastSeq: Math.max(snapshot.lastSeq, message.seq) });
  });

  socket.on('error.occurred', (message) => {
    options.onError?.(message.data.code, message.data.message);
  });

  return {
    close: () => {
      closed = true;
      socket.disconnect();
    },
    fold,
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
export function isStale(lastServerTs, now, staleAfterMs) {
  if (lastServerTs === null) return true;

  const age = now.getTime() - new Date(lastServerTs).getTime();
  return age >= staleAfterMs;
}
