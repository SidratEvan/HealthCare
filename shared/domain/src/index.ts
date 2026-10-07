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
  measuredConsultSeconds,
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
  earlierThanTold,
  etaFor,
  outstandingDelayMinutes,
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
  canEndSession,
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
  unseenAtEnd,
  DEFAULT_QUEUE_SETTINGS,
  MAX_DELAY_MINUTES,
  OFFLINE_ACTION_ROLES,
  UNDO_WINDOW_SECONDS,
  canReplayOffline,
  MAX_QUOTED_WAIT_MINUTES,
  SLOT_OFFER_WINDOW_MINUTES,
  type GuardResult,
  type OfflineAction,
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
  boardAfterRead,
  canApply,
  canForecastDischarge,
  canReceiveTransfer,
  effectiveState,
  holdLapsed,
  newestBeds,
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

// --- Onboarding ------------------------------------------------------------
//
// A workspace's state, who may move it, and the checklist it is ready by
// (`FR-ONB-02`–`04`). `ORG_LIFECYCLES` itself is with the other database
// enums in `types/enums`.
export {
  CHECKLIST_ITEMS,
  ORG_ACTIONS,
  actionNeedsNote,
  identityEditable,
  isPublicLifecycle,
  missingForApproval,
  missingForReview,
  nextLifecycle,
  platformActions,
  setupChecklist,
  type ChecklistItem,
  type ChecklistItemKey,
  type OrgAction,
  type SetupCounts,
} from './org/lifecycle.js';
export {
  APPLICATION_PASSWORD_MIN,
  applicationBody,
  codeFor,
  codeStem,
  facilityPhoneFrom,
  mobileFrom,
  type ApplicationBody,
} from './org/application.js';

// --- Brand -----------------------------------------------------------------
//
// A hospital's own colours for the patient app, and the contrast they must
// pass before they are used (`FR-BRD-03`).
export {
  BRAND_TOKENS,
  LOGO_FILE_TYPES,
  LOGO_MAX_BYTES,
  MIN_TEXT_CONTRAST,
  brandBody,
  brandProblems,
  brandTheme,
  contrastRatio,
  logoBody,
  logoBytesMatch,
  readBrandTheme,
  themeFromColour,
  type BrandBody,
  type BrandProblem,
  type BrandTheme,
  type BrandToken,
  type LogoBody,
  type LogoFileType,
} from './brand/theme.js';

// Which live figures a hospital shares with the network (`FR-NET-04`).
export {
  MODULE_OF_FIGURE,
  PUBLISHABLE_FIGURES,
  isPublishableFigure,
  notSharedOf,
  publishingBody,
  type PublishableFigure,
  type PublishingBody,
} from './network/publishing.js';

// The modules a hospital runs, and which module a staff request belongs to
// (`FR-BRD-11`, `FR-SUP-03`).
export {
  HOSPITAL_MODULES,
  MODULE_OF_ROLE,
  MODULE_ROUTES,
  isHospitalModule,
  moduleOn,
  modulesBody,
  modulesOfRequest,
  modulesProblems,
  type HospitalModule,
  type ModulesBody,
  type ModulesProblem,
} from './modules/modules.js';

// What a phone is told when the app is added to its home screen: the
// network's own description, or a hospital's (`FR-BRD-08`).
export {
  INSTALL_ICON_MIN_PIXELS,
  PLATFORM_INSTALL,
  installIconUsable,
  installManifest,
  pngSize,
  shortInstallName,
  type InstallIcon,
  type InstallSubject,
  type WebManifest,
} from './brand/manifest.js';

// Whose address a host is: the network's, a hospital's portal, or somebody
// else's (`FR-BRD-07`).
export {
  RESERVED_PORTAL_LABELS,
  normaliseHost,
  portalDomain,
  portalDomainBody,
  portalHostFor,
  portalHostOf,
  type PortalDomainBody,
  type PortalHost,
} from './brand/portal.js';

// --- Search ----------------------------------------------------------------
//
// What a patient can ask the network for, and how typed text is read as one
// (`FR-PAT-16`–`18`). Shared so the API and the patient app read the same
// words the same way.
export {
  SEARCH_BED_KINDS,
  SEARCH_CAPABILITIES,
  foldSearchText,
  needKey,
  parseNeed,
  readSearch,
  suggestNeeds,
  type SearchNeed,
  type SearchReading,
} from './search/needs.js';
export { confirmedTallyOfKind, orderForNeed, tallyOfKind } from './search/order.js';

