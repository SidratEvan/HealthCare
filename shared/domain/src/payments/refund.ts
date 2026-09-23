/**
 * What a patient gets back, and why (`FR-PAY-03`, `FR-PAY-07`).
 *
 * One definition of the refund rule, used by the API to decide a refund and
 * by `MOD-A08-CANCEL` to state it **before** a patient confirms — which is
 * the whole of `FR-PAY-03`: "refund rules for cancellation and doctor absence
 * are stated before payment and enforced automatically." A rule the screen
 * computes one way and the server another is a rule that gets stated wrongly.
 *
 * No I/O.
 *
 * ## Two rules, and only one of them is the hospital's
 *
 * **Doctor absence is the platform's guarantee.** `FR-PAY-07`: "doctor
 * absence triggers automatic refund eligibility without the patient asking."
 * A person who paid, turned up, and was never seen because nobody came to the
 * chamber is owed all of it — there is no version of that where a hospital's
 * cancellation policy applies, because the patient did not cancel. So it is
 * full, always, and no `refund_policy` can reduce it.
 *
 * **Cancellation is the hospital's.** How much comes back when a patient
 * changes their mind is a commercial term between that hospital and its
 * patients, and it lives in `hospital_settings.refund_policy`.
 *
 * ## The shape of `refund_policy`, and why it is defined here
 *
 * No document defines it. The column is an untyped `jsonb` defaulting to
 * `{}`, and this file is the first thing that needs to read one, so the shape
 * is declared here and validated on the way in. It is deliberately the
 * smallest thing that expresses what `FR-PAY-03` requires:
 *
 * ```jsonc
 * {
 *   "cutoffHours": 12,      // cancel at least this long before the session
 *   "beforeCutoffPercent": 100,
 *   "afterCutoffPercent": 50,
 *   "platformFeeRefundable": false
 * }
 * ```
 *
 * **An absent or unreadable policy refunds nothing and says so** — it does
 * not fall back to a percentage nobody agreed to. `PRD.md` §3.2: degrade
 * honestly. A hospital that has not set a policy has not promised one, and
 * `MOD-A08-CANCEL` already says "ফেরতের বিষয়টি হাসপাতাল জানাবে" in that
 * case rather than inventing a number.
 *
 * ## The platform fee is not automatically the hospital's to refund
 *
 * `FR-PAY-04` makes the platform fee a separate line the patient can see, so
 * it is separately refundable and the policy says whether it comes back. It
 * defaults to **not** refundable, because the platform did its work — the
 * serial was issued and held — and because a default that quietly gives away
 * somebody else's revenue is the wrong way round. With
 * `PLATFORM_FEE_POISHA=0` this changes nothing in the demo.
 */

import { toEpochMs } from '../util/time.js';

import type { Timestamp } from '../types/ids.js';

/**
 * Why a refund is owed. Recorded on the payment, and shown to the patient.
 *
 * `standby_unseated`: paid when joining a standby list (`FR-PAT-26`) and never
 * given a chair — the session ended first, or they left the list. Nothing was
 * delivered, so all of it comes back, as it does for an absent doctor.
 */
