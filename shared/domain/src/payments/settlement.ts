/**
 * What a hospital is owed, and what it owes (`FR-PAY-05`).
 *
 * "Hospital settlement reports: bookings, collections, fees, payouts,
 * disputes." This file is the arithmetic; the repository supplies the rows
 * and the route hands the result to an administrator.
 *
 * No I/O.
 *
 * ## Five figures, and the relationship between them is the report
 *
 * A settlement is not a list of numbers. It is one sentence — *this is what
 * came in, this is what we keep, this is what you get* — and the figures only
 * mean anything together:
 *
 * ```
 *   collections            what patients actually paid
 * − refunds                what went back to them
 * = net collections        what the money movement came to
 * − platform fees          the itemised share (`FR-PAY-04`)
 * = payout                 what the hospital is due
 * ```
 *
 * **Cash is counted separately and never in the payout.** A patient who paid
 * at the counter already gave the hospital its money; including it in a payout
 * would pay them twice. So `atHospitalPoisha` is reported beside the payout
 * rather than inside it, and the platform fee on those bookings is money the
 * hospital owes *back* — which is what `feeOwedOnCashPoisha` is.
 *
 * **A refunded fee is not also kept.** Where a refund gave the platform fee
 * back to the patient (`platformFeeRefundable`), deducting the full fee from
 * the payout as well would charge the hospital for money the platform no
 * longer holds. The fee retained is therefore capped at what the patient did
 * *not* get back. That is exact at both ends — refund everything and the
 * platform retains nothing; refund nothing and it retains the whole fee — and
 * an approximation in between, because `payments` records one refunded total
 * rather than splitting it by line. A `platform_fee_refunded_poisha` column
 * would make it exact; that is recorded as an open decision rather than
 * guessed at here.
 *
 * ## Disputes
 *
 * `FR-PAY-05` names them, and there is no dispute mechanism in this version:
 * no table, no endpoint, nothing that could raise one. So the report carries
 * the count as a declared zero rather than omitting the line. A settlement
 * missing a row reads as "we did not look"; one saying zero says "we looked".
 */

import type { PaymentMethod, PaymentState } from '../types/enums.js';

/** One payment, as a settlement reads it. */
export interface SettlementRow {
  readonly amountPoisha: number;
  readonly platformFeePoisha: number;
  readonly refundedPoisha: number;
  readonly method: PaymentMethod;
  readonly state: PaymentState;
}

/** A period's settlement for one hospital. */
export interface Settlement {
  /** How many payments the period holds, whatever their state. */
  readonly payments: number;
  /** Payments that were actually taken — the ones the money lines stand on. */
  readonly collected: number;

  readonly collectionsPoisha: number;
  readonly refundsPoisha: number;
  readonly netCollectionsPoisha: number;

  readonly platformFeePoisha: number;
  /** What the hospital is due for what was collected online. */
  readonly payoutPoisha: number;

  /** Taken at the counter, so already the hospital's (see the header). */
  readonly atHospitalPoisha: number;
  /**
   * The platform's share of those, which the hospital owes back.
   *
   * Capped the same way the payout's fee is: a refunded booking's fee is not
   * owed, because the platform is not keeping it.
   */
  readonly feeOwedOnCashPoisha: number;

  /** `FR-PAY-05` names disputes; this version can raise none. */
  readonly disputes: number;

  /** What came in, by method, so a reconciliation has something to match. */
  readonly byMethod: readonly {
    readonly method: PaymentMethod;
    readonly count: number;
    readonly collectionsPoisha: number;
    readonly refundsPoisha: number;
  }[];
}

/** States in which money actually changed hands. */
const COLLECTED_STATES: readonly PaymentState[] = ['paid', 'refunded', 'partially_refunded'];

/** Methods where the hospital took the cash itself. */
const AT_HOSPITAL_METHODS: readonly PaymentMethod[] = ['cash', 'at_hospital'];

export function settle(rows: readonly SettlementRow[]): Settlement {
  let collected = 0;
  let collectionsPoisha = 0;
  let refundsPoisha = 0;
  let platformFeePoisha = 0;
  let atHospitalPoisha = 0;
  let feeOwedOnCashPoisha = 0;
  /** Online collections and refunds, kept apart so the payout is exact. */
  let onlineCollections = 0;
  let onlineRefunds = 0;

  const byMethod = new Map<
    PaymentMethod,
    { count: number; collectionsPoisha: number; refundsPoisha: number }
  >();

  for (const row of rows) {
    // A pending or failed payment moved no money. It is counted in
    // `payments` so the report can say how many attempts there were, and
    // nowhere else.
    if (!COLLECTED_STATES.includes(row.state)) continue;

    collected += 1;
    collectionsPoisha += row.amountPoisha;
    refundsPoisha += row.refundedPoisha;

    // The fee is kept only out of what the patient did not get back.
    const retainedFee = Math.max(
      0,
      Math.min(row.platformFeePoisha, row.amountPoisha - row.refundedPoisha),
    );

    const cash = AT_HOSPITAL_METHODS.includes(row.method);
    if (cash) {
      atHospitalPoisha += row.amountPoisha;
      feeOwedOnCashPoisha += retainedFee;
    } else {
      platformFeePoisha += retainedFee;
      onlineCollections += row.amountPoisha;
      onlineRefunds += row.refundedPoisha;
    }

    const bucket = byMethod.get(row.method) ?? {
      count: 0,
      collectionsPoisha: 0,
      refundsPoisha: 0,
    };
    byMethod.set(row.method, {
      count: bucket.count + 1,
      collectionsPoisha: bucket.collectionsPoisha + row.amountPoisha,
      refundsPoisha: bucket.refundsPoisha + row.refundedPoisha,
    });
  }

  const netCollectionsPoisha = collectionsPoisha - refundsPoisha;

  // Only what came in online is ours to pay out. The cash the hospital took
  // is already theirs, and paying it again would be paying it twice.
  const payoutPoisha = Math.max(0, onlineCollections - onlineRefunds - platformFeePoisha);

  return {
    payments: rows.length,
    collected,
    collectionsPoisha,
    refundsPoisha,
    netCollectionsPoisha,
    platformFeePoisha,
    payoutPoisha,
    atHospitalPoisha,
    feeOwedOnCashPoisha,
    disputes: 0,
    byMethod: [...byMethod.entries()]
      .map(([method, totals]) => ({ method, ...totals }))
      .sort((a, b) => b.collectionsPoisha - a.collectionsPoisha),
  };
}
