/**
 * How often the wait reception quoted was the wait a patient had (`FR-ADM-01`,
 * `FR-REC-18`).
 *
 * The check-in quote is a promise made across the counter. Measuring the wait
 * without measuring the promise would tell a director how long people sat and
 * nothing about whether they were told the truth — and "the counter said
 * twenty minutes" is what a patient remembers, not the average.
 */

/**
 * The grace a quote gets before it counts as broken, in minutes.
 *
 * Five: a quote is said in round numbers ("about twenty"), so a patient called
 * at twenty-four minutes was told the truth. Past five over, the round number
 * stops covering it.
 */
export const QUOTE_TOLERANCE_MINUTES = 5;

export interface QuoteCounts {
  /** Patients who were quoted a wait and have since been called. */
  readonly quoted: number;
  /** Of those, how many were called within the quote plus the tolerance. */
  readonly kept: number;
  /**
   * Mean minutes past the quote, signed: negative when people were called
   * sooner than they were told. Null when nothing was quoted.
   */
  readonly avgOverMinutes: number | null;
}

export interface QuoteAccuracy extends QuoteCounts {
  /** `kept / quoted`, or null with nothing to divide — never a zero. */
  readonly keptRate: number | null;
}

export function quoteAccuracy(counts: QuoteCounts): QuoteAccuracy {
  return {
    ...counts,
    keptRate: counts.quoted === 0 ? null : counts.kept / counts.quoted,
    avgOverMinutes:
      counts.quoted === 0 || counts.avgOverMinutes === null
        ? null
        : Math.round(counts.avgOverMinutes),
  };
}