export const REFUND_REASONS = [
  'patient_cancelled',
  'doctor_absent',
  'session_ended',
  'standby_unseated',
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** A hospital's cancellation terms, once validated. */
export interface RefundPolicy {
  /** Cancel at least this many hours before the session for the better rate. */
  readonly cutoffHours: number;
  /** Percentage of the consultation fee returned before the cutoff, 0–100. */
  readonly beforeCutoffPercent: number;
  /** Percentage returned after it, 0–100. */
  readonly afterCutoffPercent: number;
  /** Whether the platform fee comes back too. Defaults to false. */
  readonly platformFeeRefundable: boolean;
}

/**
 * Reads a `hospital_settings.refund_policy` object.
 *
 * Null for anything that is not a complete, sane policy — missing fields, a
 * percentage outside 0–100, a negative cutoff. A half-written policy is more
 * dangerous than none: it would state a refund the hospital never agreed to.
 * The caller turns null into "the hospital will tell you", never into 0%
 * presented as a decision.
 */
export function readRefundPolicy(value: unknown): RefundPolicy | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const cutoffHours = raw['cutoffHours'];
  const before = raw['beforeCutoffPercent'];
  const after = raw['afterCutoffPercent'];
  const feeRefundable = raw['platformFeeRefundable'];

  if (!isPercent(before) || !isPercent(after)) return null;
  if (typeof cutoffHours !== 'number' || !Number.isFinite(cutoffHours) || cutoffHours < 0) {
    return null;
  }
  if (feeRefundable !== undefined && typeof feeRefundable !== 'boolean') return null;

  return {
    cutoffHours,
    beforeCutoffPercent: before,
    afterCutoffPercent: after,
    platformFeeRefundable: feeRefundable === true,
  };
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

/** What a payment is, as far as a refund is concerned. */
export interface RefundablePayment {
  readonly amountPoisha: number;
  readonly platformFeePoisha: number;
  /** What has already gone back, so a second refund cannot exceed the rest. */
  readonly refundedPoisha: number;
  /** Null when nothing was ever taken — pay-at-hospital before the visit. */
  readonly paidAt: Timestamp | null;
}

/** The decision, in the form the service writes and the screen states. */
export interface RefundDecision {
  readonly refundPoisha: number;
  readonly reason: RefundReason;
  /**
   * True when the rule is the platform's guarantee rather than the
   * hospital's terms — which is what lets a screen say *why* it is full.
   */
  readonly guaranteed: boolean;
  /**
   * False when no policy could be read, so the caller says the hospital will
   * decide rather than presenting a computed zero as an answer.
   */
  readonly stated: boolean;
}

/**
 * Nothing was taken, so nothing comes back — and that is a *stated* outcome
 * rather than an unknown one.
 */
function nothingToRefund(reason: RefundReason, guaranteed: boolean): RefundDecision {
  return { refundPoisha: 0, reason, guaranteed, stated: true };
}

/**
 * What comes back if this payment were refunded now.
 *
 * `sessionStart` is when the chamber was due to begin, which is what the
 * cutoff is measured against — not when the booking was made. A person who
 * books a week ahead and cancels a week ahead has given the same notice as
 * one who books and cancels within an hour of each other.
 */
export function refundFor(
  payment: RefundablePayment,
  input: {
    readonly reason: RefundReason;
    readonly now: Timestamp;
    readonly sessionStart: Timestamp;
    /** The hospital's terms, or null when it has not set any. */
    readonly policy: RefundPolicy | null;
  },
): RefundDecision {
  const remaining = payment.amountPoisha - payment.refundedPoisha;

  // Nothing was ever collected — pay-at-hospital, or a payment that never
  // completed. There is no money to return, whatever the rule says.
  if (payment.paidAt === null || remaining <= 0) {
    return nothingToRefund(input.reason, input.reason !== 'patient_cancelled');
  }

  // `FR-PAY-07`. The patient did not cancel; nobody saw them. All of it,
  // including the platform fee — the serial was worth nothing to them.
  if (
    input.reason === 'doctor_absent' ||
    input.reason === 'session_ended' ||
    input.reason === 'standby_unseated'
  ) {
    return { refundPoisha: remaining, reason: input.reason, guaranteed: true, stated: true };
  }

  // A cancellation, and the hospital has not said what it does about those.
  if (input.policy === null) {
    return { refundPoisha: 0, reason: input.reason, guaranteed: false, stated: false };
  }

  const hoursOfNotice = (toEpochMs(input.sessionStart) - toEpochMs(input.now)) / (60 * 60 * 1000);
  const percent =
    hoursOfNotice >= input.policy.cutoffHours
      ? input.policy.beforeCutoffPercent
      : input.policy.afterCutoffPercent;

  const consultationPoisha = payment.amountPoisha - payment.platformFeePoisha;
  const consultationBack = Math.round((consultationPoisha * percent) / 100);
  const feeBack = input.policy.platformFeeRefundable
    ? Math.round((payment.platformFeePoisha * percent) / 100)
    : 0;

  return {
    // Never more than is left, whatever the arithmetic says. The database
    // refuses it too (`payments_refund_within_amount`); this is the layer
    // that makes the refusal unreachable rather than relied upon.
    refundPoisha: Math.min(consultationBack + feeBack, remaining),
    reason: input.reason,
    guaranteed: false,
    stated: true,
  };
}

/**
 * What `MOD-A08-CANCEL` says before a patient confirms (`FR-PAY-03`).
 *
 * The same computation as the refund itself, run against the clock now, so
 * the sentence a patient reads and the amount they receive cannot disagree.
 * Returns `stated: false` where the hospital has no policy, which is the case
 * the sheet already handles by naming the hospital rather than a number.
 */
export function refundIfCancelledNow(
  payment: RefundablePayment,
  input: {
    readonly now: Timestamp;
    readonly sessionStart: Timestamp;
    readonly policy: RefundPolicy | null;
  },
): RefundDecision {
  return refundFor(payment, {
    reason: 'patient_cancelled',
    now: input.now,
    sessionStart: input.sessionStart,
    policy: input.policy,
  });
}
