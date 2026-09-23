import { describe, expect, it } from 'vitest';

import {
  rankStockResults,
  stockAnswerFor,
  summariseStockSearch,
  STOCK_STALE_THRESHOLD_MINUTES,
  type StockAvailabilityView,
} from '../stock.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-22T10:00:00.000Z' as Timestamp;
const minutesAgo = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString() as Timestamp;

describe('three answers, not two', () => {
  it('says in stock for a flag somebody stood behind recently', () => {
    const { answer, freshness } = stockAnswerFor({ inStock: true, updatedAt: minutesAgo(30) }, NOW);
    expect(answer).toBe('in_stock');
    expect(freshness.stale).toBe(false);
    expect(freshness.ageMinutes).toBe(30);
  });

  it('says unknown for a medicine this pharmacy has never flagged', () => {
    const { answer, freshness } = stockAnswerFor(null, NOW);
    expect(answer).toBe('unknown');
    expect(freshness.asOf).toBeNull();
    expect(freshness.stale).toBe(true);
  });

  it('lets an in-stock claim lapse to unknown rather than repeating it', () => {
    const stale = minutesAgo(STOCK_STALE_THRESHOLD_MINUTES + 1);
    expect(stockAnswerFor({ inStock: true, updatedAt: stale }, NOW).answer).toBe('unknown');
  });

  it('keeps an out-of-stock flag standing however old it is', () => {
    // "We have run out" stays true until somebody says otherwise: a pharmacy
    // that restocked has every reason to clear the flag.
    const ancient = minutesAgo(STOCK_STALE_THRESHOLD_MINUTES * 10);
    const { answer, freshness } = stockAnswerFor({ inStock: false, updatedAt: ancient }, NOW);
    expect(answer).toBe('out_of_stock');
    expect(freshness.stale).toBe(true);
  });

  it('goes stale exactly at the threshold, as every other freshness line does', () => {
    const exactly = minutesAgo(STOCK_STALE_THRESHOLD_MINUTES);
    expect(stockAnswerFor({ inStock: true, updatedAt: exactly }, NOW).answer).toBe('unknown');

    const justUnder = minutesAgo(STOCK_STALE_THRESHOLD_MINUTES - 1);
    expect(stockAnswerFor({ inStock: true, updatedAt: justUnder }, NOW).answer).toBe('in_stock');
  });
});

function result(overrides: Partial<StockAvailabilityView> = {}): StockAvailabilityView {
  return {
    hospitalId: 'hospital-1',
    hospitalNameBn: 'শাপলা',
    hospitalNameEn: 'Shapla',
    distanceKm: null,
    answer: 'unknown',
    freshness: { asOf: minutesAgo(60), ageMinutes: 60, stale: false },
    ...overrides,
  };
}

describe('the order somebody standing on a road needs', () => {
  it('puts confirmed stock first, then unknown, then known-empty', () => {
    const ranked = rankStockResults([
      result({ hospitalId: 'empty', answer: 'out_of_stock' }),
      result({ hospitalId: 'maybe', answer: 'unknown' }),
      result({ hospitalId: 'has-it', answer: 'in_stock' }),
    ]);

    expect(ranked.map((entry) => entry.hospitalId)).toEqual(['has-it', 'maybe', 'empty']);
  });

  it('ranks nearest first within a group', () => {
    const ranked = rankStockResults([
      result({ hospitalId: 'far', answer: 'in_stock', distanceKm: 9 }),
      result({ hospitalId: 'near', answer: 'in_stock', distanceKm: 2 }),
    ]);

    expect(ranked.map((entry) => entry.hospitalId)).toEqual(['near', 'far']);
  });

  it('ranks freshest first where no position was given', () => {
    const ranked = rankStockResults([
      result({
        hospitalId: 'older',
        answer: 'in_stock',
        freshness: { asOf: minutesAgo(300), ageMinutes: 300, stale: false },
      }),
      result({
        hospitalId: 'fresher',
        answer: 'in_stock',
        freshness: { asOf: minutesAgo(15), ageMinutes: 15, stale: false },
      }),
    ]);

    expect(ranked.map((entry) => entry.hospitalId)).toEqual(['fresher', 'older']);
  });

  it('puts a result with a distance ahead of one without', () => {
    const ranked = rankStockResults([
      result({ hospitalId: 'unknown-distance', answer: 'in_stock', distanceKm: null }),
      result({ hospitalId: 'known-distance', answer: 'in_stock', distanceKm: 20 }),
    ]);

    expect(ranked[0]?.hospitalId).toBe('known-distance');
  });

  it('does not mutate what it was given', () => {
    const input = [result({ hospitalId: 'a', answer: 'out_of_stock' }), result({ hospitalId: 'b' })];
    rankStockResults(input);
    expect(input.map((entry) => entry.hospitalId)).toEqual(['a', 'b']);
  });
});

describe('the line above the results', () => {
  it('counts each answer rather than reaching a verdict', () => {
    expect(
      summariseStockSearch([
        result({ answer: 'in_stock' }),
        result({ answer: 'in_stock' }),
        result({ answer: 'out_of_stock' }),
        result({ answer: 'unknown' }),
        result({ answer: 'unknown' }),
        result({ answer: 'unknown' }),
      ]),
    ).toEqual({ inStock: 2, outOfStock: 1, unknown: 3 });
  });

  it('counts nothing as nothing, never as unavailable', () => {
    expect(summariseStockSearch([])).toEqual({ inStock: 0, outOfStock: 0, unknown: 0 });
  });
});
