/**
 * The guards that stand between a tap and the event log (FR-QUE-20..22).
 *
 * `appendEvent` runs these before writing anything (BACKEND.md §4.1 step 4).
 * They return a reason rather than throwing, because every one of them maps to
 * a message a receptionist has to read and act on — and `QUEUE_GUARD_FAILED`
 * (BACKEND.md §9) carries the code to the client, which picks the Bangla copy.
 *
 * Two principles shape this file:
 *
 *   A guard protects a patient, not the schema. "Cannot no-show before grace"
 *   exists because a patient who stepped out to find a toilet must not lose
 *   their turn, not because a column would be inconsistent.
 *
 *   Staff speed is sacred (PRD.md §3.4). A guard that blocks a legitimate
 *   action is worse than no guard, so each one is narrow, and the ones that
 *   are really warnings are left to the console to show.
 */

import { differenceInMinutes, differenceInSeconds } from '../util/time.js';

import { currentRateSeconds } from './rate.js';
import {
  activeQueue,
  findEntry,
  nowServing,
  pendingOffers,
  waitingQueue,
  type QueueState,
  type SlotOfferState,
} from './state.js';

import type { HospitalSettings } from '../types/entities.js';
import type { BookingId, Timestamp } from '../types/ids.js';

/** Stable codes the client maps to Bangla copy. */
export type QueueGuardCode =
  | 'SESSION_NOT_RUNNING'
  | 'SESSION_ENDED'
  | 'PATIENT_IN_CHAMBER'
  | 'QUEUE_EMPTY'
  | 'UNKNOWN_BOOKING'
  | 'BOOKING_SETTLED'
  | 'NO_SHOW_BEFORE_GRACE'
  | 'NOT_A_NO_SHOW'
  | 'REASON_REQUIRED'
  | 'DOCTOR_ALREADY_ARRIVED'
  | 'NOT_PAUSED'
  | 'ALREADY_PAUSED'
  | 'DELAY_OUT_OF_RANGE'
  | 'SLOT_NOT_FREE'
  | 'OFFER_OUTSTANDING'
  | 'UNKNOWN_OFFER'
  | 'OFFER_SETTLED'
  | 'OFFER_EXPIRED';

export type GuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: QueueGuardCode; readonly detail: string };

const ALLOWED: GuardResult = { ok: true };

function deny(code: QueueGuardCode, detail: string): GuardResult {
  return { ok: false, code, detail };
}

/** The settings the queue rules read, with the documented defaults. */
export const DEFAULT_QUEUE_SETTINGS = {
  noShowGracePatients: 2,
  noShowGraceMinutes: 15,
  lateReinsertAfter: 3,
  staleThresholdMinutes: 10,
} as const;

export type QueueSettings = Pick<
  HospitalSettings,
  'noShowGracePatients' | 'noShowGraceMinutes' | 'lateReinsertAfter' | 'staleThresholdMinutes'
>;

/** Longest delay that can be declared in one go, in minutes. */
export const MAX_DELAY_MINUTES = 480;

// ---------------------------------------------------------------------------
// Session-level guards
// ---------------------------------------------------------------------------

export function canDeclareDoctorArrived(state: QueueState): GuardResult {
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  if (state.doctorArrivedAt !== null) {
    return deny('DOCTOR_ALREADY_ARRIVED', 'The doctor is already recorded as arrived.');
  }
  return ALLOWED;
}

export function canDeclareDelay(state: QueueState, minutes: number): GuardResult {
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > MAX_DELAY_MINUTES) {
    return deny(
      'DELAY_OUT_OF_RANGE',
      `A delay must be between 1 and ${String(MAX_DELAY_MINUTES)} minutes.`,
    );
  }
  return ALLOWED;
}

export function canPause(state: QueueState): GuardResult {
  if (state.status === 'paused') {
    return deny('ALREADY_PAUSED', 'This session is already paused.');
  }
  if (state.status !== 'running') {
    return deny('SESSION_NOT_RUNNING', 'A session can only be paused while it is running.');
  }
  return ALLOWED;
}

export function canResume(state: QueueState): GuardResult {
  if (state.status !== 'paused') {
    return deny('NOT_PAUSED', 'This session is not paused.');
  }
  return ALLOWED;
}

// ---------------------------------------------------------------------------
// Calling the next patient — the most-used control in the product
// ---------------------------------------------------------------------------

/**
 * Whether `BTN-B02-NEXT` may call the next patient.
 *
 * Refuses while someone is still in the chamber unmarked (BACKEND.md §4.1
 * step 4). The console's answer to that refusal is not an error message: the
 * button relabels itself to "এই রোগী শেষ ও পরবর্তী" and performs both actions
 * (APP_FLOW.md B1.3 step 1). So this guard exists to tell the caller which of
 * the two chains to run, not to stop the work.
 */
