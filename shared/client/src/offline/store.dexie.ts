/**
 * The browser implementation of `PendingStore` (FRONTEND.md §9: Dexie).
 *
 * Deliberately thin. Everything about *what the queue does* — ordering, retry,
 * what happens to a conflicted entry — lives in `queue.ts` behind an interface,
 * so it is testable in Node. This file is only the part that genuinely needs
 * IndexedDB, and there is nothing in it worth a unit test that a fake would not
 * also pass.
 *
 * IndexedDB rather than localStorage: a shift's worth of events is more than
 * localStorage should hold, it is synchronous and blocks the main thread, and
 * it has no index to read them back in order with.
 */

import Dexie, { type EntityTable } from 'dexie';

import type { PendingEvent, PendingStore } from './queue.js';

/** Bumped only when the stored shape changes; Dexie migrates on open. */
const SCHEMA_VERSION = 1;

interface ConsoleDatabase extends Dexie {
  pending: EntityTable<PendingEvent, 'clientEventId'>;
}

/**
 * Opens (or creates) the console's local database.
 *
 * Indexed on `clientEventId` as the key, plus `sessionId` and `clientTs` —
 * the two things every read filters or sorts by.
 */
export function openConsoleDatabase(name = 'healthcare-console'): ConsoleDatabase {
  const database = new Dexie(name) as ConsoleDatabase;
  database.version(SCHEMA_VERSION).stores({
    pending: 'clientEventId, sessionId, clientTs',
  });
  return database;
}

export function createDexieStore(database = openConsoleDatabase()): PendingStore {
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
