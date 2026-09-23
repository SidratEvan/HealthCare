import { describe, expect, it } from 'vitest';

import { openForSeconds, summariseTurnaround, turnaroundSeconds } from '../turnaround.js';

import type { Timestamp } from '../../types/ids.js';
import type { TestOrderView } from '../orders.js';

const NOW = '2026-09-22T10:00:00.000Z' as Timestamp;
const at = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString() as Timestamp;

function order(overrides: Partial<TestOrderView> = {}): TestOrderView {
  return {
    id: 'order-1',
    hospitalId: 'hospital-shapla',
    patientId: 'patient-1',
    visitId: null,
    testCode: 'CBC',
    testName: 'সম্পূর্ণ রক্ত পরীক্ষা',
    state: 'report_ready',
    pricePoisha: 45_000,
    orderedAt: at(-120),
    sampleAt: at(-110),
    readyAt: at(-30),
    deliveredAt: null,
    report: null,
    ...overrides,
  };
}

describe('turnaround is measured from the promise the patient heard', () => {
  it('runs from ordered to report ready, not from the sample', () => {
    // Ordered at -120, sample at -110, ready at -30: ninety minutes.
    expect(turnaroundSeconds(order())).toBe(90 * 60);
  });

  it('has no measurement for an order nobody has finished', () => {
    expect(turnaroundSeconds(order({ state: 'processing', readyAt: null }))).toBeNull();
    expect(turnaroundSeconds(order({ state: 'ordered', readyAt: null }))).toBeNull();
  });

  it('has no measurement for a cancelled order, even one with a stamp', () => {
    expect(turnaroundSeconds(order({ state: 'cancelled' }))).toBeNull();
  });

  it('refuses a backwards clock rather than reporting a fast lab', () => {
    expect(turnaroundSeconds(order({ orderedAt: at(-10), readyAt: at(-30) }))).toBeNull();
  });

  it('counts a delivered order, which is finished work', () => {
    expect(turnaroundSeconds(order({ state: 'delivered', deliveredAt: at(-25) }))).toBe(90 * 60);
  });
});

describe('how long an unfinished order has been waiting', () => {
  it('measures open orders from when they were ordered', () => {
    expect(openForSeconds(order({ state: 'processing' }), NOW)).toBe(120 * 60);
  });

  it('is null for anything already reported or cancelled', () => {
    expect(openForSeconds(order({ state: 'report_ready' }), NOW)).toBeNull();
    expect(openForSeconds(order({ state: 'delivered' }), NOW)).toBeNull();
    expect(openForSeconds(order({ state: 'cancelled' }), NOW)).toBeNull();
  });
});

describe('the per-test-type summary FR-LAB-04 asks for', () => {
  it('takes the median of what finished and names the slowest beside it', () => {
    const [summary] = summariseTurnaround(
      [
        order({ id: '1', orderedAt: at(-60), readyAt: at(-30) }), // 30 min
        order({ id: '2', orderedAt: at(-120), readyAt: at(-30) }), // 90 min
        order({ id: '3', orderedAt: at(-600), readyAt: at(-30) }), // 570 min
      ],
      NOW,
    );

    expect(summary?.completed).toBe(3);
    expect(summary?.medianSeconds).toBe(90 * 60);
    expect(summary?.slowestSeconds).toBe(570 * 60);
  });

  it('keeps open orders out of the average and reports them separately', () => {
    const [summary] = summariseTurnaround(
      [
        order({ id: '1', orderedAt: at(-60), readyAt: at(-30) }),
        order({ id: '2', state: 'processing', readyAt: null, orderedAt: at(-540) }),
        order({ id: '3', state: 'ordered', readyAt: null, orderedAt: at(-90) }),
      ],
      NOW,
    );

    expect(summary?.completed).toBe(1);
    expect(summary?.medianSeconds).toBe(30 * 60);
    expect(summary?.open).toBe(2);
    expect(summary?.oldestOpenSeconds).toBe(540 * 60);
  });

  it('says a type has no measurement rather than calling it zero', () => {
    const [summary] = summariseTurnaround(
      [order({ state: 'processing', readyAt: null, orderedAt: at(-45) })],
      NOW,
    );

    expect(summary?.medianSeconds).toBeNull();
    expect(summary?.slowestSeconds).toBeNull();
    expect(summary?.completed).toBe(0);
    expect(summary?.open).toBe(1);
  });

  it('groups by test code and ranks the slowest median first', () => {
    const summaries = summariseTurnaround(
      [
        order({ id: '1', testCode: 'CBC', testName: 'CBC', orderedAt: at(-60), readyAt: at(-30) }),
        order({
          id: '2',
          testCode: 'XR-CHEST',
          testName: 'Chest X-ray',
          orderedAt: at(-300),
          readyAt: at(-30),
        }),
        order({
          id: '3',
          testCode: 'URINE',
          testName: 'Urine R/E',
          state: 'processing',
          readyAt: null,
          orderedAt: at(-20),
        }),
      ],
      NOW,
    );

    // Slowest measured first; the type with no measurement last, whatever its
    // open count — the column being ranked is the median.
    expect(summaries.map((entry) => entry.testCode)).toEqual(['XR-CHEST', 'CBC', 'URINE']);
  });

  it('takes the mean of the middle two on an even count', () => {
    const [summary] = summariseTurnaround(
      [
        order({ id: '1', orderedAt: at(-40), readyAt: at(-30) }), // 10 min
        order({ id: '2', orderedAt: at(-50), readyAt: at(-30) }), // 20 min
        order({ id: '3', orderedAt: at(-70), readyAt: at(-30) }), // 40 min
        order({ id: '4', orderedAt: at(-110), readyAt: at(-30) }), // 80 min
      ],
      NOW,
    );

    expect(summary?.medianSeconds).toBe(30 * 60);
  });

  it('returns nothing for no orders', () => {
    expect(summariseTurnaround([], NOW)).toEqual([]);
  });
});