export function canCallNext(state: QueueState): GuardResult {
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  if (state.status === 'paused') {
    return deny('SESSION_NOT_RUNNING', 'This session is paused. Resume it first.');
  }
  if (state.doctorArrivedAt === null) {
    return deny('SESSION_NOT_RUNNING', 'Mark the doctor as arrived before calling a patient.');
  }

  const serving = nowServing(state);
  if (serving !== null) {
    return deny(
      'PATIENT_IN_CHAMBER',
      `Serial ${String(serving.serial)} is still in the chamber. Finish that consultation first.`,
    );
  }

  if (nextToCall(state) === null) {
    return deny('QUEUE_EMPTY', 'Nobody is waiting.');
  }

  return ALLOWED;
}

/** The patient a `next` tap would call, or null when nobody is waiting. */
export function nextToCall(state: QueueState): QueueState['entries'][number] | null {
  return (
    waitingQueue(state).find((entry) => entry.status !== 'late') ?? waitingQueue(state)[0] ?? null
  );
}

export function canMarkDone(state: QueueState, bookingId: BookingId): GuardResult {
  const entry = findEntry(state, bookingId);
  if (entry === null) {
    return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');
  }
  if (entry.status !== 'in_chamber') {
    return deny(
      'BOOKING_SETTLED',
      `Serial ${String(entry.serial)} is not in the chamber, so there is nothing to finish.`,
    );
  }
  return ALLOWED;
}

// ---------------------------------------------------------------------------
// Late, no-show, and recovery (FR-QUE-20..22)
// ---------------------------------------------------------------------------

/**
 * Whether a patient may be marked absent yet.
 *
 * The grace period is the longer of the two thresholds in FR-QUE-20 — see
 * `graceWindowMinutes` — and it runs from the moment the patient's turn
 * arrived, not from the session's planned start. A patient holding serial 40
 * is not late at five o'clock, and a patient whose turn came while the queue
 * was moving fast still gets the full fifteen minutes to walk in from the car
 * park.
 */
export function canMarkNoShow(
  state: QueueState,
  bookingId: BookingId,
  settings: QueueSettings,
  now: Timestamp,
): GuardResult {
  const entry = findEntry(state, bookingId);
  if (entry === null) {
    return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');
  }
  if (entry.status === 'no_show') {
    return deny('BOOKING_SETTLED', 'That patient is already marked absent.');
  }
  if (entry.status === 'done' || entry.status === 'cancelled' || entry.status === 'rescheduled') {
    return deny('BOOKING_SETTLED', 'That booking has already been settled.');
  }

  const grace = graceRemaining(state, bookingId, settings, now);
  if (grace === null) {
    return deny('NOT_A_NO_SHOW', 'That patient has not been reached yet.');
  }
  if (grace.minutesRemaining > 0) {
    return deny(
      'NO_SHOW_BEFORE_GRACE',
      `Grace period is still running: ${String(grace.minutesRemaining)} more minute(s) of ${String(grace.windowMinutes)}.`,
    );
  }

  return ALLOWED;
}

/**
 * The length of the grace period, in minutes.
 *
 * FR-QUE-20 gives it as "2 patients or 15 minutes, whichever is longer". Both
 * halves are durations once the first is read at the chamber's current pace,
 * and the rule takes the longer of the two:
 *
 *   fast chamber, 5 min a patient  → max(10, 15) = 15 minutes
 *   slow chamber, 12 min a patient → max(24, 15) = 24 minutes
 *
 * Reading the patient clause as a count of calls instead is the other possible
 * interpretation, and it deadlocks: a patient at the front of the queue who
 * never shows up blocks the counter, because no further patient can be called
 * until this one is settled, so the count never rises and the grace never
 * expires. Staff speed is sacred (PRD.md §3.4), so the reading that lets a
 * receptionist move on is the one implemented. Flagged for a PRD edit.
 */
export function graceWindowMinutes(state: QueueState, settings: QueueSettings): number {
  const rateMinutes = currentRateSeconds(state.rate) / 60;
  return Math.max(settings.noShowGraceMinutes, settings.noShowGracePatients * rateMinutes);
}

/**
 * How much of the grace period is left, or null if the patient's turn has not
 * come round yet.
 *
 * Returned as numbers rather than a boolean so the console can show the
 * receptionist why the button is disabled instead of just disabling it
 * (FRONTEND.md §5.1: never disable a primary silently).
 */
