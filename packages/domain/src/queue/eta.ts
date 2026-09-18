/**
 * When will I be called? (FR-QUE-11..15)
 *
 * This is the number the whole product is judged on. A patient in Rahela's
 * position wants one thing — *when should I leave the house?* — and every
 * design choice here follows from the fact that being wrong in the two
 * directions costs different amounts:
 *
 *   Too late, and someone sits in a corridor for an extra hour. Annoying.
 *   Too early, and someone arrives to find their turn has passed. Unacceptable.
 *
 * So the estimate is deliberately not a best guess. It is a slightly
 * conservative one, carried with a confidence band wide enough to be honest
 * (FR-QUE-13: "around 6:05, ±15 min" rather than false precision), and it is
 * never allowed to jump earlier without the caller being told so it can send a
 * notification first (FR-QUE-15).
 *
 * Pure: `now` is an argument. Lint forbids reading the clock in this directory,
 * because an ETA function that consults `Date.now()` cannot be replayed and
 * cannot be tested at a fixed instant.
 */

import { addSeconds, differenceInSeconds, floorToMinute, maxTimestamp } from '../util/time.js';

import { currentRateSeconds, isMeasured, rateSpreadSeconds } from './rate.js';
import { activeQueue, nowServing, waitingQueue, type QueueState } from './state.js';

import type { BookingId, Timestamp } from '../types/ids.js';

/** An estimate for one waiting booking. */
export interface Eta {
  readonly bookingId: BookingId;
  readonly serial: number;
  /** How many patients are seen first, the chamber's occupant included. */
  readonly patientsAhead: number;
  /** Centre of the estimate, floored to the minute. */
  readonly etaAt: Timestamp;
  /** Half-width of the confidence band, in minutes (FR-QUE-13). */
  readonly bandMinutes: number;
  /**
   * How much weight to put on this.
   *
   * `measured` — the chamber has been running and the rate is observed.
   * `estimated` — using the doctor's configured default; no consultations yet.
   * `unknown` — the doctor has not arrived, or the session is paused, and any
   *   specific time would be a guess dressed up as information (PRD.md §3.2).
   */
  readonly confidence: 'measured' | 'estimated' | 'unknown';
  /** True when this estimate is earlier than the one previously sent out. */
  readonly movedEarlier: boolean;
}

export interface EtaOptions {
  /**
   * The estimates a patient has already been told, by booking id.
   *
   * FR-QUE-15: an ETA never moves earlier than the booked window without an
   * explicit notification, because a person told "around 6:30" who is then
   * called at 5:50 has been failed by the app, not helped by it. Supplying
   * these makes `movedEarlier` meaningful; the notification service acts on it.
   */
  readonly previous?: ReadonlyMap<BookingId, Timestamp>;
}

/** Narrowest band we will ever show, in minutes. */
export const MIN_BAND_MINUTES = 5;

/** Widest band worth showing; past this, say the wait is long, not precise. */
export const MAX_BAND_MINUTES = 45;

/**
 * Estimates for every waiting patient in the session.
 *
 * Runs in one pass over the active queue, which keeps it comfortably inside
 * the 500 ms budget for a hundred patients (NFR-03, FR-QUE-14).
 */
export function computeEtas(
  state: QueueState,
  now: Timestamp,
  options: EtaOptions = {},
): readonly Eta[] {
  const rateSeconds = currentRateSeconds(state.rate);
  const spreadSeconds = rateSpreadSeconds(state.rate);
  const confidence = confidenceOf(state);
  const base = baselineFor(state, now);

  const etas: Eta[] = [];
  let cursor = base;
  let ahead = 0;

  for (const entry of activeQueue(state)) {
    if (entry.status === 'in_chamber') {
      // The current consultation still has to finish. Credit the time already
      // spent in the chamber, so a long consultation does not keep promising
      // the next patient a full slot from now.
      const elapsed =
        entry.calledAt === null ? 0 : Math.max(0, differenceInSeconds(now, entry.calledAt));
      cursor = addSeconds(cursor, Math.max(0, rateSeconds - elapsed));
      ahead += 1;
      continue;
    }

    const etaAt = floorToMinute(cursor);
    const previous = options.previous?.get(entry.bookingId);

    etas.push({
      bookingId: entry.bookingId,
      serial: entry.serial,
      patientsAhead: ahead,
      etaAt,
      bandMinutes: bandMinutes(ahead, spreadSeconds, confidence),
      confidence,
      movedEarlier: previous !== undefined && etaAt < previous,
    });

    cursor = addSeconds(cursor, rateSeconds);
    ahead += 1;
  }

  return etas;
}

