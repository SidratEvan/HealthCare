/**
 * The rolling consultation rate — how long this doctor is actually taking,
 * today, in this chamber (FR-QUE-10, FR-QUE-12).
 *
 * Every ETA in the product is this number multiplied by the number of patients
 * ahead, so its behaviour decides whether a patient trusts the app. Two
 * properties matter more than accuracy in the abstract:
 *
 *   Responsive. A doctor running at six minutes when their historical average
 *   is twelve should move the estimates within a few patients, not at the end
 *   of the session. Hence an exponentially weighted average rather than a
 *   plain mean — recent consultations carry more weight (FR-QUE-12).
 *
 *   Stable. One twenty-minute consultation must not throw every downstream
 *   estimate, because a waiting family watching the time jump by half an hour
 *   stops believing any of it. Hence a bounded weight and clamped inputs.
 *
 * Maintained incrementally, never by a full scan (DATABASE.md §6), and pure —
 * the same samples in the same order always give the same number, which is
 * what lets a replay reproduce `avg_consult_seconds` exactly.
 */

import type { RateState } from './state.js';

/**
 * Weight given to the newest observation.
 *
 * 0.3 means a consultation's influence has halved after roughly two more
 * patients and is negligible after eight, so the estimate tracks a doctor who
 * speeds up after a slow start without chasing every outlier.
 */
export const RATE_ALPHA = 0.3;

/**
 * How many observations are retained.
 *
 * Only used for the spread that widens an ETA's confidence band; the estimate
 * itself is incremental. Twelve is about an hour of a fast chamber, which is
 * the horizon over which a doctor's pace is actually stable.
 */
export const RATE_WINDOW = 12;

/** Shortest consultation that is believable, in seconds. */
export const MIN_CONSULT_SECONDS = 30;

/**
 * Longest consultation counted toward the rate, in seconds.
 *
 * A patient who was called and then sat in the chamber for two hours is almost
 * always a forgotten "done" tap, not a two-hour consultation. Clamping stops
 * that one mistake from telling fifty waiting people to go home.
 */
export const MAX_CONSULT_SECONDS = 3600;

/** A fresh rate state seeded from the doctor's configured default. */
export function seedRate(defaultConsultSeconds: number): RateState {
  const seconds = clampConsultSeconds(defaultConsultSeconds);
  return { seedSeconds: seconds, currentSeconds: seconds, samples: [] };
}

/** Brings an observed duration into the believable range. */
export function clampConsultSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return MIN_CONSULT_SECONDS;
  return Math.min(MAX_CONSULT_SECONDS, Math.max(MIN_CONSULT_SECONDS, Math.round(seconds)));
}

/**
 * Folds one completed consultation into the rate.
 *
 * The weight given to a new observation is `max(RATE_ALPHA, 1/n)`, where `n`
 * counts the observations so far. So the first measurement replaces the
 * doctor's configured guess outright, the next few form a running mean, and
 * from the fourth onwards it settles into the recency-weighted average.
 *
 * That warm-up matters. A doctor's first patient of the day is often
 * atypical — a two-minute follow-up, or a long new case — and with a flat
 * weight one such consultation would set the rate for the next half hour and
 * tell forty waiting people the wrong thing. Averaging the early observations
 * converges on the real pace just as fast without betting the session on the
 * first one.
 */
export function observeConsult(rate: RateState, seconds: number): RateState {
  const observed = clampConsultSeconds(seconds);
  const samples = [...rate.samples, observed].slice(-RATE_WINDOW);

  const observationCount = rate.samples.length + 1;
  const weight = Math.max(RATE_ALPHA, 1 / observationCount);
  const currentSeconds = Math.round(weight * observed + (1 - weight) * rate.currentSeconds);

  return {
    seedSeconds: rate.seedSeconds,
    currentSeconds: clampConsultSeconds(currentSeconds),
    samples,
  };
}

/** The number to multiply by, in seconds. */
export function currentRateSeconds(rate: RateState): number {
  return rate.currentSeconds;
}

/**
 * How much consultations have been varying, in seconds.
 *
 * Feeds the confidence band, so that "around 6:05, ±10" is claimed only when
 * the chamber has actually been running to a rhythm, and a wider band is shown
 * when it has not (FR-QUE-13).
 *
 * With fewer than two observations there is no measured spread, so a default
 * proportional to the rate is used — an honest way of saying "we do not know
 * yet" rather than implying precision the data cannot support.
 */
export function rateSpreadSeconds(rate: RateState): number {
  if (rate.samples.length < 2) {
    return Math.round(rate.currentSeconds * DEFAULT_SPREAD_RATIO);
  }

  const mean = rate.samples.reduce((total, value) => total + value, 0) / rate.samples.length;
  const variance =
    rate.samples.reduce((total, value) => total + (value - mean) ** 2, 0) / rate.samples.length;

  // Never claim a tighter spread than a doctor's pace can really hold.
  return Math.max(
    Math.round(Math.sqrt(variance)),
    Math.round(rate.currentSeconds * MIN_SPREAD_RATIO),
  );
}

/** Assumed spread before anything has been measured: 40% of the rate. */
const DEFAULT_SPREAD_RATIO = 0.4;

/** Floor on the measured spread: 15% of the rate. */
const MIN_SPREAD_RATIO = 0.15;

/** True once the rate rests on measurement rather than on the doctor's default. */
export function isMeasured(rate: RateState): boolean {
  return rate.samples.length > 0;
}