// --- Emergency -------------------------------------------------------------
//
// The case state machine, shared the way the bed board is: the API guards with
// it and the ER console applies it before the server answers (`FR-EMG-01..04`).
// Ranking and freshness are the product's rules for `S-A-10b` (`FR-PAT-43`,
// `FR-PAT-45`), used by the search and by the refer-out suggestion alike.
export {
  alreadyApplied,
  applyLocalCase,
  casesAfterRead,
  canActOn,
  expectedArrival,
  inboundOrder,
  isInEr,
  isOnTheWay,
  isOpen,
  loadOf,
  newestCases,
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

// --- The national layer ------------------------------------------------------
//
// `S-B-13` (FR-GOV-01..06): spike detection, anonymised benchmarking, and the
// identifier check every government payload passes before it is sent.
export {
  readSignals,
  statusOf,
  BASELINE_MAX_DAYS,
  BASELINE_MIN_DAYS,
  SIGNAL_WINDOW_DAYS,
  SPIKE_MIN_CASES,
  SPIKE_RATIO,
  type DistrictReporting,
  type SignalDay,
  type SignalReading,
  type SignalStatus,
} from './gov/signals.js';

export {
  benchmark,
  MIN_BENCHMARK_SAMPLE,
  type Benchmark,
  type BenchmarkEntry,
  type BenchmarkMeasure,
  type FacilityFigures,
} from './gov/benchmark.js';

export { findIdentifiers } from './gov/identifiers.js';

// --- Validation schemas ----------------------------------------------------
//
// Shared with the client (BACKEND.md §0): the console builds its offline queue
// from the same types the API validates with, so an action a console can
// construct is an action the server will accept.
export * from './schemas/queue.schema.js';
export * from './schemas/sync.schema.js';
export * from './schemas/auth.schema.js';
export * from './schemas/booking.schema.js';
export * from './schemas/clinical.schema.js';
export * from './schemas/bed.schema.js';
export * from './schemas/standby.schema.js';
export * from './schemas/emergency.schema.js';
export * from './schemas/referral.schema.js';
export * from './schemas/lab.schema.js';
export * from './schemas/payment.schema.js';
export * from './schemas/settings.schema.js';
export * from './schemas/registration.schema.js';
export * from './schemas/import.schema.js';

// --- Utilities -------------------------------------------------------------
export * as money from './util/money.js';
export * as time from './util/time.js';

export {
  addDhakaDays,
  MATERIALISE_DAYS,
  plannedSessions,
  type PlannedSession,
  type ScheduleTemplate,
} from './sessions/materialise.js';
export { BD_MOBILE, normaliseBdMobile } from './util/phone.js';

// --- Importing a hospital's own data (pilot step 24, FR-IMP) ---------------
export { bookingStanding, type BookingStanding } from './queue/standing.js';
export { csvField, csvLine, parseCsv, type CsvProblem, type CsvTable } from './imports/csv.js';
// Mapping a hospital's own export onto the template (`FR-IMP-13`–`20`).
export {
  COLUMN_KINDS,
  STRUCTURE_TYPES,
  applyMapping,
  foldHeading,
  guessStructureType,
  hasTemplateHeader,
  headerLooksLikeData,
  headerSignature,
  kindOfValue,
  mappingProblems,
  modelMappingRequest,
  profileColumns,
  proposeMapping,
  targetFields,
  targetOf,
  targetOneOf,
  unmappedColumns,
  withModelSuggestions,
  type ColumnKind,
  type ColumnMapping,
  type ColumnProfile,
  type FieldProposal,
  type FileColumn,
  type MappingProblem,
  type MappingSource,
  type MappingTarget,
  type ModelColumn,
  type ModelMappingRequest,
  type ModelSuggestion,
  type ProposalReason,
  type StructureType,
  type TargetField,
} from './imports/mapping.js';
export {
  IMPORT_COLUMNS,
  IMPORT_SETS,
  columnIndex,
  latinDigits,
  missingColumns,
  readDate,
  readRow,
  readTime,
  readWeekday,
  refKindOf,
  takaToPoisha as importTakaToPoisha,
  templateCsv,
  type AppointmentRecord,
  type ImportError,
  type ImportErrorCode,
  type ImportRecord,
  type ImportSet,
  type ImportedRole,
  type PatientRecord,
  type RowResult,
  type StructureRecord,
} from './imports/sets.js';
export {
  MAX_GROUPS_LISTED,
  NO_WARNINGS,
  SAME_PERSON_REASONS,
  VALUE_FORMATS,
  foldPersonName,
  hasWarnings,
  importWarnings,
  type FormatKind,
  type ImportWarnings,
  type MixedFormat,
  type SamePersonGroup,
  type SamePersonReason,
  type ValueFormat,
  type WarnedRow,
} from './imports/warnings.js';