/** The estimate for one booking, or null when it is not waiting. */
export function etaFor(
  state: QueueState,
  bookingId: BookingId,
  now: Timestamp,
  options: EtaOptions = {},
): Eta | null {
  return computeEtas(state, now, options).find((eta) => eta.bookingId === bookingId) ?? null;
}

/**
 * When the queue starts counting from.
 *
 * Before the doctor arrives, the clock starts at the planned start plus any
 * declared delay — and never earlier than now, because a session that was due
 * at five and has not started at half past does not get to claim five.
 *
 * Once the doctor is in, it starts from now: the queue is moving, and the
 * measured rate carries it forward.
 *
 * A paused session adds the pause so far. Nothing can know when a prayer break
 * or an emergency call-away ends, which is why a paused session reports
 * `unknown` confidence rather than a confident wrong time (FR-REC-05).
 */
function baselineFor(state: QueueState, now: Timestamp): Timestamp {
  if (state.doctorArrivedAt === null) {
    const plannedWithDelay = addSeconds(state.plan.plannedStart, state.delayMinutes * 60);
    return maxTimestamp(plannedWithDelay, now);
  }

  const withDelay = addSeconds(now, state.delayMinutes * 60);
  return maxTimestamp(withDelay, now);
}

function confidenceOf(state: QueueState): Eta['confidence'] {
  if (state.status === 'paused') return 'unknown';
  if (state.status === 'ended' || state.status === 'cancelled') return 'unknown';
  if (state.doctorArrivedAt === null) return 'unknown';
  return isMeasured(state.rate) ? 'measured' : 'estimated';
}

/**
 * Half-width of the confidence band, in minutes.
 *
 * Grows with the square root of the number of patients ahead, because
 * consultation lengths vary roughly independently and their errors partly
 * cancel — ten patients ahead is uncertain, but not ten times as uncertain as
 * one. An unmeasured or paused session gets the widest band we will show,
 * since the honest answer there is "we do not really know".
 */
export function bandMinutes(
  patientsAhead: number,
  spreadSeconds: number,
  confidence: Eta['confidence'],
): number {
  if (confidence === 'unknown') return MAX_BAND_MINUTES;

  const spreadMinutes = spreadSeconds / 60;
  const raw = Math.sqrt(Math.max(1, patientsAhead)) * spreadMinutes;

  return Math.min(MAX_BAND_MINUTES, Math.max(MIN_BAND_MINUTES, Math.ceil(raw)));
}

/**
 * Whether it is time to tell someone to leave home (FR-PAT-32).
 *
 * Fires when the remaining wait has shrunk to the travel time plus a buffer.
 * Travel time is a static per-hospital estimate in v0, passed in rather than
 * looked up, so this stays pure and testable.
 */
export function shouldLeaveNow(
  eta: Eta,
  now: Timestamp,
  travelMinutes: number,
  bufferMinutes = 10,
): boolean {
  if (eta.confidence === 'unknown') return false;
  const minutesUntil = differenceInSeconds(eta.etaAt, now) / 60;
  return minutesUntil <= travelMinutes + bufferMinutes;
}

/**
 * The patients who are two away from being called, for the "called soon"
 * notice (FR-NOT-03, BACKEND.md §8 `queue.twoAway`).
 *
 * Returns bookings rather than sending anything: the domain decides who
 * qualifies, a worker decides how to reach them.
 */
export function twoAwayBookings(state: QueueState): readonly BookingId[] {
  const waiting = waitingQueue(state);
  const offset = nowServing(state) === null ? 0 : 1;
  const target = waiting[2 - offset];
  return target === undefined ? [] : [target.bookingId];
}

/**
 * When the session is now expected to finish, for `queue_state.projected_end`.
 *
 * Null when nothing can be said honestly — no queue left, or a session whose
 * doctor has not arrived.
 */
export function projectedEnd(state: QueueState, now: Timestamp): Timestamp | null {
  const queue = activeQueue(state);
  if (queue.length === 0) return null;
  if (confidenceOf(state) === 'unknown') return null;

  const rateSeconds = currentRateSeconds(state.rate);
  return floorToMinute(addSeconds(baselineFor(state, now), queue.length * rateSeconds));
}
