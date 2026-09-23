/**
 * What no-shows cost, and what the standby list got back (`FR-ADM-03`).
 *
 * "No-show count and taka value, plus value recovered through waitlist." This
 * file is the arithmetic; `admin.repo` supplies the rows and `S-B-10` renders
 * the sentence.
 *
 * No I/O.
 *
 * ## The figure this product is sold on, so it must not overstate
 *
 * A director is shown one number — *this is what empty chairs cost you* — and
 * it is the number that decides whether the platform is bought. Which is
 * exactly why it is built to be argued with.
 *
 * A no-show's fee is **not** automatically money the hospital lost. In the
 * chamber model most patients pay at the counter when they arrive, so somebody
 * who never came never paid and the fee is genuinely forgone. But a patient
 * who prepaid through the app and then did not turn up has already given the
 * hospital its money — and in this version a no-show earns no refund, only
 * doctor absence does (`FR-PAY-07`). Counting that fee as a loss would invoice
 * the hospital for cash sitting in its own account.
 *
 * So three figures, not one:
 *
 * ```
 *   forgone      the fee on every no-show chair                — what the slot was worth
 * − prepaid      the part of it already collected              — money the hospital kept
 * = uncollected  the part that never arrived                   — the honest loss
 * + recovered    fees from standby patients who took the chair — what the waitlist won back
 * ```
 *
 * `uncollected` is the claim. `forgone` is the headline only when it equals
 * it, which it does for every counter booking — and the demo is mostly counter
 * bookings, so the pitch number is not diminished by being correct.
 *
 * ## Recovery is measured against uncollected, not against forgone
 *
 * A waitlist cannot recover money the hospital never lost. Dividing recovered
 * fees by `forgone` would report a recovery rate that quietly falls as more
 * patients prepay, which is the opposite of the truth: prepayment and standby
 * both help, and a figure where one cancels the other is a broken instrument.
 */

/** One no-show chair, as the repository counts them up. */
export interface NoShowTotals {
  /** How many bookings ended `no_show` in the window. */
  readonly count: number;
  /** Their fees, summed — what the chairs were worth. */
  readonly forgonePoisha: number;
  /** How much of that had already been paid and not refunded. */
  readonly prepaidPoisha: number;
}

/** What the standby list won back, as `slot_offers` records it. */
export interface RecoveryTotals {
  /** Offers made in the window. */
  readonly offered: number;
  /** Offers a standby patient took. */
  readonly accepted: number;
  /** `slot_offers.recovered_value_poisha`, summed over accepted offers. */
  readonly recoveredPoisha: number;
}

/** The block `S-B-10`'s "Loss & recovery" section renders (`FR-ADM-03`). */
export interface LossAndRecovery {
  readonly noShowCount: number;
  readonly forgonePoisha: number;
  readonly prepaidPoisha: number;
  /** The honest loss: fee value of empty chairs that was never collected. */
  readonly uncollectedPoisha: number;
  readonly offered: number;
  readonly accepted: number;
  readonly recoveredPoisha: number;
  /**
   * Recovered as a share of uncollected, 0–1, or null when there was nothing
   * to recover. Null rather than zero: a day with no no-shows has no recovery
   * rate, and showing 0% would read as a waitlist that failed.
   */
  readonly recoveryRate: number | null;
  /**
   * Accepted as a share of offers, 0–1, or null when nothing was offered.
   * Separate from `recoveryRate` because they answer different questions: this
   * one is whether standby patients respond, the other is whether it mattered.
   */
  readonly acceptanceRate: number | null;
  /** What the empty chairs came to after the waitlist did its work. */
  readonly netLossPoisha: number;
}

export function lossAndRecovery(noShows: NoShowTotals, recovery: RecoveryTotals): LossAndRecovery {
  // Clamped at zero because the two figures come from different tables and a
  // refund landing between the two queries could make prepaid momentarily
  // exceed forgone. A negative loss is not a thing a director can read.
  const uncollectedPoisha = Math.max(0, noShows.forgonePoisha - noShows.prepaidPoisha);

  return {
    noShowCount: noShows.count,
    forgonePoisha: noShows.forgonePoisha,
    prepaidPoisha: noShows.prepaidPoisha,
    uncollectedPoisha,
    offered: recovery.offered,
    accepted: recovery.accepted,
    recoveredPoisha: recovery.recoveredPoisha,
    recoveryRate: uncollectedPoisha === 0 ? null : recovery.recoveredPoisha / uncollectedPoisha,
    acceptanceRate: recovery.offered === 0 ? null : recovery.accepted / recovery.offered,

    // Not clamped at zero the way `uncollectedPoisha` is. A waitlist can
    // genuinely recover more than was lost — a standby patient pays the
    // session's current fee, which may be higher than the one the no-show was
    // quoted — and flattening that to zero would hide the best outcome the
    // feature produces.
    netLossPoisha: uncollectedPoisha - recovery.recoveredPoisha,
  };
}

/**
 * What accepting an offer recovered, in poisha.
 *
 * Written onto `slot_offers.recovered_value_poisha` at the moment of
 * acceptance, because the column exists precisely so this is not recomputed
 * later "from a fee that may since have changed" (migration 0006).
 *
 * It is the replacement booking's own fee, not the no-show's. The hospital
 * bills whoever sits in the chair at today's rate; if the fee rose since the
 * original booking, the hospital recovered more than it lost, and if it fell,
 * less. Either way the figure is what actually changed hands.
 */
export function recoveredValueFor(replacementFeePoisha: number): number {
  if (!Number.isInteger(replacementFeePoisha) || replacementFeePoisha < 0) {
    throw new RangeError('A recovered value is a non-negative whole number of poisha.');
  }
  return replacementFeePoisha;
}
