/**
 * The shape of a session's queue, and how one comes into existence.
 *
 * ## Where the roster comes from
 *
 * `queue_event_type` (DATABASE.md §1) has no `BOOKING_CREATED`. A booking's
 * existence is a row in `bookings`; the event log records what *happens* to
 * that row — called, done, late, no-show, reordered. `bookings.status` is
 * itself derived from the log (`trg_booking_status_from_events`), and
 * `fn_recalc_etas(session_id)` reads bookings to know who is waiting.
 *
 * So a queue is not `events => state`. It is:
 *
 *     seed (session plan + roster of bookings) + events => state
 *
 * where the seed uses only immutable booking facts — id, serial, patient,
 * source, creation time — and never `status`, which the events decide. Replay
 * is therefore still deterministic and still settles disputes (FR-QUE-05):
 * given the same seed and the same log, the state is identical, every time.
 *
 * This also gives FR-QUE-52 for free. A booking made online while a console
 * was offline appears in the next seed the console loads, so it arrives as a
 * new row in the queue rather than being silently dropped.
 *
 * (APP_FLOW.md §A4 mentions `EVT-BOOKING_CREATED` in the confirm-booking
 * wiring, which does not exist in DATABASE.md §1 or FR-QUE-03. Flagged for a
 * document edit; the seed model above is what the schema actually supports.)
 *
 * ## One ordered list
 *
 * `entries` is the queue in the order staff see it, and it holds settled rows
 * too — a patient marked done or no-show stays visible in the console's table
 * (APP_FLOW.md B1.4). Only entries with an active status occupy a place in the
 * line, and `activeQueue` is the view every ETA is computed from.
 *
 * Arrays rather than maps throughout, so that two states built by different
 * routes compare equal structurally — which is what the replay-determinism
 * tests assert.
 */

import {
  isActiveBookingStatus,
  type BookingSource,
  type BookingStatus,
  type SessionStatus,
} from '../types/enums.js';

import type {
  BookingId,
  DoctorId,
  PatientId,
  QueueEventId,
  Serial,
  SessionId,
  SlotOfferId,
  Timestamp,
} from '../types/ids.js';

/** One booking's place in the queue. */
export interface QueueEntry {
  readonly bookingId: BookingId;
  readonly serial: Serial;
  readonly patientId: PatientId;
  readonly source: BookingSource;
  readonly status: BookingStatus;
  readonly arrivedAt: Timestamp | null;
  readonly calledAt: Timestamp | null;
  readonly doneAt: Timestamp | null;
  /** Measured at PATIENT_DONE. Feeds the rolling rate (FR-QUE-12). */
  readonly consultSeconds: number | null;
  /** Set while the patient has declared lateness (FR-PAT-33, FR-QUE-21). */
  readonly late: {
    readonly declaredAt: Timestamp;
    readonly expectedMinutes: number;
    readonly reinsertAfter: number;
  } | null;
  readonly noShow: {
    readonly markedAt: Timestamp;
    readonly graceUsedMinutes: number;
  } | null;
  /** Set when reception moved this row for priority (FR-REC-15). */
  readonly priority: { readonly movedAt: Timestamp; readonly reason: string } | null;
}

/** The rolling consultation-rate window (see `rate.ts`). */
export interface RateState {
  /** The doctor's configured starting point, in seconds (FR-QUE-10). */
  readonly seedSeconds: number;
  /** Current estimate, weighted toward recent consultations (FR-QUE-12). */
  readonly currentSeconds: number;
  /** Observed durations, most recent last, bounded by `RATE_WINDOW`. */
  readonly samples: readonly number[];
}

/** An outstanding offer of a freed slot (FR-QUE-30). */
export interface SlotOfferState {
  readonly offerId: SlotOfferId;
  readonly freedBookingId: BookingId;
  readonly offeredTo: readonly PatientId[];
  readonly offeredAt: Timestamp;
  readonly expiresAt: Timestamp;
  readonly outcome: 'pending' | 'accepted' | 'expired';
  readonly acceptedBookingId: BookingId | null;
}

/**
 * Something in the log that does not make sense against the seed.
 *
 * Recorded rather than thrown. A reducer that throws makes a session
 * unloadable, and a receptionist with 150 patients in front of her cannot use
 * a console that shows a stack trace — while a queue quietly missing a patient
 * is worse than one that says something is wrong. So the state carries its own
 * bad news, the console can surface it, and the log stays readable
 * (PRD.md §3.2, honest degradation).
 */
export interface QueueAnomaly {
  readonly code: 'UNKNOWN_BOOKING' | 'DUPLICATE_CALL' | 'UNKNOWN_OFFER';
  readonly eventId: QueueEventId;
  readonly seq: number;
  readonly detail: string;
}

