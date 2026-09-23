import { describe, expect, it } from 'vitest';

import {
  readRefundPolicy,
  refundFor,
  refundIfCancelledNow,
  type RefundablePayment,
} from '../refund.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-23T10:00:00.000Z' as Timestamp;
const hoursFromNow = (hours: number): Timestamp =>
  new Date(Date.parse(NOW) + hours * 60 * 60 * 1000).toISOString() as Timestamp;

/** 1,500 taka consultation plus a 50 taka platform fee, paid. */
function payment(overrides: Partial<RefundablePayment> = {}): RefundablePayment {
  return {
    amountPoisha: 155_000,
    platformFeePoisha: 5_000,
    refundedPoisha: 0,
    paidAt: '2026-09-20T09:00:00.000Z' as Timestamp,
    ...overrides,
  };
}

const POLICY = {
  cutoffHours: 12,
  beforeCutoffPercent: 100,
  afterCutoffPercent: 50,
  platformFeeRefundable: false,
};

describe('reading a hospital’s policy', () => {
  it('reads a complete one', () => {
    expect(readRefundPolicy(POLICY)).toEqual({
      cutoffHours: 12,
      beforeCutoffPercent: 100,
      afterCutoffPercent: 50,
      platformFeeRefundable: false,
    });
  });

  it('defaults the platform fee to not refundable when the policy is silent', () => {
    // A default that quietly gives away somebody else's revenue is the wrong
    // way round.
    const read = readRefundPolicy({
      cutoffHours: 6,
      beforeCutoffPercent: 80,
      afterCutoffPercent: 0,
    });
    expect(read?.platformFeeRefundable).toBe(false);
  });

  it('refuses a half-written policy rather than filling in the gaps', () => {
    // A partial policy would state a refund the hospital never agreed to,
    // which is worse than having none.
    for (const bad of [
      {},
      { cutoffHours: 12 },
      { cutoffHours: 12, beforeCutoffPercent: 100 },
      { cutoffHours: -1, beforeCutoffPercent: 100, afterCutoffPercent: 50 },
      { cutoffHours: 12, beforeCutoffPercent: 140, afterCutoffPercent: 50 },
      { cutoffHours: 12, beforeCutoffPercent: -10, afterCutoffPercent: 50 },
      { cutoffHours: 12, beforeCutoffPercent: '100', afterCutoffPercent: 50 },
      {
        cutoffHours: 12,
        beforeCutoffPercent: 100,
        afterCutoffPercent: 50,
        platformFeeRefundable: 'yes',
      },
    ]) {
      expect(readRefundPolicy(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('refuses anything that is not an object', () => {
    for (const bad of [null, undefined, 42, 'policy', [], true]) {
      expect(readRefundPolicy(bad)).toBeNull();
    }
  });
});

describe('doctor absence is the platform’s guarantee (FR-PAY-07)', () => {
  it('returns everything, including the platform fee', () => {
    const decision = refundFor(payment(), {
      reason: 'doctor_absent',
      now: NOW,
      sessionStart: hoursFromNow(-2),
      policy: readRefundPolicy(POLICY),
    });

    expect(decision.refundPoisha).toBe(155_000);
    expect(decision.guaranteed).toBe(true);
    expect(decision.stated).toBe(true);
  });

  it('is full even where the hospital’s policy would refund nothing', () => {
    // The patient did not cancel. No cancellation policy applies to them.
    const harsh = readRefundPolicy({
      cutoffHours: 48,
      beforeCutoffPercent: 0,
      afterCutoffPercent: 0,
    });

    const decision = refundFor(payment(), {
      reason: 'doctor_absent',
      now: NOW,
      sessionStart: hoursFromNow(-1),
      policy: harsh,
    });

    expect(decision.refundPoisha).toBe(155_000);
  });

  it('is full with no policy at all, and says so rather than deferring', () => {
    const decision = refundFor(payment(), {
      reason: 'doctor_absent',
      now: NOW,
      sessionStart: hoursFromNow(-1),
      policy: null,
    });

    expect(decision.refundPoisha).toBe(155_000);
    expect(decision.stated).toBe(true);
  });

  it('returns only what is left when part has already gone back', () => {
    const decision = refundFor(payment({ refundedPoisha: 55_000 }), {
      reason: 'doctor_absent',
      now: NOW,
      sessionStart: hoursFromNow(-1),
      policy: null,
    });

    expect(decision.refundPoisha).toBe(100_000);
  });
});

describe('a cancellation follows the hospital’s terms (FR-PAY-03)', () => {
  it('refunds the better rate with enough notice', () => {
    const decision = refundIfCancelledNow(payment(), {
      now: NOW,
      sessionStart: hoursFromNow(24),
      policy: readRefundPolicy(POLICY),
    });

    // 100% of the consultation, and no platform fee: the serial was issued.
    expect(decision.refundPoisha).toBe(150_000);
    expect(decision.guaranteed).toBe(false);
    expect(decision.stated).toBe(true);
  });

  it('refunds the later rate inside the cutoff', () => {
    const decision = refundIfCancelledNow(payment(), {
      now: NOW,
      sessionStart: hoursFromNow(3),
      policy: readRefundPolicy(POLICY),
    });

    expect(decision.refundPoisha).toBe(75_000);
  });

  it('treats exactly the cutoff as enough notice', () => {
    const decision = refundIfCancelledNow(payment(), {
      now: NOW,
      sessionStart: hoursFromNow(12),
      policy: readRefundPolicy(POLICY),
    });

    expect(decision.refundPoisha).toBe(150_000);
  });

  it('returns the platform fee too where the policy says so', () => {
    const decision = refundIfCancelledNow(payment(), {
      now: NOW,
      sessionStart: hoursFromNow(24),
      policy: readRefundPolicy({ ...POLICY, platformFeeRefundable: true }),
    });

    expect(decision.refundPoisha).toBe(155_000);
  });

  it('says the hospital will decide when it has set no policy', () => {
    // `PRD.md` §3.2: never a computed zero presented as an answer.
    const decision = refundIfCancelledNow(payment(), {
      now: NOW,
      sessionStart: hoursFromNow(24),
      policy: null,
    });

    expect(decision.stated).toBe(false);
    expect(decision.refundPoisha).toBe(0);
  });

  it('never returns more than is left', () => {
    const decision = refundIfCancelledNow(payment({ refundedPoisha: 150_000 }), {
      now: NOW,
      sessionStart: hoursFromNow(48),
      policy: readRefundPolicy({ ...POLICY, platformFeeRefundable: true }),
    });

    expect(decision.refundPoisha).toBe(5_000);
  });
});

describe('when nothing was taken', () => {
  it('returns nothing, and calls that a stated outcome', () => {
    // Pay-at-hospital before the visit: there is no money to give back, and
    // that is an answer rather than an unknown.
    const decision = refundIfCancelledNow(payment({ paidAt: null }), {
      now: NOW,
      sessionStart: hoursFromNow(24),
      policy: readRefundPolicy(POLICY),
    });

    expect(decision.refundPoisha).toBe(0);
    expect(decision.stated).toBe(true);
  });

  it('returns nothing when it has all gone back already', () => {
    const decision = refundIfCancelledNow(payment({ refundedPoisha: 155_000 }), {
      now: NOW,
      sessionStart: hoursFromNow(24),
      policy: readRefundPolicy(POLICY),
    });

    expect(decision.refundPoisha).toBe(0);
    expect(decision.stated).toBe(true);
  });
});

describe('the sheet and the refund cannot disagree (FR-PAY-03)', () => {
  it('states before confirming exactly what it pays after', () => {
    const owed = payment();
    const at = { now: NOW, sessionStart: hoursFromNow(3), policy: readRefundPolicy(POLICY) };

    const stated = refundIfCancelledNow(owed, at);
    const paid = refundFor(owed, { reason: 'patient_cancelled', ...at });

    expect(stated).toEqual(paid);
  });
});
