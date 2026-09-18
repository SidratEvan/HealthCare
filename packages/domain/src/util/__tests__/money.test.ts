/**
 * Money (DB-P5). Integer poisha, no floats, no silent rounding.
 *
 * The tests that matter here are the ones about a receipt adding up: FR-PAY-04
 * promises the patient always sees who gets what, and a fee computed one way
 * against a remainder computed another is how that promise breaks by a poisha.
 */

import { describe, expect, it } from 'vitest';

import {
  add,
  fromTaka,
  multiply,
  percentage,
  poisha,
  split,
  subtract,
  sum,
  toTakaParts,
  MAX_POISHA,
  POISHA_PER_TAKA,
  ZERO_POISHA,
} from '../money.js';

describe('constructing money', () => {
  it('accepts a whole number of poisha', () => {
    expect(poisha(80_000)).toBe(80_000);
  });

  it('refuses a fraction, because a fraction means taka leaked in', () => {
    expect(() => poisha(12.5)).toThrow(/integer count of poisha/);
  });

  it('refuses a negative amount', () => {
    expect(() => poisha(-1)).toThrow(/cannot be negative/);
  });

  it('refuses an amount past the ceiling, so an overflow fails loudly', () => {
    expect(() => poisha(MAX_POISHA + 1)).toThrow(/maximum/);
  });

  it('converts whole taka', () => {
    expect(fromTaka(800)).toBe(80_000);
    expect(POISHA_PER_TAKA).toBe(100);
  });

  it('refuses fractional taka, and says what to write instead', () => {
    expect(() => fromTaka(12.5)).toThrow(/poisha\(1250\)/);
  });
});

describe('arithmetic', () => {
  it('adds', () => {
    expect(add(fromTaka(800), fromTaka(50))).toBe(85_000);
  });

  it('subtracts, and refuses to go below zero', () => {
    expect(subtract(fromTaka(800), fromTaka(50))).toBe(75_000);
    expect(() => subtract(fromTaka(50), fromTaka(800))).toThrow(/cannot be negative/);
  });

  it('multiplies by a whole factor only', () => {
    expect(multiply(fromTaka(800), 3)).toBe(240_000);
    expect(() => multiply(fromTaka(800), 0.5)).toThrow(/whole factor/);
  });

  it('sums a list of rows', () => {
    expect(sum([fromTaka(500), fromTaka(800), fromTaka(1_200)])).toBe(250_000);
    expect(sum([])).toBe(ZERO_POISHA);
  });
});

describe('the platform fee (FR-PAY-04)', () => {
  it('takes a percentage exactly when it divides evenly', () => {
    expect(percentage(fromTaka(800), 5)).toBe(4_000);
  });

  it('rounds to the poisha when it does not', () => {
    // 3% of ৳333 is ৳9.99, which is 999 poisha exactly — no rounding needed.
    expect(percentage(fromTaka(333), 3)).toBe(999);
    // 7% of ৳101 is 707 poisha exactly.
    expect(percentage(fromTaka(101), 7)).toBe(707);
  });

  it('refuses a percentage outside 0-100', () => {
    expect(() => percentage(fromTaka(800), -1)).toThrow(/out of range/);
    expect(() => percentage(fromTaka(800), 101)).toThrow(/out of range/);
  });

  it('splits an amount so the two halves add back to it, always', () => {
    // The property that keeps a receipt honest: whatever the amount and
    // whatever the rate, the patient's total is what was charged.
    for (const takaAmount of [1, 7, 13, 99, 333, 800, 1_250, 2_001]) {
      for (const percent of [0, 1, 2.5, 5, 7.5, 12, 33.3, 100]) {
        const amount = fromTaka(takaAmount);
        const { share, remainder } = split(amount, percent);

        expect(share + remainder, `৳${String(takaAmount)} at ${String(percent)}%`).toBe(amount);
      }
    }
  });
});

describe('formatting hand-off', () => {
  it('splits into taka and poisha for a formatter, never for arithmetic', () => {
    expect(toTakaParts(poisha(125_050))).toEqual({ taka: 1_250, poisha: 50 });
    expect(toTakaParts(poisha(99))).toEqual({ taka: 0, poisha: 99 });
  });
});

describe('the fees the demo data uses', () => {
  it('handles the 500-2000 BDT range from FR-DEM-02 without a rounding artefact', () => {
    for (let taka = 500; taka <= 2_000; taka += 100) {
      const fee = fromTaka(taka);
      const { share, remainder } = split(fee, 5);

      expect(share + remainder).toBe(fee);
      expect(Number.isInteger(share)).toBe(true);
    }
  });
});
