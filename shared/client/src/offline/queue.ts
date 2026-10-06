/**
 * The console's offline event queue (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * A reception counter keeps working when the network does not. Every queue
 * action is written here first, applied to local state immediately, and pushed
 * to the server when there is a server to push to. Nothing is lost by being
 * offline; the only difference a receptionist should notice is a number in the
 * corner telling her how much is waiting to go.
 *
 * ## Why the store is an interface
 *
 * The real store is IndexedDB via Dexie (FRONTEND.md §9), which exists in a
 * browser and not in a test runner. Putting the persistence behind a small
 * interface means the queue's actual logic — ordering, retry, the pending
 * count, what happens to a conflicted entry — is testable in plain Node,
 * without a headless browser standing in for a decision that has nothing to do
 * with storage.
 *
 * `openConsoleStores` in `./persistent.ts` hands the console the IndexedDB
 * store, which is what makes a reload, a crashed tab or a power cut cost
 * nothing; `createMemoryStore` below is the one the tests use, and what a
 * browser that refuses IndexedDB falls back to — and says so.
 *
 * ## Three ways a push can fail, and they are not the same
 *
 *   - **It never arrived** (no network, or the server said "not now": 401,
 *     403, 429). Everything stays queued, in order. Being offline for an hour
 *     is not a fault.
 *   - **The server refused one entry by its rules** — a conflict (`SY-03`).
 *     That entry is removed and its row rolls back; the rest go.
 *   - **The server answered and could not take the batch** (a 4xx on the
 *     request, a 5xx). Retrying the same batch forever is how one bad entry
 *     used to block every action behind it for the rest of the shift. So the
 *     batch is sent again one entry at a time, the one that cannot go is set
 *     aside as *stuck* — kept, shown, never silently dropped — and the entries
 *     behind it are sent.
 */

import type { QueueEventType } from '@platform/domain';

import { ApiError } from '../api/client.js';

import type { QueueUpdatedMessage } from '../realtime/session.js';

/** An action taken locally, waiting to reach the server. */
export interface PendingEvent {
  /** The idempotency key. Generated once, at the moment of the tap (`SY-02`). */
  readonly clientEventId: string;
  readonly sessionId: string;
  readonly type: QueueEventType;
  readonly payload: Record<string, unknown>;
  /** The console's clock. Orders the batch within itself only (`SY-01`). */
  readonly clientTs: string;
  /** How many times a push has been attempted and failed. */
  readonly attempts: number;
  /** Set when the server refused it, so the UI can explain and roll back. */
  readonly conflict?: { readonly reason: string; readonly code: string };
  /**
   * Set when the server answered and could not take this entry.
   *
   * A stuck entry is no longer sent and no longer folded into the screen, and
   * it no longer blocks what is queued behind it. It stays in the store until
   * the operator sends it again or discards it — an action a receptionist took
   * and the system silently dropped is the worst outcome this design can
   * produce.
   */
  readonly stuck?: { readonly code: string };
}

