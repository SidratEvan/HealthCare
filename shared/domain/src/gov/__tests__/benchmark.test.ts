import { describe, expect, it } from 'vitest';

import { benchmark, MIN_BENCHMARK_SAMPLE, type FacilityFigures } from '../benchmark.js';

function facility(overrides: Partial<FacilityFigures> = {}): FacilityFigures {
  return {
    kind: 'hospital',
    avgWaitMinutes: 25,
    waitsMeasured: 40,
    medianTurnaroundHours: 3,
    turnaroundsMeasured: 20,
    waitScore: 3.6,
    doctorScore: 4.4,
    cleanlinessScore: 3.8,
    billingScore: 3.3,
    responses: 30,
    ...overrides,
  };
}

function measure(rows: readonly FacilityFigures[], name: string) {
  const found = benchmark(rows).find((entry) => entry.measure === name);
  if (found === undefined) throw new Error(`no measure ${name}`);
  return found;
}

describe('each measure is ranked on its own (FR-GOV-04)', () => {
  it('puts the shortest wait first', () => {
    const wait = measure(
      [
        facility({ avgWaitMinutes: 31 }),
        facility({ kind: 'government', avgWaitMinutes: 18 }),
        facility({ kind: 'clinic', avgWaitMinutes: 24 }),
      ],
      'wait',
    );

    expect(wait.better).toBe('lower');
    expect(wait.entries.map((entry) => entry.value)).toEqual([18, 24, 31]);
    expect(wait.entries[0]?.kind).toBe('government');
  });

  it('puts the highest score first', () => {
    const doctor = measure(
      [facility({ doctorScore: 4.1 }), facility({ doctorScore: 4.7 })],
      'score_doctor',
    );

    expect(doctor.better).toBe('higher');
    expect(doctor.entries.map((entry) => entry.value)).toEqual([4.7, 4.1]);
  });

  it('gives the middle of the compared facilities', () => {
    const wait = measure(
      [
        facility({ avgWaitMinutes: 10 }),
        facility({ avgWaitMinutes: 20 }),
        facility({ avgWaitMinutes: 40 }),
        facility({ avgWaitMinutes: 50 }),
      ],
      'wait',
    );

    expect(wait.median).toBe(30);
  });

  it('names no facility — its kind is all an entry carries', () => {
    const [first] = measure([facility()], 'wait').entries;

    expect(Object.keys(first ?? {}).sort()).toEqual(['kind', 'sample', 'value']);
  });
});

describe('too few is not a figure', () => {
  it('leaves out a facility resting on fewer than the minimum, and counts it', () => {
    const turnaround = measure(
      [
        facility({ medianTurnaroundHours: 0.5, turnaroundsMeasured: MIN_BENCHMARK_SAMPLE - 1 }),
        facility({ medianTurnaroundHours: 3 }),
      ],
      'turnaround',
    );

    // Two lab orders done in half an hour would otherwise top the table.
    expect(turnaround.entries.map((entry) => entry.value)).toEqual([3]);
    expect(turnaround.tooFew).toBe(1);
  });

  it('does not count a facility with no observations as too few', () => {
    // A clinic with no lab is absent from turnaround, not short of data.
    const turnaround = measure(
      [facility({ medianTurnaroundHours: null, turnaroundsMeasured: 0 }), facility()],
      'turnaround',
    );

    expect(turnaround.entries).toHaveLength(1);
    expect(turnaround.tooFew).toBe(0);
  });

  it('has no median when nothing could be compared', () => {
    const wait = measure([facility({ waitsMeasured: 2 })], 'wait');

    expect(wait.entries).toEqual([]);
    expect(wait.median).toBeNull();
  });
});
