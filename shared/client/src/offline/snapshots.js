/** How long a kept queue is worth showing (`SY-06`). */
export const MAX_KEPT_HOURS = 24;

/** Whether a kept queue is recent enough to open the console on. */
export function isUsable(snapshot, now) {
  const age = now.getTime() - Date.parse(snapshot.keptAt);
  return Number.isFinite(age) && age >= 0 && age < MAX_KEPT_HOURS * 3_600_000;
}

/**
 * Reads a chamber's kept queue, dropping it when it is too old to show.
 *
 * Never throws: a console that cannot read its own storage opens as it always
 * did, on whatever the server says.
 */
export async function readKept(store, sessionId, now) {
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
export function createMemorySnapshotStore() {
  const rows = new Map();

  return {
    // async without an await: it satisfies the async interface
    async get(sessionId) {
      return rows.get(sessionId) ?? null;
    },
    // async without an await: it satisfies the async interface
    async put(snapshot) {
      rows.set(snapshot.sessionId, snapshot);
    },
    // async without an await: it satisfies the async interface
    async remove(sessionId) {
      rows.delete(sessionId);
    },
  };
}