/** The session facts the queue needs, none of them derived from the log. */
export interface SessionPlan {
  readonly sessionId: SessionId;
  readonly doctorId: DoctorId;
  readonly plannedStart: Timestamp;
  readonly plannedEnd: Timestamp;
  /** Serials offered; null means unlimited. */
  readonly capacity: number | null;
  /** The doctor's default consultation length, in seconds (FR-QUE-10). */
  readonly defaultConsultSeconds: number;
}

/** An immutable booking fact, as read from `bookings`. */
export interface RosterBooking {
  readonly bookingId: BookingId;
  readonly serial: Serial;
  readonly patientId: PatientId;
  readonly source: BookingSource;
  readonly createdAt: Timestamp;
}

/** Everything needed to start a replay. */
export interface QueueSeed {
  readonly plan: SessionPlan;
  readonly roster: readonly RosterBooking[];
}

/** A session's queue, derived entirely from its seed and its event log. */
export interface QueueState {
  readonly plan: SessionPlan;
  readonly status: SessionStatus;
  readonly openedAt: Timestamp | null;
  /** Set by DOCTOR_ARRIVED. Until then no ETA is more than a guess. */
  readonly doctorArrivedAt: Timestamp | null;
  readonly endedAt: Timestamp | null;
  /** Cumulative declared delay in minutes (FR-REC-03). */
  readonly delayMinutes: number;
  /** Set while the session is paused (FR-REC-05). */
  readonly pausedAt: Timestamp | null;
  /** Total time already spent paused, in seconds. */
  readonly pausedSeconds: number;
  /** The queue in the order staff see it, settled rows included. */
  readonly entries: readonly QueueEntry[];
  readonly rate: RateState;
  readonly offers: readonly SlotOfferState[];
  readonly lastSeq: number;
  readonly lastEventAt: Timestamp | null;
  /** Events compensated by an ACTION_UNDONE, ascending (GR-02). */
  readonly undoneEventIds: readonly QueueEventId[];
  readonly anomalies: readonly QueueAnomaly[];
}

/**
 * The state of a session before anything has happened to it: every booking
 * `booked`, in serial order, doctor not arrived, nothing declared.
 */
export function emptyState(seed: QueueSeed): QueueState {
  const entries = [...seed.roster].sort(compareRoster).map<QueueEntry>((booking) => ({
    bookingId: booking.bookingId,
    serial: booking.serial,
    patientId: booking.patientId,
    source: booking.source,
    status: 'booked',
    arrivedAt: null,
    calledAt: null,
    doneAt: null,
    consultSeconds: null,
    late: null,
    noShow: null,
    priority: null,
  }));

  return {
    plan: seed.plan,
    status: 'scheduled',
    openedAt: null,
    doctorArrivedAt: null,
    endedAt: null,
    delayMinutes: 0,
    pausedAt: null,
    pausedSeconds: 0,
    entries,
    rate: {
      seedSeconds: seed.plan.defaultConsultSeconds,
      currentSeconds: seed.plan.defaultConsultSeconds,
      samples: [],
    },
    offers: [],
    lastSeq: 0,
    lastEventAt: null,
    undoneEventIds: [],
    anomalies: [],
  };
}

/**
 * Serial order, with creation time as the tie-break.
 *
 * A cancelled booking frees its serial for reissue to a standby patient
 * (`bookings_session_serial_key` is partial on `status <> 'cancelled'`), so two
 * rows can legitimately share a serial. Ordering must still be total, or two
 * replays of the same log could disagree about who is next.
 */