export function graceRemaining(
  state: QueueState,
  bookingId: BookingId,
  settings: QueueSettings,
  now: Timestamp,
): {
  readonly minutesRemaining: number;
  readonly windowMinutes: number;
  readonly turnReachedAt: Timestamp;
} | null {
  const turnAt = turnReachedAt(state, bookingId);
  if (turnAt === null) return null;

  const windowMinutes = Math.ceil(graceWindowMinutes(state, settings));
  const minutesElapsed = differenceInMinutes(now, turnAt);

  return {
    minutesRemaining: Math.max(0, windowMinutes - minutesElapsed),
    windowMinutes,
    turnReachedAt: turnAt,
  };
}

/**
 * When this patient's turn arrived.
 *
 * A patient's turn arrives when they reach the front of the queue with the
 * chamber empty — which happens at the moment the previous patient left it.
 * So the clock starts at the latest departure: a consultation finishing, a
 * no-show being marked, or the doctor arriving if this is the first patient
 * of the session.
 *
 * Returns null while anyone is still ahead of them. A patient holding serial
 * 40 is not late at five o'clock, and the grace period has no meaning until
 * the queue has actually reached them.
 */
function turnReachedAt(state: QueueState, bookingId: BookingId): Timestamp | null {
  const position = activeQueue(state).findIndex((entry) => entry.bookingId === bookingId);
  if (position !== 0) return null;

  const departures: Timestamp[] = [];
  for (const entry of state.entries) {
    if (entry.doneAt !== null) departures.push(entry.doneAt);
    if (entry.noShow !== null) departures.push(entry.noShow.markedAt);
  }
  if (state.doctorArrivedAt !== null) departures.push(state.doctorArrivedAt);

  if (departures.length === 0) return null;
  return departures.reduce((latest, candidate) => (candidate > latest ? candidate : latest));
}

/** Whether a no-show may be reinstated (FR-QUE-22). */
export function canReinstate(state: QueueState, bookingId: BookingId): GuardResult {
  const entry = findEntry(state, bookingId);
  if (entry === null) {
    return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');
  }
  if (entry.status !== 'no_show' && entry.status !== 'late') {
    return deny(
      'NOT_A_NO_SHOW',
      'Only a patient marked absent or late can be brought back into the queue.',
    );
  }
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  return ALLOWED;
}

/** Whether a patient may declare lateness (FR-PAT-33). */
export function canDeclareLate(state: QueueState, bookingId: BookingId): GuardResult {
  const entry = findEntry(state, bookingId);
  if (entry === null) {
    return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');
  }
  if (entry.status === 'in_chamber') {
    return deny('PATIENT_IN_CHAMBER', 'That patient is already in the chamber.');
  }
  if (entry.status === 'done' || entry.status === 'cancelled' || entry.status === 'rescheduled') {
    return deny('BOOKING_SETTLED', 'That booking has already been settled.');
  }
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  return ALLOWED;
}

/**
 * Where a late patient goes back into the queue (FR-QUE-21).
 *
 * After `k` more patients, never dropped. `k` is per-hospital and defaults to
 * 3. If fewer than `k` patients are still waiting they go to the back, which
 * is the most the queue can offer without pushing them out of the session.
 *
 * Returned as an index into the active queue, so the reducer does the moving
 * and this file only decides where.
 */
export function lateReinsertIndex(
  state: QueueState,
  bookingId: BookingId,
  reinsertAfter: number,
): number {
  const queue = activeQueue(state);
  const currentIndex = queue.findIndex((entry) => entry.bookingId === bookingId);
  const others = queue.filter((entry) => entry.bookingId !== bookingId);

  // Count forward from where they are now, past patients who are still waiting.
  const from = currentIndex === -1 ? 0 : currentIndex;
  const target = Math.min(from + Math.max(1, reinsertAfter), others.length);
  return target;
}

/** Whether reception may reorder for priority (FR-REC-15). */
export function canReorder(state: QueueState, bookingId: BookingId, reason: string): GuardResult {
  const entry = findEntry(state, bookingId);
  if (entry === null) {
    return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');
  }
  if (reason.trim() === '') {
    return deny(
      'REASON_REQUIRED',
      'Moving a patient up the queue needs a reason, and it is recorded in the audit log.',
    );
  }
  if (entry.status === 'done' || entry.status === 'no_show' || entry.status === 'cancelled') {
    return deny('BOOKING_SETTLED', 'That booking has already been settled.');
  }
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  return ALLOWED;
}

/** Whether a walk-in may be inserted at a chosen position (FR-REC-14). */
export function canAddWalkin(
  state: QueueState,
  position: 'end' | 'index',
  reason: string | null,
): GuardResult {
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }
  if (position === 'index' && (reason === null || reason.trim() === '')) {
    return deny(
      'REASON_REQUIRED',
      'Placing a walk-in ahead of waiting patients needs a reason, and it is recorded.',
    );
  }
  return ALLOWED;
}

