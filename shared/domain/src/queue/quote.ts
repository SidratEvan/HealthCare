/**
 * The wait a check-in quotes by default (`FR-REC-18`).
 *
 * Reception may change it before confirming — the person at the counter can
 * see a consultant on the phone or a family of five for one serial, and the
 * rolling rate cannot — but it starts from the queue's own estimate, so a
 * receptionist who confirms without thinking still says something true.
 *
 * Here rather than in the console because it is queue logic (`CLAUDE.md` §7):
 * the number a patient is told at the counter and the number their phone
 * counts down to come from the same function.
 */

import { differenceInSeconds } from '../util/time.js';

import { computeEtas } from './eta.js';
import { MAX_QUOTED_WAIT_MINUTES } from './rules.js';

import type { QueueState } from './state.js';
import type { BookingId, Timestamp } from '../types/ids.js';

/** Quotes are said in round numbers: "about twenty-five minutes". */
export const QUOTE_STEP_MINUTES = 5;

/**
 * Minutes until this patient's estimated call, to the nearest five.
 *
 * Null for somebody the queue has no estimate for — in the chamber, settled,
 * or not in this session. The console then asks reception for a figure rather
 * than inventing one.
 */
export function suggestedQuote(
  state: QueueState,
  bookingId: BookingId,
  now: Timestamp,
): number | null {
  const eta = computeEtas(state, now).find((candidate) => candidate.bookingId === bookingId);
  if (eta === undefined) return null;

  const minutes = Math.max(0, differenceInSeconds(eta.etaAt, now) / 60);
  const rounded = Math.round(minutes / QUOTE_STEP_MINUTES) * QUOTE_STEP_MINUTES;
  return Math.min(MAX_QUOTED_WAIT_MINUTES, rounded);
}