function compareRoster(a: RosterBooking, b: RosterBooking): number {
  if (a.serial !== b.serial) return a.serial - b.serial;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.bookingId < b.bookingId ? -1 : a.bookingId > b.bookingId ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Selectors
//
// Counts and "who is now serving" are derived rather than stored, so there is
// one description of each fact. `queue_state` in the database is a projection
// of these (DB-P1: it is a cache, not a source of truth).
// ---------------------------------------------------------------------------

/** The patient in the chamber, if there is one. At most one (FR-QUE-53). */
export function nowServing(state: QueueState): QueueEntry | null {
  return state.entries.find((entry) => entry.status === 'in_chamber') ?? null;
}

/** Entries that still hold a place in the line, in queue order. */
export function activeQueue(state: QueueState): readonly QueueEntry[] {
  return state.entries.filter((entry) => isActiveBookingStatus(entry.status));
}

/** Entries waiting to be called — active, and not already in the chamber. */
export function waitingQueue(state: QueueState): readonly QueueEntry[] {
  return state.entries.filter(
    (entry) => isActiveBookingStatus(entry.status) && entry.status !== 'in_chamber',
  );
}

export function findEntry(state: QueueState, bookingId: BookingId): QueueEntry | null {
  return state.entries.find((entry) => entry.bookingId === bookingId) ?? null;
}

export function indexOfEntry(state: QueueState, bookingId: BookingId): number {
  return state.entries.findIndex((entry) => entry.bookingId === bookingId);
}

/**
 * How many patients will be seen before this one.
 *
 * The number a waiting person actually cares about, and the multiplier in every
 * ETA (FR-QUE-11). Counts the patient in the chamber, because that
 * consultation still has to finish.
 */
export function patientsAhead(state: QueueState, bookingId: BookingId): number {
  const queue = activeQueue(state);
  const position = queue.findIndex((entry) => entry.bookingId === bookingId);
  return position === -1 ? 0 : position;
}

/** The counters the console shows at a glance (FR-REC-17). */
export interface QueueCounts {
  readonly waiting: number;
  readonly inChamber: number;
  readonly late: number;
  readonly noShow: number;
  readonly done: number;
  readonly cancelled: number;
  readonly total: number;
}

export function queueCounts(state: QueueState): QueueCounts {
  let waiting = 0;
  let inChamber = 0;
  let late = 0;
  let noShow = 0;
  let done = 0;
  let cancelled = 0;

  for (const entry of state.entries) {
    switch (entry.status) {
      case 'booked':
      case 'waiting':
        waiting += 1;
        break;
      case 'in_chamber':
        inChamber += 1;
        break;
      case 'late':
        late += 1;
        break;
      case 'no_show':
        noShow += 1;
        break;
      case 'done':
        done += 1;
        break;
      case 'cancelled':
      case 'rescheduled':
        cancelled += 1;
        break;
    }
  }

  return {
    waiting,
    inChamber,
    late,
    noShow,
    done,
    cancelled,
    total: state.entries.length,
  };
}

/** Offers still awaiting an answer (FR-QUE-30). */
export function pendingOffers(state: QueueState): readonly SlotOfferState[] {
  return state.offers.filter((offer) => offer.outcome === 'pending');
}

/**
 * The projection written to `queue_state` (DATABASE.md §2.3).
 *
 * Kept here so that the cache and the reducer cannot describe the same session
 * differently: the repository writes exactly what this returns.
 */
export interface QueueStateProjection {
  readonly sessionId: SessionId;
  readonly nowServingBookingId: BookingId | null;
  readonly nowServingSerial: number | null;
  readonly waitingCount: number;
  readonly lateCount: number;
  readonly noShowCount: number;
  readonly doneCount: number;
  readonly avgConsultSeconds: number | null;
  readonly rebuiltFromSeq: number;
}

export function project(state: QueueState): QueueStateProjection {
  const serving = nowServing(state);
  const counts = queueCounts(state);

  return {
    sessionId: state.plan.sessionId,
    nowServingBookingId: serving?.bookingId ?? null,
    nowServingSerial: serving?.serial ?? null,
    waitingCount: counts.waiting,
    lateCount: counts.late,
    noShowCount: counts.noShow,
    doneCount: counts.done,
    avgConsultSeconds: state.rate.samples.length > 0 ? state.rate.currentSeconds : null,
    rebuiltFromSeq: state.lastSeq,
  };
}

// ---------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------

/**
 * Structural rules that must hold after any sequence of events.
 *
 * Asserted by the tests after every generated event sequence, which is how a
 * reducer bug shows up as a failing property rather than as a patient being
 * called twice in a real chamber.
 */
export function checkInvariants(state: QueueState): string[] {
  const problems: string[] = [];

  const inChamber = state.entries.filter((entry) => entry.status === 'in_chamber');
  if (inChamber.length > 1) {
    problems.push(
      `${String(inChamber.length)} patients are in the chamber at once; only one may be (FR-QUE-53).`,
    );
  }

  const seen = new Set<BookingId>();
  for (const entry of state.entries) {
    if (seen.has(entry.bookingId)) {
      problems.push(`Booking ${entry.bookingId} appears twice in the queue.`);
    }
    seen.add(entry.bookingId);
  }

  if (state.status === 'running' && state.doctorArrivedAt === null) {
    problems.push('Session is running but no doctor has arrived (sessions_running_has_started).');
  }

  if (state.status === 'paused' && state.pausedAt === null) {
    problems.push('Session is paused but has no pause start.');
  }

  if (state.delayMinutes < 0) {
    problems.push(`Cumulative delay is negative: ${String(state.delayMinutes)}.`);
  }

  if (state.pausedSeconds < 0) {
    problems.push(`Accumulated pause time is negative: ${String(state.pausedSeconds)}.`);
  }

  for (const entry of state.entries) {
    if (entry.status === 'done' && entry.doneAt === null) {
      problems.push(`Booking ${entry.bookingId} is done but has no completion time.`);
    }
    if (entry.status === 'in_chamber' && entry.calledAt === null) {
      problems.push(`Booking ${entry.bookingId} is in the chamber but was never called.`);
    }
    if (entry.status === 'late' && entry.late === null) {
      problems.push(`Booking ${entry.bookingId} is late but has no lateness declaration.`);
    }
    if (entry.status === 'no_show' && entry.noShow === null) {
      problems.push(`Booking ${entry.bookingId} is a no-show but has no grace record.`);
    }
  }

  return problems;
}
