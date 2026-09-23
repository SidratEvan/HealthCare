import { describe, expect, it } from 'vitest';

import { forecastVolume, type HistoricalVolume } from '../forecast.js';

function past(overrides: Partial<HistoricalVolume> = {}): HistoricalVolume {
  return { date: '2026-09-01', weekday: 2, slot: 'evening', seen: 30, ...overrides };
}

describe('the same weekday predicts the same weekday', () => {
  it('averages past sessions in that day-and-slot', () => {
    const [point] = forecastVolume([past({ seen: 28 }), past({ seen: 32 }), past({ seen: 30 })]);

    expect(point?.expected).toBe(30);
    expect(point?.observations).toBe(3);
  });

  it('keeps a morning clinic apart from an evening one', () => {
    const points = forecastVolume([
      past({ slot: 'morning', seen: 12 }),
      past({ slot: 'morning', seen: 14 }),
      past({ slot: 'evening', seen: 40 }),
      past({ slot: 'evening', seen: 44 }),
    ]);

    expect(points).toHaveLength(2);
    expect(points.find((point) => point.slot === 'morning')?.expected).toBe(13);
    expect(points.find((point) => point.slot === 'evening')?.expected).toBe(42);
  });

  it('keeps weekdays apart', () => {
    const points = forecastVolume([
      past({ weekday: 5, seen: 8 }),
      past({ weekday: 5, seen: 10 }),
      past({ weekday: 2, seen: 40 }),
      past({ weekday: 2, seen: 44 }),
    ]);

    expect(points.find((point) => point.weekday === 5)?.expected).toBe(9);
    expect(points.find((point) => point.weekday === 2)?.expected).toBe(42);
  });
});

describe('too little history is said, not filled in', () => {
  it('offers no figure from a single past session', () => {
    // One Friday cannot distinguish a typical day from the one the clinic was
    // empty, and a hospital could roster against the number. `PRD.md` §3.2
    // forbids inventing it.
    const [point] = forecastVolume([past({ weekday: 5, seen: 3 })]);

    expect(point?.expected).toBeNull();
    expect(point?.low).toBeNull();
    expect(point?.high).toBeNull();
    expect(point?.observations).toBe(1);
  });

  it('starts answering at two', () => {
    const [point] = forecastVolume([past({ seen: 20 }), past({ seen: 30 })]);

    expect(point?.expected).toBe(25);
    expect(point?.observations).toBe(2);
  });

  it('omits a day-and-slot with no history rather than showing nulls', () => {
    // The hospital does not run a Friday morning clinic. A row for one invites
    // somebody to staff it.
    const points = forecastVolume([past({ weekday: 2, slot: 'evening' })]);

    expect(points).toHaveLength(1);
    expect(points[0]?.slot).toBe('evening');
  });

  it('has nothing to say about an empty history', () => {
    expect(forecastVolume([])).toEqual([]);
  });
});

describe('the spread a rota is actually built from', () => {
  it('reports the observed range, not a smoothed mean', () => {
    // Averaging thirty tells a manager nothing about the Tuesday that brought
    // fifty-one people through the door.
    const [point] = forecastVolume([
      past({ seen: 12 }),
      past({ seen: 28 }),
      past({ seen: 51 }),
      past({ seen: 29 }),
    ]);

    expect(point?.expected).toBe(30);
    expect(point?.low).toBe(12);
    expect(point?.high).toBe(51);
  });
});

describe('the order a rota is read in', () => {
  it('runs weekday by weekday, and through each day', () => {
    const points = forecastVolume([
      past({ weekday: 3, slot: 'evening' }),
      past({ weekday: 3, slot: 'evening' }),
      past({ weekday: 1, slot: 'evening' }),
      past({ weekday: 1, slot: 'evening' }),
      past({ weekday: 1, slot: 'morning' }),
      past({ weekday: 1, slot: 'morning' }),
      past({ weekday: 1, slot: 'afternoon' }),
      past({ weekday: 1, slot: 'afternoon' }),
    ]);

    expect(points.map((point) => `${String(point.weekday)}:${point.slot}`)).toEqual([
      '1:morning',
      '1:afternoon',
      '1:evening',
      '3:evening',
    ]);
  });
});
