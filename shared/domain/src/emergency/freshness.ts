/**
 * How old a figure is, and when that age makes it stale (`FR-OFF-03`,
 * `FR-OFF-04`, `FR-PAT-45`).
 *
 * `PRD.md` §3.2: "If a number cannot be live, it shows its age." Emergency
 * search is where that matters most — a family choosing between two burn units
 * is choosing on a free-bed count, and a count nobody has confirmed for four
 * hours is not the same claim as one confirmed four minutes ago. `FR-PAT-45`
 * therefore does two things with the age: it labels the result, and it ranks
 * the result lower.
 *
 * ## A result is as old as its oldest figure
 *
 * One emergency card carries several figures, each confirmed by somebody
 * different at a different time: the capability flag by the ER coordinator,
 * the bed counts by the ward. The card shows one freshness line, and that line
 * is the age of the **oldest** figure on it — the same rule
 * `v_public_hospital_capacity.beds_as_of` uses for a hospital's total. Showing
 * the newest would let one busy ward vouch for an ICU nobody has looked at.
 *
 * A figure that has never been confirmed at all has no age; it is stale, and
 * so is any result standing on it. "Unknown" is not "fresh".
 *
 * No labels here: this module returns numbers, and `@platform/i18n` turns them
 * into "হালনাগাদ ৩ মিনিট আগে" or "তথ্য ৪ ঘণ্টা পুরোনো" (`FR-LOC-02`).
 */

import { toEpochMs } from '../util/time.js';

import type { Timestamp } from '../types/ids.js';

/**
 * The default threshold, in minutes (`hospital_settings.stale_threshold_minutes`
 * defaults to the same number, and so does `STALE_THRESHOLD_MINUTES`).
 * Each hospital's own setting wins where there is one.
 */
export const DEFAULT_STALE_THRESHOLD_MINUTES = 10;

export interface Freshness {
  /** The oldest stamp among the figures, or null when any was never confirmed. */
  readonly asOf: Timestamp | null;
  /** Whole minutes since `asOf`; null when `asOf` is. Never negative. */
  readonly ageMinutes: number | null;
  /** Past the threshold, or never confirmed. */
  readonly stale: boolean;
}

/**
 * The oldest of several stamps.
 *
 * Null if the list is empty or any stamp is null: a result is only as known as
 * its least-known figure.
 */
export function oldestStamp(stamps: readonly (Timestamp | null)[]): Timestamp | null {
  if (stamps.length === 0) return null;

  let oldest: Timestamp | null = null;
  for (const stamp of stamps) {
    if (stamp === null) return null;
    if (oldest === null || toEpochMs(stamp) < toEpochMs(oldest)) oldest = stamp;
  }
  return oldest;
}

/** Whole minutes from `asOf` to `now`, floored, and never below zero. */
export function ageInMinutes(asOf: Timestamp | null, now: Timestamp): number | null {
  if (asOf === null) return null;
  // A stamp slightly ahead of this clock — a server a second ahead of a phone —
  // is "just now", not a negative age.
  return Math.max(0, Math.floor((toEpochMs(now) - toEpochMs(asOf)) / 60_000));
}

/**
 * The freshness of a result standing on `stamps`.
 *
 * Stale once the age *reaches* the threshold: ten whole minutes under a
 * ten-minute threshold is stale. That is how `<FreshnessLine>` already colours
 * a figure, and the two must agree — a card ranked as fresh whose own line
 * turns amber would be the product contradicting itself on one screen.
 */
export function freshnessOf(
  stamps: readonly (Timestamp | null)[],
  now: Timestamp,
  thresholdMinutes: number,
): Freshness {
  const asOf = oldestStamp(stamps);
  const ageMinutes = ageInMinutes(asOf, now);
  return {
    asOf,
    ageMinutes,
    stale: ageMinutes === null || ageMinutes >= thresholdMinutes,
  };
}
