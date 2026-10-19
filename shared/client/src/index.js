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

export { MAX_ATTEMPTS, OfflineQueue, createMemoryStore, retryDelayMs } from './offline/queue.js';

export {
  createDexieOutboxStore,
  createDexieStore,
  openConsoleDatabase,
} from './offline/store.dexie.js';

export {
  MAX_KEPT_HOURS,
  createMemorySnapshotStore,
  isUsable,
  readKept,
} from './offline/snapshots.js';

export { consoleDatabaseName, openConsoleStores, ownerOfToken } from './offline/persistent.js';

export { BedOutbox, createMemoryBedStore } from './offline/beds.js';

export { Outbox, createMemoryOutboxStore } from './offline/outbox.js';

export { ErOutbox, createMemoryErStore } from './offline/emergency.js';

export { openHospitalChannel } from './realtime/hospital.js';

export { openEmergencyChannel } from './realtime/emergency.js';

export { ApiClient, ApiError, NetworkError, createQueueApi, createSyncApi } from './api/client.js';

export {
  DEFAULT_STALE_AFTER_MS,
  MAX_UNANSWERED,
  foldUpdate,
  isStale,
  openSessionChannel,
  startingFrom,
  takeStatement,
} from './realtime/session.js';
export {
  WORKSPACE_ROLES,
  workspaceRoles,
  workspaceView,
  workspaceRoleFor,
  assignedDesks,
  deskChambers,
  workspaceRouteAllowed,
} from './workspaces.js';
export { customFollowUpDays, followUpDateIn, followUpDateLabel } from './doctor/followUp.js';
