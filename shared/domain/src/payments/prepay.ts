/**
 * Whether a booking must be paid for online first (`PRD.md` `FR-PAY-02`,
 * `FR-GST-14`; plans H3 and F3).
 *
 * Two reasons, and nothing else:
 *
 *   - **`hospital`**: the hospital takes no payment at the counter
 *     (`hospital_settings.prepay_required`).
 *   - **`no_shows`**: the hospital has turned the rule on, the booking is a
 *     guest's, and the number has not come to three serials at this hospital
 *     within the hospital's window (`FR-GST-14`). Counted at this hospital
 *     only: another hospital's attendance is that hospital's (`FR-NET-02`).
 *
 * Neither applies where the deployment takes no payment online: nobody is
 * turned away for a payment nobody can take. Pure; the counts are the
 * caller's.
 */

/** "Three no-shows on a phone number within a rolling window" (`FR-GST-14`). */
export const NOSHOW_PREPAY_THRESHOLD = 3;

export type PrepaymentReason = 'hospital' | 'no_shows';

export function prepaymentReason(input: {
  /** The deployment takes at least one online method. */
  readonly onlinePaymentTaken: boolean;
  readonly hospitalPaysFirst: boolean;
  /** A guest booking; the no-show rule is for "the next guest booking". */
  readonly guest: boolean;
  readonly noShowRuleOn: boolean;
  /** This number's no-shows at this hospital within the window. */
  readonly noShows: number;
}): PrepaymentReason | null {
  if (!input.onlinePaymentTaken) return null;
  if (input.hospitalPaysFirst) return 'hospital';
  if (input.guest && input.noShowRuleOn && input.noShows >= NOSHOW_PREPAY_THRESHOLD) {
    return 'no_shows';
  }
  return null;
}
