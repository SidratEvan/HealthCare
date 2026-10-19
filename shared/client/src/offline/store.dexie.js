/**
 * The browser implementation of the console's outboxes (FRONTEND.md §9: Dexie).
 *
 * Deliberately thin. Everything about *what an outbox does* — ordering, retry,
 * what happens to a conflicted or a stuck entry — lives in `queue.js` and
 * `outbox.ts` behind an interface, so it is testable in Node. This file is
 * only the part that genuinely needs IndexedDB, and there is nothing in it
 * worth a unit test that a fake would not also pass; `offline-console.spec.ts`
 * proves it in a real browser, across a closed tab.
 *
 * IndexedDB rather than localStorage: a shift's worth of events is more than
 * localStorage should hold, it is synchronous and blocks the main thread, and
 * it has no index to read them back in order with.
 */

import Dexie from 'dexie';

/**
 * Bumped only when the stored shape changes; Dexie migrates on open.
 *
 * 1 — the three outboxes (plan 1.5). 2 — `snapshots`, the last queue a
 * console was told, so it can open with no network (plan 1.6).
 */
const OUTBOXES = {
  pending: 'clientEventId, sessionId, clientTs',
  bedActions: 'clientEventId, hospitalId, clientTs',
  erActions: 'clientEventId, hospitalId, clientTs',
};

/**
 * Opens (or creates) one person's local database on this device.
 *
 * Each table is keyed by `clientEventId` and indexed on what its reads filter
 * and sort by: the session or the hospital, and the console's own clock.
 */
export function openConsoleDatabase(name) {
  const database = new Dexie(name);
  database.version(1).stores(OUTBOXES);
  database.version(2).stores({ ...OUTBOXES, snapshots: 'sessionId, keptAt' });
  return database;
}

export function createDexieStore(database) {
  return {
    async all() {
      // Sorted here rather than in memory so a long offline shift does not
      // load and re-sort the whole table on every render.
      return await database.pending.orderBy('clientTs').toArray();
    },

    async put(event) {
      await database.pending.put(event);
    },

    async remove(clientEventIds) {
      await database.pending.bulkDelete([...clientEventIds]);
    },

    async clear() {
      await database.pending.clear();
    },
  };
}

/** The same four operations over a bed or an ER table. */
export function createDexieOutboxStore(table) {
  return {
    async all() {
      return await table.orderBy('clientTs').toArray();
    },

    async put(action) {
      await table.put(action);
    },

    async remove(clientEventIds) {
      await table.bulkDelete([...clientEventIds]);
    },

    async clear() {
      await table.clear();
    },
  };
}

/** One row per chamber: the newest queue this device was told. */
export function createDexieSnapshotStore(database) {
  return {
    async get(sessionId) {
      return (await database.snapshots.get(sessionId)) ?? null;
    },

    async put(snapshot) {
      await database.snapshots.put(snapshot);
    },

    async remove(sessionId) {
      await database.snapshots.delete(sessionId);
    },
  };
}
