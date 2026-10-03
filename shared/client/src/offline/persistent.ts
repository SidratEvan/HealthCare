/**
 * Where a console's three outboxes are kept (`FR-OFF-01`).
 *
 * Until this existed, every outbox lived in the page's memory. The Dexie
 * store was written and never called, so a reload, a crashed tab, a laptop
 * going to sleep or a power cut lost everything a counter had done since the
 * network went — the exact failure "offline-first" is supposed to prevent.
 *
 * ## One database per person, per device
 *
 * What waits here is sent, later, with whatever token the console then holds —
 * and the server attributes an event to the token that sent it (`FR-QUE-04`).
 * A database shared by everybody who uses a counter PC would let the evening
 * receptionist's sign-in send the afternoon receptionist's unsent work under
 * her own name. So the database is named for the person: their work waits for
 * *them*, on this device, and goes when they are next signed in here.
 *
 * ## When the browser will not keep it
 *
 * Some browsers refuse IndexedDB (a private window, a locked-down profile).
 * The outbox then falls back to memory, which is what it always was — and
 * `durable()` turns false so the console can say that a reload will lose what
 * is queued, instead of implying a safety that is not there (PRD.md §3.2).
 */

import { createMemoryBedStore, type BedActionStore } from './beds.js';
import { createMemoryErStore, type ErActionStore } from './emergency.js';
import { createMemoryStore, type PendingStore } from './queue.js';
import { createDexieOutboxStore, createDexieStore, openConsoleDatabase } from './store.dexie.js';

export interface ConsoleStores {
  readonly queue: PendingStore;
  readonly beds: BedActionStore;
  readonly emergency: ErActionStore;
  /** False when what is queued lives in this tab only. */
  readonly durable: () => boolean;
}

/** The four operations every store has, whatever it holds. */
interface Store<T> {
  all(): Promise<T[]>;
  put(row: T): Promise<void>;
  remove(clientEventIds: readonly string[]): Promise<void>;
  clear(): Promise<void>;
}

/**
 * Who a token belongs to: the `sub` of its payload.
 *
 * Read without verifying, which is all a database name needs — the server
 * verifies the token on every request, and a forged one sends nothing. A
 * token that cannot be read belongs to `nobody`, whose outbox no signed-in
 * person ever opens.
 */
export function ownerOfToken(token: string | null): string {
  if (token === null) return 'nobody';

  try {
    const payload = token.split('.')[1] ?? '';
    const json = globalThis.atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && /^[0-9a-zA-Z-]{1,64}$/.test(sub) ? sub : 'nobody';
  } catch {
    return 'nobody';
  }
}

/** The IndexedDB database one person's outboxes live in, on this device. */
export function consoleDatabaseName(owner: string): string {
  return `healthcare-console-${owner}`;
}

/** Whether IndexedDB is still being used, and the way to say it has failed. */
interface Health {
  readonly ok: () => boolean;
  readonly fail: () => void;
}

const open = new Map<string, ConsoleStores>();

/**
 * The stores for one signed-in person. Opened once per page and shared, so
 * the three consoles' hooks hold one connection between them.
 */
export function openConsoleStores(owner: string): ConsoleStores {
  // On the server there is no IndexedDB, and nothing may be remembered between
  // one request's render and the next.
  if (typeof indexedDB === 'undefined') return memoryStores();

  const existing = open.get(owner);
  if (existing !== undefined) return existing;

  // One switch for all three: once the browser has refused the database,
  // none of its tables is to be trusted for the rest of the page's life.
  let durable = true;
  const health: Health = {
    ok: () => durable,
    fail: () => {
      durable = false;
    },
  };
  let stores: ConsoleStores;
  try {
    const database = openConsoleDatabase(consoleDatabaseName(owner));
    stores = {
      queue: guarded(createDexieStore(database), createMemoryStore(), health),
      beds: guarded(createDexieOutboxStore(database.bedActions), createMemoryBedStore(), health),
      emergency: guarded(createDexieOutboxStore(database.erActions), createMemoryErStore(), health),
      durable: () => health.ok(),
    };
  } catch {
    stores = memoryStores();
  }

  open.set(owner, stores);
  return stores;
}

function memoryStores(): ConsoleStores {
  return {
    queue: createMemoryStore(),
    beds: createMemoryBedStore(),
    emergency: createMemoryErStore(),
    durable: () => false,
  };
}

/**
 * A store that keeps working when IndexedDB stops.
 *
 * The first operation the browser refuses switches this store, and its two
 * siblings, to memory for the rest of the page's life. A receptionist's tap
 * must never fail because storage did (`FR-OFF-01`); what changes is that the
 * console now says its queue will not survive a reload.
 */
function guarded<T>(primary: Store<T>, fallback: Store<T>, health: Health): Store<T> {
  async function run<R>(onDisk: () => Promise<R>, inMemory: () => Promise<R>): Promise<R> {
    if (!health.ok()) return await inMemory();
    try {
      return await onDisk();
    } catch {
      health.fail();
      return await inMemory();
    }
  }

  return {
    all: async () =>
      await run(
        () => primary.all(),
        () => fallback.all(),
      ),
    put: async (row) => {
      await run(
        () => primary.put(row),
        () => fallback.put(row),
      );
    },
    remove: async (ids) => {
      await run(
        () => primary.remove(ids),
        () => fallback.remove(ids),
      );
    },
    clear: async () => {
      await run(
        () => primary.clear(),
        () => fallback.clear(),
      );
    },
  };
}