/** What the queue needs from storage, and nothing more. */
export interface PendingStore {
  all(): Promise<PendingEvent[]>;
  put(event: PendingEvent): Promise<void>;
  remove(clientEventIds: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory store, for tests and for a browser with no IndexedDB. */
export function createMemoryStore(): PendingStore {
  const rows = new Map<string, PendingEvent>();

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async all() {
      return [...rows.values()].sort(byClientTimestamp);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async put(event) {
      rows.set(event.clientEventId, event);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async remove(clientEventIds) {
      for (const id of clientEventIds) rows.delete(id);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async clear() {
      rows.clear();
    },
  };
}

/**
 * The result of one push attempt, as the console needs to act on it.
 */
export interface FlushOutcome {
  /** Entries the server took. Removed from the queue. */
  readonly accepted: readonly string[];
  /**
   * The same entries with the event each became, where the server said. An
   * action already sent is undone by that id (`GR-02`); the console's own key
   * means nothing to the undo route.
   */
  readonly acceptedEvents: readonly {
    readonly clientEventId: string;
    readonly eventId: string;
  }[];
  /** Entries the server refused. Removed, and the row rolls back (`SY-03`). */
  readonly conflicted: readonly { readonly clientEventId: string; readonly reason: string }[];
  /** Entries set aside in this flush because the server could not take them. */
  readonly stuck: readonly string[];
  /** True when the push never reached the server; everything stays queued. */
  readonly offline: boolean;
  /**
   * The queue as the server holds it with this flush in it (`SY-05`) — the
   * newest, when the batch went in more than one push. Null when the server
   * said nothing.
   *
   * It is what a broadcast on the session channel carries, arriving by
   * another road, and the console shows it the moment it drops the entries
   * above from its screen (FRONTEND.md §11.1 step 4). Dropping them and
   * waiting for the broadcast showed the queue *before* the tap for as long
   * as the broadcast was the slower of the two.
   */
  readonly update: QueueUpdatedMessage | null;
}

/** What `flush` needs to talk to the server. Injected, so it can be faked. */
export type PushTransport = (
  sessionId: string,
  events: readonly PendingEvent[],
) => Promise<{
  readonly accepted: readonly { readonly clientEventId: string; readonly eventId?: string }[];
  readonly conflicts: readonly {
    readonly clientEventId: string;
    readonly reason: string;
    readonly code: string;
  }[];
  /** The queue with the batch in it, as the server answered (`SY-05`). */
  readonly update?: QueueUpdatedMessage;
}>;

/**
 * How many times the server may fail to take an entry before it is set aside.
 *
 * Counted only against answers from the server. A dead network is not a
 * failure of the entry, and an hour offline must not mark a shift's work as
 * stuck.
 */
export const MAX_ATTEMPTS = 8;

const NOTHING: FlushOutcome = {
  accepted: [],
  acceptedEvents: [],
  conflicted: [],
  stuck: [],
  offline: false,
  update: null,
};

export class OfflineQueue {
  constructor(private readonly store: PendingStore) {}

  /** Everything still waiting to go, oldest first. Stuck entries are not. */
  async pending(): Promise<PendingEvent[]> {
    return (await this.store.all()).filter((event) => event.stuck === undefined);
  }

  /** The number the console shows in its offline block (`FR-OFF-01`). */
  async pendingCount(): Promise<number> {
    return (await this.pending()).length;
  }

  /** The sessions with something waiting — after a reload there may be several. */
  async sessions(): Promise<string[]> {
    return [...new Set((await this.pending()).map((event) => event.sessionId))];
  }

  /**
   * Records an action taken locally.
   *
   * The key is generated by the caller at the moment of the tap rather than
   * here, because the same key has to travel with the optimistic update so a
   * later conflict can be matched back to the row it belongs to.
   */
  async enqueue(event: Omit<PendingEvent, 'attempts'>): Promise<void> {
    await this.store.put({ ...event, attempts: 0 });
  }

  /**
   * Pushes everything queued for one session.
   *
   * Entries the server accepted or refused are both removed: an accepted one
   * is in the log, and a refused one will never be accepted however many times
   * it is sent (`SY-03` — it lost a race that is already over). A push that
   * never arrived leaves the queue intact, which is what makes a dropped
   * connection cost nothing. A batch the server could not take is sent again
   * entry by entry, so one bad entry is set aside instead of blocking the
   * rest.
   */
  async flush(sessionId: string, push: PushTransport): Promise<FlushOutcome> {
    const queued = (await this.pending()).filter((event) => event.sessionId === sessionId);
    if (queued.length === 0) return NOTHING;

    try {
      return await this.send(sessionId, queued, push);
    } catch (error) {
      if (!couldNotTake(error)) {
        // The push never landed. Everything stays queued, in order.
        return { ...NOTHING, offline: true };
      }
    }

    return await this.isolate(sessionId, queued, push);
  }

  /** One push, and what to do with the server's answer. Throws if there is none. */
  private async send(
    sessionId: string,
    events: readonly PendingEvent[],
    push: PushTransport,
  ): Promise<FlushOutcome> {
    const result = await push(sessionId, events);

    const accepted = result.accepted.map((entry) => entry.clientEventId);
    const acceptedEvents = result.accepted.flatMap((entry) =>
      entry.eventId === undefined
        ? []
        : [{ clientEventId: entry.clientEventId, eventId: entry.eventId }],
    );
    const conflicted = result.conflicts.map((entry) => ({
      clientEventId: entry.clientEventId,
      reason: entry.reason,
    }));

    await this.store.remove([...accepted, ...conflicted.map((entry) => entry.clientEventId)]);
    return {
      accepted,
      acceptedEvents,
      conflicted,
      stuck: [],
      offline: false,
      update: result.update ?? null,
    };
  }

  /**
   * Sends a batch the server could not take, one entry at a time, in order.
   *
   * The entry that fails is the reason the batch did. If the server will
   * refuse it however often it is sent (a 4xx), or has failed to take it
   * `MAX_ATTEMPTS` times, it is set aside and the next entry goes. Before
   * that it may yet succeed — the server may simply be restarting — so the
   * flush stops there and nothing behind it is sent out of order.
   */
  private async isolate(
    sessionId: string,
    queued: readonly PendingEvent[],
    push: PushTransport,
  ): Promise<FlushOutcome> {
    const accepted: string[] = [];
    const acceptedEvents: { clientEventId: string; eventId: string }[] = [];
    const conflicted: { clientEventId: string; reason: string }[] = [];
    const stuck: string[] = [];
    let update: QueueUpdatedMessage | null = null;

    for (const event of queued) {
      try {
        const one = await this.send(sessionId, [event], push);
        accepted.push(...one.accepted);
        acceptedEvents.push(...one.acceptedEvents);
        conflicted.push(...one.conflicted);
        update = newerOf(update, one.update);
      } catch (error) {
        if (!couldNotTake(error)) {
          return { accepted, acceptedEvents, conflicted, stuck, offline: true, update };
        }

        const attempts = event.attempts + 1;
        const final = willNeverBeTaken(error) || attempts >= MAX_ATTEMPTS;
        await this.store.put(
          final ? { ...event, attempts, stuck: { code: error.code } } : { ...event, attempts },
        );

        if (!final) {
          return { accepted, acceptedEvents, conflicted, stuck, offline: false, update };
        }
        stuck.push(event.clientEventId);
      }
    }

    return { accepted, acceptedEvents, conflicted, stuck, offline: false, update };
  }

  /**
   * Takes back actions that have not been sent (`GR-02`).
   *
   * Nothing has left the device, so there is nothing to compensate: the action
   * is simply never sent, and no event is written for something that was
   * undone before the server heard of it. Returns the keys it actually held —
   * anything else has already gone and needs the undo route instead.
   */
  async discard(clientEventIds: readonly string[]): Promise<string[]> {
    const wanted = new Set(clientEventIds);
    const held = (await this.store.all())
      .map((event) => event.clientEventId)
      .filter((key) => wanted.has(key));

    await this.store.remove(held);
    return held;
  }

  /** Entries the server could not take, for the operator to act on. */
  async stuck(): Promise<PendingEvent[]> {
    return (await this.store.all()).filter((event) => event.stuck !== undefined);
  }

  /**
   * Puts stuck entries back in the queue to be sent again, in their place.
   *
   * For the case where the fault was the server's and has been fixed: the
   * actions were real, and sending them again is better than retyping them.
   */
  async retryStuck(): Promise<void> {
    for (const event of await this.stuck()) {
      const { stuck: _stuck, ...rest } = event;
      await this.store.put({ ...rest, attempts: 0 });
    }
  }

  /** Used after a forced re-pull (`SY-06`), where the local log is discarded. */
  async clear(): Promise<void> {
    await this.store.clear();
  }
}

/**
 * Whether the server answered and could not take what it was sent.
 *
 * 401, 403 and 429 are "not now": a token to renew, a password to change, a
 * limit to wait out. The entries are fine and stay queued, as they do when the
 * network is down.
 */
function couldNotTake(error: unknown): error is ApiError {
  return error instanceof ApiError && ![401, 403, 429].includes(error.status);
}

/** Of two answers from the server, the one that describes the later queue. */
function newerOf(
  held: QueueUpdatedMessage | null,
  next: QueueUpdatedMessage | null,
): QueueUpdatedMessage | null {
  if (next === null) return held;
  return held === null || next.seq >= held.seq ? next : held;
}

/** A request the server will refuse however often it is sent. */
function willNeverBeTaken(error: ApiError): boolean {
  return error.status >= 400 && error.status < 500;
}

/**
 * Retry delay for attempt `n`, in milliseconds.
 *
 * Exponential from one second, capped at thirty. The cap matters more than the
 * curve: a console that has been offline for an hour must retry often enough
 * to notice the network within half a minute of it returning, or a receptionist
 * stands there wondering why the pending count is not moving.
 *
 * Deterministic rather than jittered. There is one console per counter, not a
 * thundering herd, and a predictable delay is one an operator can be told
 * about ("it will try again in a few seconds").
 */
export function retryDelayMs(attempts: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.max(0, attempts));
}

function byClientTimestamp(a: PendingEvent, b: PendingEvent): number {
  if (a.clientTs === b.clientTs) return a.clientEventId < b.clientEventId ? -1 : 1;
  return a.clientTs < b.clientTs ? -1 : 1;
}
