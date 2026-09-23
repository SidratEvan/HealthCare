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
export * from './types/specialties.js';

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
  canCheckIn,
  canDeclareDelay,
  canDeclareDoctorArrived,
  canDeclareLate,
  canMarkDone,
  canMarkNoShow,
  canPause,
  canReinstate,
  canAcceptSlot,
  canOfferFreedSlot,
  canReorder,
  canResume,
  graceRemaining,
  graceWindowMinutes,
  hasCapacity,
  lapsedOffers,
  lateReinsertIndex,
  nextToCall,
  DEFAULT_QUEUE_SETTINGS,
  MAX_DELAY_MINUTES,
  MAX_QUOTED_WAIT_MINUTES,
  SLOT_OFFER_WINDOW_MINUTES,
  type GuardResult,
  type QueueGuardCode,
  type QueueSettings,
} from './queue/rules.js';

export { suggestedQuote, QUOTE_STEP_MINUTES } from './queue/quote.js';

// --- Beds ------------------------------------------------------------------
//
// The bed state machine, shared the way the reducer is: the API guards with
// it and the ward console applies it before the server answers (`FR-BED-02`).
export {
  applyLocal,
  canApply,
  canForecastDischarge,
  canReceiveTransfer,
  effectiveState,
  holdLapsed,
  outcomeOf,
  ADMISSION_SOURCES,
  BED_ACTIONS,
  BED_EVENT_TYPES,
  HOLD_MINUTE_CHOICES,
  MAX_HOLD_MINUTES,
  type AdmissionSource,
  type BedAction,
  type BedActionContext,
  type BedEventType,
  type BedGuardCode,
  type BedGuardResult,
  type BedView,
  type LocalBedChange,
  type WardView,
} from './beds/board.js';

export {
  forecastTomorrow,
  mirrorMismatches,
  nextDay,
  tallyByKind,
  type KindForecast,
  type KindTally,
  type PublicCapacity,
} from './beds/capacity.js';

// --- Emergency -------------------------------------------------------------
//
// The case state machine, shared the way the bed board is: the API guards with
// it and the ER console applies it before the server answers (`FR-EMG-01..04`).
// Ranking and freshness are the product's rules for `S-A-10b` (`FR-PAT-43`,
// `FR-PAT-45`), used by the search and by the refer-out suggestion alike.
export {
  alreadyApplied,
  applyLocalCase,
  canActOn,
  expectedArrival,
  inboundOrder,
  isInEr,
  isOnTheWay,
  isOpen,
  loadOf,
  nextTokenLabel,
  tokenLabel,
  triageOrder,
  EMERGENCY_ACTIONS,
  IN_ER_STATES,
  ON_THE_WAY_STATES,
  OPEN_EMERGENCY_STATES,
  type EmergencyAction,
  type EmergencyActionContext,
  type EmergencyCaseView,
  type EmergencyGuardCode,
  type EmergencyGuardResult,
  type LocalEmergencyChange,
} from './emergency/cases.js';

export {
  compareCandidates,
  freeBedsFor,
  needFor,
  rankCandidates,
  relevantBedKind,
  relevantFreeBeds,
  requiredCapability,
  stampsFor,
  stampsForNeed,
  EMERGENCY_SEARCH_RADIUS_METRES,
  PROBLEM_BED_KIND,
  PROBLEM_CAPABILITY,
  type CapacityFigures,
  type EmergencyNeed,
  type RankCandidate,
} from './emergency/ranking.js';

export {
  applyLocalReferral,
  asksForSomething,
  canActOnReferral,
  canRefer,
  defaultNeed,
  incomingOrder,
  isOpenReferral,
  referralAlreadyApplied,
  referralCandidates,
  referralTimeline,
  sideOf,
  OPEN_REFERRAL_STATES,
  REFERRAL_ACTIONS,
  REFERRAL_NOTE_MAX,
  type LocalReferralChange,
  type ReferralAction,
  type ReferralGuardCode,
  type ReferralGuardResult,
  type ReferralParty,
  type ReferralSide,
  type ReferralStep,
  type ReferralSummary,
  type ReferralView,
} from './emergency/referrals.js';

export {
  ageInMinutes,
  freshnessOf,
  oldestStamp,
  DEFAULT_STALE_THRESHOLD_MINUTES,
  type Freshness,
} from './emergency/freshness.js';

// --- The lab and the pharmacy (step 17) ------------------------------------
export {
  applyLocalLabChange,
  canActOnTestOrder,
  canDeliverReport,
  canUploadReport,
  hasReport,
  isOpenTestOrder,
  labOrderAlreadyApplied,
  sortLabQueue,
  LAB_ACTIONS,
  LAB_ACTION_RESULT,
  OPEN_TEST_STATES,
  REPORTED_TEST_STATES,
  type LabAction,
  type LabGuardCode,
  type LabGuardResult,
  type LocalLabChange,
  type TestOrderView,
  type TestReportView,
} from './lab/orders.js';

export {
  openForSeconds,
  summariseTurnaround,
  turnaroundSeconds,
  type TurnaroundSummary,
} from './lab/turnaround.js';

// --- Money (step 18) -------------------------------------------------------
export {
  readRefundPolicy,
  refundFor,
  refundIfCancelledNow,
  REFUND_REASONS,
  type RefundDecision,
  type RefundPolicy,
  type RefundReason,
  type RefundablePayment,
} from './payments/refund.js';

export { settle, type Settlement, type SettlementRow } from './payments/settlement.js';

export {
  rankStockResults,
  stockAnswerFor,
  summariseStockSearch,
  STOCK_ANSWERS,
  STOCK_STALE_THRESHOLD_MINUTES,
  type StockAnswer,
  type StockAvailabilityView,
  type StockFlagView,
  type StockSearchSummary,
} from './lab/stock.js';

// --- Admin analytics -------------------------------------------------------
//
// The arithmetic behind `S-B-10` (`FR-ADM-01..09`). The SQL adds up rows; this
// turns the totals into the figures a hospital director is actually shown, and
// it lives here rather than in the API because the honesty rules it encodes —
// what counts as a loss, when a number is too thin to state — are product
// decisions, not query details.
export {
  lossAndRecovery,
  recoveredValueFor,
  type LossAndRecovery,
  type NoShowTotals,
  type RecoveryTotals,
} from './admin/recovery.js';

export {
  punctualityByDoctor,
  SESSION_ON_TIME_MINUTES,
  type DoctorPunctuality,
  type SessionTiming,
} from './admin/punctuality.js';

export {
  forecastVolume,
  MIN_OBSERVATIONS,
  type ForecastPoint,
  type ForecastSlot,
  type HistoricalVolume,
} from './admin/forecast.js';

export {
  quoteAccuracy,
  QUOTE_TOLERANCE_MINUTES,
  type QuoteAccuracy,
  type QuoteCounts,
} from './admin/quotes.js';

// --- Validation schemas ----------------------------------------------------
//
// Shared with the client (BACKEND.md §0): the console builds its offline queue
// from the same types the API validates with, so an action a console can
// construct is an action the server will accept.
export * from './schemas/queue.schema.js';
export * from './schemas/sync.schema.js';
export * from './schemas/booking.schema.js';
export * from './schemas/clinical.schema.js';
export * from './schemas/bed.schema.js';
export * from './schemas/emergency.schema.js';
export * from './schemas/referral.schema.js';
export * from './schemas/lab.schema.js';
export * from './schemas/payment.schema.js';

// --- Utilities -------------------------------------------------------------
export * as money from './util/money.js';
export * as time from './util/time.js';
export { BD_MOBILE, normaliseBdMobile } from './util/phone.js';
