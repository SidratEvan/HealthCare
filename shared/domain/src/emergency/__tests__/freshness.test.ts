import { describe, expect, it } from 'vitest';

import { ageInMinutes, freshnessOf, oldestStamp } from '../freshness.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-21T12:00:00.000Z' as Timestamp;
const minutesAgo = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString() as Timestamp;

describe('FR-OFF-03: every figure has an age', () => {
  it('takes the oldest of several stamps', () => {
    expect(oldestStamp([minutesAgo(2), minutesAgo(40), minutesAgo(7)])).toBe(minutesAgo(40));
  });

  it('knows nothing about a list with a never-confirmed figure in it', () => {
    expect(oldestStamp([minutesAgo(2), null])).toBeNull();
    expect(oldestStamp([])).toBeNull();
  });

  it('counts whole minutes, and a stamp a moment ahead of this clock as just now', () => {
    expect(ageInMinutes(minutesAgo(4.9), NOW)).toBe(4);
    expect(ageInMinutes('2026-09-21T12:00:03.000Z' as Timestamp, NOW)).toBe(0);
    expect(ageInMinutes(null, NOW)).toBeNull();
  });
});

describe('FR-OFF-04: past the threshold, a figure is stale', () => {
  it('is fresh under the threshold and stale on reaching it, as <FreshnessLine> colours it', () => {
    expect(freshnessOf([minutesAgo(9)], NOW, 10).stale).toBe(false);
    expect(freshnessOf([minutesAgo(10)], NOW, 10).stale).toBe(true);
  });

  it('is stale when never confirmed, whatever the threshold', () => {
    expect(freshnessOf([null], NOW, 1_440)).toEqual({ asOf: null, ageMinutes: null, stale: true });
  });

  it('honours a hospital that sets its own threshold', () => {
    expect(freshnessOf([minutesAgo(25)], NOW, 30).stale).toBe(false);
    expect(freshnessOf([minutesAgo(25)], NOW, 10).stale).toBe(true);
  });
});
