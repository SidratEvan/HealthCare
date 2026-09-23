import { describe, expect, it } from 'vitest';

import { lossAndRecovery, recoveredValueFor } from '../recovery.js';

/** Eight no-shows at a 600 taka chamber fee, nobody having prepaid. */
function noShows(overrides: Partial<Parameters<typeof lossAndRecovery>[0]> = {}) {
  return { count: 8, forgonePoisha: 480_000, prepaidPoisha: 0, ...overrides };
}

function recovery(overrides: Partial<Parameters<typeof lossAndRecovery>[1]> = {}) {
  return { offered: 0, accepted: 0, recoveredPoisha: 0, ...overrides };
}

describe('what an empty chair actually cost', () => {
  it('reports the whole fee as uncollected when nobody prepaid', () => {
    const figures = lossAndRecovery(noShows(), recovery());

    expect(figures.noShowCount).toBe(8);
    expect(figures.forgonePoisha).toBe(480_000);
    expect(figures.uncollectedPoisha).toBe(480_000);
    expect(figures.netLossPoisha).toBe(480_000);
  });

  it('does not claim a loss on money the hospital already has', () => {
    // Three of the eight paid through the app and never turned up. In this
    // version a no-show earns no refund, so that money stayed with the
    // hospital — counting it as lost would invoice them for their own cash.
    const figures = lossAndRecovery(noShows({ prepaidPoisha: 180_000 }), recovery());

    expect(figures.forgonePoisha).toBe(480_000);
    expect(figures.prepaidPoisha).toBe(180_000);
    expect(figures.uncollectedPoisha).toBe(300_000);
  });

  it('never reports a negative loss', () => {
    // Two queries against two tables, and a refund landing between them can
    // momentarily make prepaid exceed forgone. Zero is the floor.
    const figures = lossAndRecovery(
      noShows({ forgonePoisha: 120_000, prepaidPoisha: 180_000 }),
      recovery(),
    );

    expect(figures.uncollectedPoisha).toBe(0);
  });
});

describe('what the standby list won back', () => {
  it('subtracts recovered fees from the loss', () => {
    const figures = lossAndRecovery(
      noShows(),
      recovery({ offered: 6, accepted: 5, recoveredPoisha: 300_000 }),
    );

    expect(figures.recoveredPoisha).toBe(300_000);
    expect(figures.netLossPoisha).toBe(180_000);
    expect(figures.recoveryRate).toBeCloseTo(0.625);
    expect(figures.acceptanceRate).toBeCloseTo(5 / 6);
  });

  it('measures recovery against uncollected, not against the headline', () => {
    // Half the no-shows had prepaid, so only half the fee value was ever at
    // risk — and the waitlist got all of it back. Dividing by `forgone` would
    // report 50% and make prepayment look like a waitlist failure.
    const figures = lossAndRecovery(
      noShows({ prepaidPoisha: 240_000 }),
      recovery({ offered: 4, accepted: 4, recoveredPoisha: 240_000 }),
    );

    expect(figures.recoveryRate).toBe(1);
    expect(figures.netLossPoisha).toBe(0);
  });

  it('lets recovery exceed the loss rather than flattening it to zero', () => {
    // A standby patient pays today's fee. If the fee rose since the no-show
    // booked, the hospital is genuinely ahead, and that is the best thing the
    // feature does — it must not be hidden.
    const figures = lossAndRecovery(
      noShows({ count: 1, forgonePoisha: 50_000 }),
      recovery({ offered: 1, accepted: 1, recoveredPoisha: 60_000 }),
    );

    expect(figures.netLossPoisha).toBe(-10_000);
    expect(figures.recoveryRate).toBeCloseTo(1.2);
  });

  it('has no rate to report on a day with no no-shows', () => {
    // Null, not zero. A clean day did not fail at recovery; there was nothing
    // to recover, and 0% on the screen would read as a broken waitlist.
    const figures = lossAndRecovery({ count: 0, forgonePoisha: 0, prepaidPoisha: 0 }, recovery());

    expect(figures.recoveryRate).toBeNull();
    expect(figures.acceptanceRate).toBeNull();
    expect(figures.netLossPoisha).toBe(0);
  });

  it('separates whether standby patients answer from whether it mattered', () => {
    // Every offer was taken, but they were small fees against a large loss.
    // Acceptance is perfect and recovery is poor, and one figure cannot say so.
    const figures = lossAndRecovery(
      noShows(),
      recovery({ offered: 2, accepted: 2, recoveredPoisha: 60_000 }),
    );

    expect(figures.acceptanceRate).toBe(1);
    expect(figures.recoveryRate).toBeCloseTo(0.125);
  });
});

describe('the value written onto an accepted offer', () => {
  it('is the replacement booking’s own fee', () => {
    expect(recoveredValueFor(60_000)).toBe(60_000);
  });

  it('refuses anything that is not a whole, non-negative poisha figure', () => {
    expect(() => recoveredValueFor(-1)).toThrow(RangeError);
    expect(() => recoveredValueFor(60_000.5)).toThrow(RangeError);
  });

  it('accepts a free chamber', () => {
    // A hospital running a free clinic recovers nothing in taka and still
    // recovered the chair. Zero is a real answer, not a missing one.
    expect(recoveredValueFor(0)).toBe(0);
  });
});
