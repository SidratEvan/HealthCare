/**
 * The per-route offline outbox, shared by the ward board and the ER console
 * (`FR-OFF-01`, FRONTEND.md §11.1).
 *
 * "Reception, ward, and emergency consoles are offline-first: full read and
 * write capability without internet, with visible offline status and
 * pending-sync count." The queue has its own outbox, built around one
 * session's batch endpoint (`OfflineQueue`). Beds and emergency cases have no
 * batch endpoint: each action is its own route, replay-safe on its own. This
 * is the protocol for that shape, written once, so the two consoles cannot
 * come to disagree about what a flush does.
 *
 * ## What a flush does with each answer
 *
 *   - **accepted** — removed; the server has it.
 *   - **refused** (400, 403, 404, 409, 422) — removed and reported, because it
 *     will be refused however often it is sent; the screen rolls it back
 *     (`SY-03`). The next entry is still sent: a later action may be about
 *     something else entirely.
 *   - **did not arrive** — the flush stops there and everything from that
 *     entry on stays queued, in order. Sending the fourth action while the
 *     third is stuck would apply them out of order.
 */

/** What every queued action carries, whatever it is about. */
export interface OutboxEntry {
  /** The idempotency key, generated at the moment of the tap (`SY-02`). */
  readonly clientEventId: string;
  readonly hospitalId: string;
  /** The console's clock. Orders the outbox only (`SY-01`). */
  readonly clientTs: string;
  readonly attempts: number;
}

export interface OutboxStore<T extends OutboxEntry> {
  all(): Promise<T[]>;
  put(action: T): Promise<void>;
  remove(clientEventIds: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

/** In memory, as the reception console's outbox is today (`docs/STATUS.md`, decision 37). */
export function createMemoryOutboxStore<T extends OutboxEntry>(): OutboxStore<T> {
  const rows = new Map<string, T>();

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
export type SendOutcome =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refused'; readonly code: string; readonly reason: string }
  | { readonly kind: 'unreachable' };

export interface FlushOutcome {
  readonly accepted: readonly string[];
  readonly refused: readonly {
    readonly clientEventId: string;
    readonly code: string;
    readonly reason: string;
  }[];
  /** True when an entry did not reach the server; it and everything after it stay queued. */
  readonly offline: boolean;
}

export class Outbox<T extends OutboxEntry> {
  constructor(private readonly store: OutboxStore<T>) {}

  async pending(): Promise<T[]> {
    return await this.store.all();
  }

  async enqueue(action: Omit<T, 'attempts'>): Promise<void> {
    await this.store.put({ ...action, attempts: 0 } as T);
  }

  /** Sends everything queued for one hospital, oldest first. */
  async flush(
    hospitalId: string,
    send: (action: T) => Promise<SendOutcome>,
  ): Promise<FlushOutcome> {
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

function byClientTimestamp(a: OutboxEntry, b: OutboxEntry): number {
  if (a.clientTs === b.clientTs) return a.clientEventId < b.clientEventId ? -1 : 1;
  return a.clientTs < b.clientTs ? -1 : 1;
}
