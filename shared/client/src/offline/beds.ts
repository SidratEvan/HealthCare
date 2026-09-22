/**
 * The ward console's offline outbox (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet, with visible offline status and
 * pending-sync count." Step 8 built that for the queue; this is the same
 * promise for beds.
 *
 * ## Why it is not the queue's outbox
 *
 * The queue's `OfflineQueue` is built around one session's log: it flushes a
 * session at a time, in one batch, to `/sync/push`, and its entries are queue
 * events. A bed action has no session and no batch endpoint — each one is its
 * own route (BACKEND.md §7.5), and each route is replay-safe on its own,
 * because `bed_events.client_event_id` is unique. So the ward's outbox sends
 * its entries one at a time, oldest first, to the route each names, and a
 * replayed admit comes back as the admit it already was (`SY-02`).
 *
 * Reusing the queue's class would have meant widening a type the reception
 * console and its tests depend on, for a transport that works differently.
 *
 * ## What a flush does with each answer
 *
 *   - **accepted** — removed; the server has it.
 *   - **refused** (400, 403, 404, 409, 422) — removed and reported, because it
 *     will be refused however often it is sent; the board rolls it back
 *     (`SY-03`). The next entry is still sent: a later action may be about a
 *     different bed entirely.
 *   - **did not arrive** — the flush stops there and everything from that
 *     entry on stays queued, in order. Sending the fourth action while the
 *     third is stuck would apply them out of order.
 */

import type { LocalBedChange } from '@platform/domain';

/** One ward action, taken locally, waiting to reach the server. */
export interface PendingBedAction {
  /** The idempotency key, generated at the moment of the tap (`SY-02`). */
  readonly clientEventId: string;
  readonly hospitalId: string;
  readonly bedId: string;
  /** The route, e.g. `/beds/<id>/admit`. */
  readonly path: string;
  /** The body, without the envelope — `clientEventId` and `clientTs` are added when sent. */
  readonly body: Record<string, unknown>;
  /** The console's clock. Orders the outbox only (`SY-01`). */
  readonly clientTs: string;
  readonly attempts: number;
  /** What the board applies before the server answers. Null for a change it cannot draw. */
  readonly change: LocalBedChange | null;
}

export interface BedActionStore {
  all(): Promise<PendingBedAction[]>;
  put(action: PendingBedAction): Promise<void>;
  remove(clientEventIds: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

/** In memory, as the reception console's outbox is today. */
export function createMemoryBedStore(): BedActionStore {
  const rows = new Map<string, PendingBedAction>();

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async all() {
      return [...rows.values()].sort(byClientTimestamp);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async put(action) {
      rows.set(action.clientEventId, action);
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

/** What sending one action produced. Injected, so a test needs no network. */
export type BedSendOutcome =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refused'; readonly code: string; readonly reason: string }
  | { readonly kind: 'unreachable' };

export type BedSender = (action: PendingBedAction) => Promise<BedSendOutcome>;

export interface BedFlushOutcome {
  readonly accepted: readonly string[];
  readonly refused: readonly {
    readonly clientEventId: string;
    readonly code: string;
    readonly reason: string;
  }[];
  /** True when an entry did not reach the server; it and everything after it stay queued. */
  readonly offline: boolean;
}

export class BedOutbox {
  constructor(private readonly store: BedActionStore) {}

  async pending(): Promise<PendingBedAction[]> {
    return await this.store.all();
  }

  async enqueue(action: Omit<PendingBedAction, 'attempts'>): Promise<void> {
    await this.store.put({ ...action, attempts: 0 });
  }

  /** Sends everything queued for one hospital, oldest first. */
  async flush(hospitalId: string, send: BedSender): Promise<BedFlushOutcome> {
    const queued = (await this.store.all()).filter((action) => action.hospitalId === hospitalId);

    const accepted: string[] = [];
    const refused: { clientEventId: string; code: string; reason: string }[] = [];

    for (const [index, action] of queued.entries()) {
      const outcome = await send(action);

      if (outcome.kind === 'unreachable') {
        // Everything from here on waits, in order, with its attempt count
        // raised — which is what drives the stuck warning.
        for (const waiting of queued.slice(index)) {
          await this.store.put({ ...waiting, attempts: waiting.attempts + 1 });
        }
        await this.store.remove([...accepted, ...refused.map((entry) => entry.clientEventId)]);
        return { accepted, refused, offline: true };
      }

      if (outcome.kind === 'accepted') {
        accepted.push(action.clientEventId);
      } else {
        refused.push({
          clientEventId: action.clientEventId,
          code: outcome.code,
          reason: outcome.reason,
        });
      }
    }

    await this.store.remove([...accepted, ...refused.map((entry) => entry.clientEventId)]);
    return { accepted, refused, offline: false };
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }
}

function byClientTimestamp(a: PendingBedAction, b: PendingBedAction): number {
  if (a.clientTs === b.clientTs) return a.clientEventId < b.clientEventId ? -1 : 1;
  return a.clientTs < b.clientTs ? -1 : 1;
}
