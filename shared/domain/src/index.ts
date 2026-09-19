/**
 * `@platform/domain` — the shared brain (BACKEND.md §2).
 *
 * No I/O. Pure functions and types, imported unchanged by the API, the
 * workers, the consoles and the patient app. That shared import is not a
 * convenience: it is the mechanism that guarantees a reception console and the
 * server can never disagree about what a queue event means (FR-QUE-05).
 *
 * The queue reducer exists here and nowhere else (CLAUDE.md §7).
 */

// --- Types -----------------------------------------------------------------
export * from './types/ids.js';
export * from './types/enums.js';
export * from './types/events.js';
export * from './types/entities.js';

// --- The queue engine ------------------------------------------------------
export {
  activeQueue,
  checkInvariants,
  emptyState,
  findEntry,
  indexOfEntry,
  nowServing,
  patientsAhead,
  pendingOffers,
  project,
  queueCounts,
  waitingQueue,
  type QueueAnomaly,
  type QueueCounts,
  type QueueEntry,
  type QueueSeed,
  type QueueState,
  type QueueStateProjection,
  type RateState,
  type RosterBooking,
  type SessionPlan,
  type SlotOfferState,
} from './queue/state.js';

export { reduce } from './queue/reducer.js';

export {
  applyBatch,
  continueReplay,
  needsFullRebuild,
  orderEvents,
  replay,
  type BatchOutcome,
} from './queue/replay.js';

export {
  clampConsultSeconds,
  currentRateSeconds,
  isMeasured,
  observeConsult,
  rateSpreadSeconds,
  seedRate,
  MAX_CONSULT_SECONDS,
  MIN_CONSULT_SECONDS,
  RATE_ALPHA,
  RATE_WINDOW,
} from './queue/rate.js';

export {
  bandMinutes,
  computeEtas,
  etaFor,
  projectedEnd,
  shouldLeaveNow,
  twoAwayBookings,
  MAX_BAND_MINUTES,
  MIN_BAND_MINUTES,
  type Eta,
  type EtaOptions,
} from './queue/eta.js';

export {
  canAddWalkin,
  canCallNext,
  canDeclareDelay,
  canDeclareDoctorArrived,
  canDeclareLate,
  canMarkDone,
  canMarkNoShow,
  canPause,
  canReinstate,
  canReorder,
  canResume,
  graceRemaining,
  graceWindowMinutes,
  hasCapacity,
  lateReinsertIndex,
  nextToCall,
  DEFAULT_QUEUE_SETTINGS,
  MAX_DELAY_MINUTES,
  type GuardResult,
  type QueueGuardCode,
  type QueueSettings,
} from './queue/rules.js';

// --- Validation schemas ----------------------------------------------------
//
// Shared with the client (BACKEND.md §0): the console builds its offline queue
// from the same types the API validates with, so an action a console can
// construct is an action the server will accept.
export * from './schemas/queue.schema.js';
export * from './schemas/sync.schema.js';

// --- Utilities -------------------------------------------------------------
export * as money from './util/money.js';
export * as time from './util/time.js';
