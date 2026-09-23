import { describe, expect, it } from 'vitest';

import { settle, type SettlementRow } from '../settlement.js';

/** 1,500 taka consultation plus a 50 taka platform fee, paid online. */
function row(overrides: Partial<SettlementRow> = {}): SettlementRow {
  return {
    amountPoisha: 155_000,
    platformFeePoisha: 5_000,
    refundedPoisha: 0,
    method: 'bkash',
    state: 'paid',
    ...overrides,
  };
}

describe('the five figures, and how they relate', () => {
  it('reports collections, refunds, fees and payout for online money', () => {
    const report = settle([row(), row(), row({ refundedPoisha: 155_000, state: 'refunded' })]);

    expect(report.payments).toBe(3);
    expect(report.collected).toBe(3);
    expect(report.collectionsPoisha).toBe(465_000);
    expect(report.refundsPoisha).toBe(155_000);
    expect(report.netCollectionsPoisha).toBe(310_000);

    // Two fees retained; the refunded booking's is not kept.
    expect(report.platformFeePoisha).toBe(10_000);
    expect(report.payoutPoisha).toBe(300_000);
  });

  it('never deducts a fee the platform gave back', () => {
    // The patient got everything, fee included. Charging the hospital for it
    // would make them pay for money nobody is holding.
    const report = settle([row({ refundedPoisha: 155_000, state: 'refunded' })]);

    expect(report.platformFeePoisha).toBe(0);
    expect(report.payoutPoisha).toBe(0);
  });

  it('keeps the whole fee when nothing was refunded', () => {
    const report = settle([row()]);
    expect(report.platformFeePoisha).toBe(5_000);
    expect(report.payoutPoisha).toBe(150_000);
  });

  it('keeps the fee out of a partial refund that leaves enough', () => {
    const report = settle([row({ refundedPoisha: 75_000, state: 'partially_refunded' })]);

    expect(report.platformFeePoisha).toBe(5_000);
    expect(report.payoutPoisha).toBe(75_000);
  });
});

describe('cash is the hospital’s already', () => {
  it('reports it beside the payout, never inside it', () => {
    // Paying it out would pay the hospital twice for the same booking.
    const report = settle([row({ method: 'at_hospital' }), row({ method: 'bkash' })]);

    expect(report.atHospitalPoisha).toBe(155_000);
    expect(report.payoutPoisha).toBe(150_000);
  });

  it('counts the fee on cash as owed back to the platform', () => {
    const report = settle([row({ method: 'cash' })]);

    expect(report.feeOwedOnCashPoisha).toBe(5_000);
    expect(report.payoutPoisha).toBe(0);
    expect(report.platformFeePoisha).toBe(0);
  });

  it('does not owe a fee on a refunded cash booking', () => {
    const report = settle([row({ method: 'cash', refundedPoisha: 155_000, state: 'refunded' })]);

    expect(report.feeOwedOnCashPoisha).toBe(0);
  });
});

describe('what is counted and what is not', () => {
  it('counts a pending or failed payment as an attempt and nothing more', () => {
    const report = settle([
      row({ state: 'pending' }),
      row({ state: 'failed' }),
      row({ state: 'paid' }),
    ]);

    expect(report.payments).toBe(3);
    expect(report.collected).toBe(1);
    expect(report.collectionsPoisha).toBe(155_000);
  });

  it('never reports a negative payout', () => {
    // More refunded than the fee could cover; the answer is zero owed, not a
    // number that reads as the hospital owing the platform.
    const report = settle([row({ refundedPoisha: 154_000, state: 'partially_refunded' })]);
    expect(report.payoutPoisha).toBeGreaterThanOrEqual(0);
  });

  it('reports a period with nothing in it as zeroes, not as absent', () => {
    const report = settle([]);

    expect(report.payments).toBe(0);
    expect(report.collectionsPoisha).toBe(0);
    expect(report.payoutPoisha).toBe(0);
    expect(report.byMethod).toEqual([]);
  });

  it('declares disputes as zero rather than omitting the line', () => {
    // `FR-PAY-05` names them and this version can raise none. A missing row
    // reads as "we did not look"; a zero says "we looked".
    expect(settle([row()]).disputes).toBe(0);
  });
});

describe('by method, so a reconciliation has something to match', () => {
  it('groups and ranks by what came in', () => {
    const report = settle([
      row({ method: 'bkash' }),
      row({ method: 'bkash' }),
      row({ method: 'nagad' }),
      row({ method: 'at_hospital' }),
    ]);

    expect(report.byMethod[0]).toMatchObject({ method: 'bkash', count: 2 });
    expect(report.byMethod.map((entry) => entry.method)).toHaveLength(3);
    expect(report.byMethod.reduce((total, entry) => total + entry.collectionsPoisha, 0)).toBe(
      report.collectionsPoisha,
    );
  });
});
