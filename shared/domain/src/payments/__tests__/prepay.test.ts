/**
 * Whether a booking must be paid for first (`FR-PAY-02`, `FR-GST-14`; plan F3).
 */

import { describe, expect, it } from 'vitest';

import { NOSHOW_PREPAY_THRESHOLD, prepaymentReason } from '../prepay.js';

const base = {
  onlinePaymentTaken: true,
  hospitalPaysFirst: false,
  guest: true,
  noShowRuleOn: true,
  noShows: 0,
} as const;

describe('prepaymentReason', () => {
  it('asks nothing of a number with fewer than three no-shows', () => {
    expect(prepaymentReason({ ...base, noShows: NOSHOW_PREPAY_THRESHOLD - 1 })).toBeNull();
  });

  it('asks a guest with three no-shows to pay first, where the hospital has the rule on', () => {
    expect(prepaymentReason({ ...base, noShows: 3 })).toBe('no_shows');
    expect(prepaymentReason({ ...base, noShows: 7 })).toBe('no_shows');
  });

  it('is off until the hospital turns it on', () => {
    expect(prepaymentReason({ ...base, noShowRuleOn: false, noShows: 5 })).toBeNull();
  });

  it('is for a guest booking only (FR-GST-14)', () => {
    expect(prepaymentReason({ ...base, guest: false, noShows: 5 })).toBeNull();
  });

  it('never applies where no payment can be taken online', () => {
    expect(prepaymentReason({ ...base, onlinePaymentTaken: false, noShows: 9 })).toBeNull();
    expect(
      prepaymentReason({ ...base, onlinePaymentTaken: false, hospitalPaysFirst: true }),
    ).toBeNull();
  });

  it('gives the hospital’s own rule first', () => {
    expect(prepaymentReason({ ...base, hospitalPaysFirst: true, noShows: 4 })).toBe('hospital');
    expect(prepaymentReason({ ...base, hospitalPaysFirst: true, guest: false })).toBe('hospital');
  });
});
