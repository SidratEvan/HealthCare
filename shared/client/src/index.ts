/**
 * `@platform/client` — the API client, the session channel and the offline
 * queue (FRONTEND.md §10, §11).
 *
 * Everything here is framework-free on purpose. The console's React hooks are
 * thin wrappers around these objects, which means the parts that are hard to
 * get right — the offline queue's ordering and retry, the resume handshake,
 * the staleness rule — are testable in plain Node rather than only through a
 * rendered component.
 */

export {
  MAX_ATTEMPTS,
  OfflineQueue,
  createMemoryStore,
  retryDelayMs,
  type FlushOutcome,
  type PendingEvent,
  type PendingStore,
  type PushTransport,
} from './offline/queue.js';

export { createDexieStore, openConsoleDatabase } from './offline/store.dexie.js';

export {
  ApiClient,
  ApiError,
  NetworkError,
  createSyncApi,
  type ApiClientOptions,
  type SyncPullResponse,
  type SyncPushResponse,
} from './api/client.js';

export {
  DEFAULT_STALE_AFTER_MS,
  isStale,
  openSessionChannel,
  type SessionChannelOptions,
  type SessionSnapshot,
} from './realtime/session.js';
