/**
 * Medicine availability, and how old a claim about it is (`FR-PHR-02`).
 *
 * "Out-of-stock flagging feeds medicine availability search in the patient
 * app." Both halves are here: what a pharmacy flags, and what a family
 * searching from a bus is shown — which is deliberately not the same thing.
 *
 * No I/O.
 *
 * ## Availability, never inventory
 *
 * A stock row holds a boolean and a time, because `DATABASE.md` §2.8 says
 * `in_stock boolean` and because `FR-EMG-06` gives the reason for its
 * neighbour: "published as availability, not exact inventory, if the hospital
 * prefers." A pharmacy asked to keep a count true stops updating it within a
 * week, and a stale count is worse than no count — a family crosses Dhaka for
 * a medicine that is not there (`PRD.md` §3.2).
 *
 * ## Three answers, not two
 *
 * A search says **যাচাই করা আছে** (flagged in stock, recently), **নেই**
 * (flagged out of stock) or **জানা নেই** — which covers both "this pharmacy
 * has never flagged this medicine" and "the flag is too old to stand behind".
 * Folding the third into "নেই" would invent a shortage; folding it into
 * "আছে" would send somebody on a wasted journey. The honest-degradation rule
 * (`PRD.md` §3.2, `GR-05`) is why the enum has three members.
 *
 * ## Why medicine stock goes stale slower than a bed
 *
 * A free bed is claimed within minutes, so `DEFAULT_STALE_THRESHOLD_MINUTES`
 * is ten. A pharmacy's shelf does not empty that fast, and a ten-minute
 * threshold would mark every flag unknown by mid-morning and teach families
 * to ignore the whole feature. Twelve hours is the judgement here: long
 * enough that a morning check stands all day, short enough that yesterday's
 * does not.
 */

import { freshnessOf, type Freshness } from '../emergency/freshness.js';

import type { Timestamp } from '../types/ids.js';

/**
 * How long a stock flag stands before the app stops repeating it, in minutes.
 *
 * Twelve hours — see the header. It is not `hospital_settings`-configurable:
 * no column exists for it, and inventing one would be schema nobody specified.
 */
export const STOCK_STALE_THRESHOLD_MINUTES = 12 * 60;

/** What a patient is told about one medicine at one pharmacy. */
export const STOCK_ANSWERS = ['in_stock', 'out_of_stock', 'unknown'] as const;
export type StockAnswer = (typeof STOCK_ANSWERS)[number];

/** One medicine on one pharmacy's shelf, as the console holds it. */
export interface StockFlagView {
  readonly medicineId: string;
  readonly genericName: string;
  readonly brandName: string | null;
  readonly form: string | null;
  readonly strengths: readonly string[];
  readonly inStock: boolean;
  /** When somebody last stood behind this flag. */
  readonly updatedAt: Timestamp;
}

/** One pharmacy's answer about one medicine, as the patient app shows it. */
export interface StockAvailabilityView {
  readonly hospitalId: string;
  readonly hospitalNameBn: string;
  readonly hospitalNameEn: string;
  /** Kilometres, when the app knew where the person was. */
  readonly distanceKm: number | null;
  readonly answer: StockAnswer;
  readonly freshness: Freshness;
}

/**
 * What one flag amounts to, given how old it is.
 *
 * An out-of-stock flag does **not** decay to unknown. "We have run out" stays
 * true until somebody says otherwise: a pharmacy restocking has every reason
 * to clear the flag, while a pharmacy that has run out has none to keep
 * saying so. Letting it lapse to unknown would quietly turn a known shortage
 * back into a maybe, and the maybe is the one that sends somebody out.
 */
export function stockAnswerFor(
  flag: Pick<StockFlagView, 'inStock' | 'updatedAt'> | null,
  now: Timestamp,
  thresholdMinutes: number = STOCK_STALE_THRESHOLD_MINUTES,
): { readonly answer: StockAnswer; readonly freshness: Freshness } {
  if (flag === null) {
    return {
      answer: 'unknown',
      freshness: freshnessOf([null], now, thresholdMinutes),
    };
  }

  const freshness = freshnessOf([flag.updatedAt], now, thresholdMinutes);

  if (!flag.inStock) return { answer: 'out_of_stock', freshness };
  return { answer: freshness.stale ? 'unknown' : 'in_stock', freshness };
}

/**
 * The search result, ordered the way somebody standing on a road needs it.
 *
 * Confirmed stock first, then unknown, then known-empty — a family will drive
 * to a maybe before they drive to a no. Within each group, nearest first, and
 * where no position was given, freshest first: with nothing to rank by
 * distance, the most recently confirmed claim is the most useful one.
 */
export function rankStockResults(
  results: readonly StockAvailabilityView[],
): StockAvailabilityView[] {
  const rank: Readonly<Record<StockAnswer, number>> = {
    in_stock: 0,
    unknown: 1,
    out_of_stock: 2,
  };

  return [...results].sort((a, b) => {
    if (rank[a.answer] !== rank[b.answer]) return rank[a.answer] - rank[b.answer];

    if (a.distanceKm !== null && b.distanceKm !== null && a.distanceKm !== b.distanceKm) {
      return a.distanceKm - b.distanceKm;
    }
    if (a.distanceKm !== null && b.distanceKm === null) return -1;
    if (a.distanceKm === null && b.distanceKm !== null) return 1;

    const aAge = a.freshness.ageMinutes;
    const bAge = b.freshness.ageMinutes;
    if (aAge === null && bAge === null) return a.hospitalNameEn.localeCompare(b.hospitalNameEn);
    if (aAge === null) return 1;
    if (bAge === null) return -1;
    return aAge - bAge;
  });
}

/**
 * The line a search screen puts above the results (`GR-05`).
 *
 * Counts rather than a verdict: "three pharmacies have it, two have run out,
 * four have not said" is a sentence a person can act on, and it never claims
 * a medicine is unavailable in Dhaka because four pharmacies were quiet.
 */
export interface StockSearchSummary {
  readonly inStock: number;
  readonly outOfStock: number;
  readonly unknown: number;
}

export function summariseStockSearch(
  results: readonly StockAvailabilityView[],
): StockSearchSummary {
  let inStock = 0;
  let outOfStock = 0;
  let unknown = 0;

  for (const result of results) {
    if (result.answer === 'in_stock') inStock += 1;
    else if (result.answer === 'out_of_stock') outOfStock += 1;
    else unknown += 1;
  }

  return { inStock, outOfStock, unknown };
}
