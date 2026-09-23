/**
 * Turnaround, measured rather than claimed (`FR-LAB-04`).
 *
 * "Turnaround time per test type is measured and visible to admin." So this
 * file computes one number from the stamps a lab actually left behind, and
 * refuses to produce one where the stamps are missing. It is the same
 * discipline as the rolling consultation rate (`FR-QUE-12`, `queue/rate.ts`):
 * a figure a hospital will be judged on is derived from what happened, never
 * from a configured expectation.
 *
 * No I/O.
 *
 * ## Which two stamps
 *
 * **Ordered to report ready.** Not sample-to-ready, though that is the
 * interval a lab would rather be measured on. A patient who was told "come
 * back this afternoon" is waiting from the moment the doctor ordered it, and
 * the hour their sample sat uncollected is part of what they waited. `PRD.md`
 * §3.2's honesty rule cuts this way: measure the promise the patient heard.
 *
 * Delivery is deliberately not the end point. `FR-LAB-03` delivers to the
 * wallet automatically, so ready-to-delivered is a measure of this system and
 * not of the lab, and folding it in would flatter or blame the wrong party.
 *
 * ## What an unfinished order contributes
 *
 * Nothing, and that is stated rather than silent. An order still being
 * processed has no turnaround yet; counting it as zero would drag every
 * average down, and dropping it quietly would let a lab improve its figure by
 * never finishing anything. `summariseTurnaround` therefore returns the
 * completed count, the open count and the oldest open order's age together —
 * a median beside "and eleven more have been open for up to nine hours" is
 * the honest shape (`GR-05`).
 */

import { toEpochMs } from '../util/time.js';

import { isOpenTestOrder, type TestOrderView } from './orders.js';

import type { Timestamp } from '../types/ids.js';

/**
 * One order's turnaround in seconds, or null when it has none yet.
 *
 * Null for anything not yet reported and for a cancelled order: a test nobody
 * finished has no turnaround, and saying so is not the same as saying zero.
 */
export function turnaroundSeconds(
  order: Pick<TestOrderView, 'state' | 'orderedAt' | 'readyAt'>,
): number | null {
  if (order.readyAt === null) return null;
  if (order.state === 'cancelled') return null;

  const elapsed = toEpochMs(order.readyAt) - toEpochMs(order.orderedAt);
  // A clock that went backwards is a data fault, not a fast lab.
  return elapsed >= 0 ? Math.round(elapsed / 1000) : null;
}

/** How long an unfinished order has been waiting, in seconds. */
export function openForSeconds(
  order: Pick<TestOrderView, 'state' | 'orderedAt'>,
  now: Timestamp | number,
): number | null {
  if (!isOpenTestOrder(order.state)) return null;
  const elapsed = (typeof now === 'number' ? now : toEpochMs(now)) - toEpochMs(order.orderedAt);
  return elapsed >= 0 ? Math.round(elapsed / 1000) : 0;
}

/** What one test type's turnaround adds up to. */
export interface TurnaroundSummary {
  readonly testCode: string;
  readonly testName: string;
  /** Orders that reached a report, and therefore have a measurement. */
  readonly completed: number;
  /** Orders still open, which contribute to no average (see the header). */
  readonly open: number;
  /**
   * The median of the completed orders, in seconds. Null when none has
   * finished — `FR-LAB-04` asks for a measurement, and there is not one yet.
   */
  readonly medianSeconds: number | null;
  /** The slowest completed order, which is what a complaint is about. */
  readonly slowestSeconds: number | null;
  /** How long the longest-waiting open order has been waiting. */
  readonly oldestOpenSeconds: number | null;
}

/**
 * The median, not the mean.
 *
 * One sample sent to Dhaka overnight turns a mean into a number nobody
 * recognises, and an admin comparing two months needs the typical case. The
 * outlier is not lost — `slowestSeconds` is beside it.
 */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  return Math.round((lower + upper) / 2);
}

/**
 * Turnaround per test type (`FR-LAB-04`), for the admin dashboard and the
 * lab's own header.
 *
 * Sorted slowest-median first, with the types that have no measurement yet
 * last: the point of the list is to find where the delay is.
 */
export function summariseTurnaround(
  orders: readonly TestOrderView[],
  now: Timestamp | number = Date.now(),
): TurnaroundSummary[] {
  const byCode = new Map<string, TestOrderView[]>();
  for (const order of orders) {
    const bucket = byCode.get(order.testCode);
    if (bucket === undefined) byCode.set(order.testCode, [order]);
    else bucket.push(order);
  }

  const summaries: TurnaroundSummary[] = [];

  for (const [testCode, bucket] of byCode) {
    const measured: number[] = [];
    let open = 0;
    let oldestOpen: number | null = null;

    for (const order of bucket) {
      const seconds = turnaroundSeconds(order);
      if (seconds !== null) {
        measured.push(seconds);
        continue;
      }
      const waiting = openForSeconds(order, now);
      if (waiting !== null) {
        open += 1;
        oldestOpen = oldestOpen === null ? waiting : Math.max(oldestOpen, waiting);
      }
    }

    summaries.push({
      testCode,
      testName: bucket[0]?.testName ?? testCode,
      completed: measured.length,
      open,
      medianSeconds: median(measured),
      slowestSeconds: measured.length > 0 ? Math.max(...measured) : null,
      oldestOpenSeconds: oldestOpen,
    });
  }

  return summaries.sort((a, b) => {
    // A type with no measurement sorts last whatever its open count: the
    // column being ranked is the median, and it does not have one.
    if (a.medianSeconds === null || b.medianSeconds === null) {
      if (a.medianSeconds === b.medianSeconds) return a.testName.localeCompare(b.testName);
      return a.medianSeconds === null ? 1 : -1;
    }
    return b.medianSeconds - a.medianSeconds;
  });
}