/**
 * Whether the session has room for another booking.
 *
 * Counts settled rows out, because a cancellation genuinely frees a place —
 * which is the whole mechanism behind offering a freed slot to a standby
 * patient (FR-QUE-30).
 */
export function hasCapacity(state: QueueState): boolean {
  if (state.plan.capacity === null) return true;
  return activeQueue(state).length < state.plan.capacity;
}

// ---------------------------------------------------------------------------
// Offering a freed slot (FR-QUE-30, FR-REC-30)
//
// A no-show or a cancellation frees a chair. `FR-QUE-30` gives it to standby
// patients "in order, with a short acceptance window; unaccepted offers pass
// to the next patient" — so an offer names one patient at a time, and the
// window expiring is what moves it along.
//
// The event payload's `offeredTo` is a list because `DATABASE.md` §3 declares
// it one, and `slot_offers.offered_to_patient_id` is a single column because
// the requirement says *in order*. Both are satisfied by a one-element list:
// the shape allows a future broadcast offer without a migration, and this
// version never writes more than one name into it.
// ---------------------------------------------------------------------------

/**
 * How long a standby patient has to answer, in minutes.
 *
 * No document names it. Ten minutes is the shortest window that survives an
 * SMS: a text takes up to a minute to land, somebody has to read it, decide,
 * and answer — and the slot is worthless to the hospital if the person cannot
 * physically be in the waiting room soon after. Shorter would offer a chair to
 * people who never had a chance to take it, which is worse than not offering.
 */
export const SLOT_OFFER_WINDOW_MINUTES = 10;

/**
 * Whether a freed slot may be offered at all.
 *
 * The guard is about the chair, not about who gets it: whether anybody is on
 * the standby list is a question for the database, not for the reduced state,
 * and refusing here for an empty list would put a repository's answer in the
 * domain.
 */
export function canOfferFreedSlot(state: QueueState, freedBookingId: BookingId): GuardResult {
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }

  const entry = findEntry(state, freedBookingId);
  if (entry === null) return deny('UNKNOWN_BOOKING', 'That booking is not in this session.');

  // Only a chair that is genuinely empty. A patient who is merely late still
  // holds their place (`FR-QUE-21`), and offering it away would take a turn
  // from somebody standing outside the door.
  if (entry.status !== 'no_show' && entry.status !== 'cancelled') {
    return deny(
      'SLOT_NOT_FREE',
      'Only a cancelled booking or a marked no-show frees a slot to offer.',
    );
  }

  // One offer per freed chair. Two outstanding offers against the same slot is
  // two patients told to come in for one place, and the second to arrive is
  // turned away at the counter.
  const outstanding = pendingOffers(state).some((offer) => offer.freedBookingId === freedBookingId);
  if (outstanding) {
    return deny('OFFER_OUTSTANDING', 'That slot is already offered and awaiting an answer.');
  }

  return ALLOWED;
}

/**
 * Whether an outstanding offer may still be accepted.
 *
 * Expiry is checked against the clock rather than against an `SLOT_EXPIRED`
 * event, because nothing sweeps the table on a timer in this version
 * (`pg-boss` is not installed) and an offer that lapsed twenty minutes ago
 * must not be acceptable merely because no worker has said so yet. The event
 * is appended when the lapse is noticed; the refusal does not wait for it.
 */
export function canAcceptSlot(state: QueueState, offerId: string, now: Timestamp): GuardResult {
  const offer = state.offers.find((candidate) => candidate.offerId === offerId);
  if (offer === undefined) return deny('UNKNOWN_OFFER', 'That offer does not exist.');

  if (offer.outcome === 'accepted') {
    return deny('OFFER_SETTLED', 'That slot has already been taken.');
  }
  if (offer.outcome === 'expired') {
    return deny('OFFER_EXPIRED', 'That offer has expired and the slot has moved on.');
  }
  if (differenceInSeconds(offer.expiresAt, now) <= 0) {
    return deny('OFFER_EXPIRED', 'That offer has expired and the slot has moved on.');
  }
  if (state.status === 'ended' || state.status === 'cancelled') {
    return deny('SESSION_ENDED', 'This session has already ended.');
  }

  return ALLOWED;
}

/** Offers whose window has closed but which nothing has recorded as expired. */
export function lapsedOffers(state: QueueState, now: Timestamp): readonly SlotOfferState[] {
  return pendingOffers(state).filter((offer) => differenceInSeconds(offer.expiresAt, now) <= 0);
}
