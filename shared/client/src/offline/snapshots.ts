/**
 * The queue as a console was last told it, kept so the console can open with
 * no network (`FR-OFF-01`, FRONTEND.md §9: "cached session state").
 *
 * A counter that reloads during an outage has no server to ask what the queue
 * is. What it can show is what it was last *told* — with the server's own
 * timestamp beside it, so the screen says how old that is rather than passing
 * it off as current (`FR-OFF-03`, PRD.md §3.2). Actions taken on top of it are
 * queued like any others and reconciled when the connection returns.
 *
 * ## What is kept, and what is not
 *
 * The reduced state: serials, statuses, times, booking and patient *ids*. No
 * names and no phone numbers — those come from a separate, audited read, and a
 * queue that shows serials without names for the length of an outage is a
 * smaller cost than patient names sitting in a browser's storage.
 *
 * ## For how long
 *
 * A day. `SY-06` already says a device that far behind starts over rather than
 * catching up, and yesterday's chamber is not a queue anybody should be shown
 * as though it might still be running.
 */

import type { Eta, QueueState } from '@platform/domain';

/** One chamber's queue, as this device last heard it from the server. */
export interface KeptSnapshot {
  readonly sessionId: string;
  readonly state: QueueState;
  readonly etas: readonly Eta[];
  /** The server's clock at that update — what the freshness line counts from. */
  readonly lastServerTs: string | null;
  readonly lastSeq: number;
  /** This device's clock when it was kept, for deciding when to let it go. */
  readonly keptAt: string;
}

export interface SnapshotStore {
  get(sessionId: string): Promise<KeptSnapshot | null>;
  put(snapshot: KeptSnapshot): Promise<void>;
  remove(sessionId: string): Promise<void>;
}

/** How long a kept queue is worth showing (`SY-06`). */
export const MAX_KEPT_HOURS = 24;

/** Whether a kept queue is recent enough to open the console on. */
export function isUsable(snapshot: KeptSnapshot, now: Date): boolean {
  const age = now.getTime() - Date.parse(snapshot.keptAt);
  return Number.isFinite(age) && age >= 0 && age < MAX_KEPT_HOURS * 3_600_000;
}

/**
 * Reads a chamber's kept queue, dropping it when it is too old to show.
 *
 * Never throws: a console that cannot read its own storage opens as it always
 * did, on whatever the server says.
 */
export async function readKept(
  store: SnapshotStore,
  sessionId: string,
  now: Date,
): Promise<KeptSnapshot | null> {
  try {
    const kept = await store.get(sessionId);
    if (kept === null) return null;
    if (isUsable(kept, now)) return kept;

    await store.remove(sessionId);
    return null;
  } catch {
    return null;
  }
}

/** In memory: for tests, and for a browser with no IndexedDB. */
export function createMemorySnapshotStore(): SnapshotStore {
  const rows = new Map<string, KeptSnapshot>();

  return {
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async get(sessionId) {
      return rows.get(sessionId) ?? null;
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async put(snapshot) {
      rows.set(snapshot.sessionId, snapshot);
    },
    // eslint-disable-next-line @typescript-eslint/require-await -- satisfies the async interface
    async remove(sessionId) {
      rows.delete(sessionId);
    },
  };
}
