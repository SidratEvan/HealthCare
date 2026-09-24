import { describe, expect, it } from 'vitest';

import {
  readSignals,
  SPIKE_MIN_CASES,
  statusOf,
  type DistrictReporting,
  type SignalDay,
} from '../signals.js';

const TODAY = '2026-09-23';

/** A district that has reported for well over the three weeks the rule reads. */
const DHAKA: DistrictReporting = { division: 'Dhaka', district: 'Dhaka', firstDay: '2026-08-01' };

function cases(day: string, count: number, overrides: Partial<SignalDay> = {}): SignalDay {
  return {
    division: 'Dhaka',
    district: 'Dhaka',
    signal: 'dengue',
    day,
    cases: count,
    ...overrides,
  };
}

function reading(days: readonly SignalDay[], reporting: readonly DistrictReporting[] = [DHAKA]) {
  const found = readSignals(days, reporting, TODAY).find(
    (entry) => entry.district === 'Dhaka' && entry.signal === 'dengue',
  );
  if (found === undefined) throw new Error('no dengue reading for Dhaka');
  return found;
}

describe('the rule (FR-GOV-03)', () => {
  it('calls a doubling of at least five cases a spike', () => {
    expect(statusOf(10, 3)).toBe('spike');
    expect(statusOf(6, 3)).toBe('spike');
  });

  it('does not call less than double a spike, however many', () => {
    expect(statusOf(50, 30)).toBe('normal');
  });

  it('does not call a handful a spike, however quiet the usual week', () => {
    // One case against a usual of none is infinitely more, and still chance.
    expect(statusOf(SPIKE_MIN_CASES - 1, 0)).toBe('normal');
    expect(statusOf(SPIKE_MIN_CASES, 0)).toBe('spike');
  });
});

describe('this week against the usual week', () => {
  it('counts the seven days ending today, today included', () => {
    const found = reading([
      cases('2026-09-23', 2),
      cases('2026-09-17', 3),
      // The day before the window belongs to the baseline, not to this week.
      cases('2026-09-16', 4),
    ]);

    expect(found.thisWeek).toBe(5);
  });

  it('averages the fortnight before into one week', () => {
    // Six cases over the fourteen days before the window is three a week.
    const found = reading([cases('2026-09-10', 4), cases('2026-09-03', 2)]);

    expect(found.usualWeek).toBe(3);
    expect(found.baselineDays).toBe(14);
  });

  it('flags a dengue week that is triple its usual', () => {
    const found = reading([
      cases('2026-09-20', 4),
      cases('2026-09-21', 3),
      cases('2026-09-22', 2),
      cases('2026-09-12', 2),
      cases('2026-09-05', 1),
    ]);

    expect(found.thisWeek).toBe(9);
    expect(found.usualWeek).toBe(1.5);
    expect(found.status).toBe('spike');
  });

  it('ignores anything older than the fortnight', () => {
    const found = reading([cases('2026-09-02', 40)]);

    expect(found.usualWeek).toBe(0);
  });

  it('keeps districts and categories apart', () => {
    const readings = readSignals(
      [
        cases('2026-09-22', 9),
        cases('2026-09-22', 9, { signal: 'fever' }),
        cases('2026-09-22', 9, { district: 'Chattogram', division: 'Chattogram' }),
      ],
      [DHAKA, { division: 'Chattogram', district: 'Chattogram', firstDay: '2026-08-01' }],
      TODAY,
    );

    expect(readings).toHaveLength(6);
    expect(readings.filter((entry) => entry.status === 'spike')).toHaveLength(3);
    expect(
      readings.find((entry) => entry.district === 'Chattogram' && entry.signal === 'fever')
        ?.thisWeek,
    ).toBe(0);
  });
});

describe('a baseline needs somebody to have been counting', () => {
  it('says too little history when the district began reporting this week', () => {
    const found = reading([cases('2026-09-22', 12)], [{ ...DHAKA, firstDay: '2026-09-20' }]);

    expect(found.status).toBe('too_little_history');
    expect(found.usualWeek).toBeNull();
    // The count itself is still true, and still shown.
    expect(found.thisWeek).toBe(12);
  });

  it('compares against one week when that is all there is', () => {
    // Reporting since 09-10: the seven days before the window, and no more.
    const found = reading(
      [cases('2026-09-12', 2), cases('2026-09-22', 5)],
      [{ ...DHAKA, firstDay: '2026-09-10' }],
    );

    expect(found.baselineDays).toBe(7);
    expect(found.usualWeek).toBe(2);
    expect(found.status).toBe('spike');
  });

  it('does not count days before the district was counted as a quiet baseline', () => {
    // Reporting since 09-13: four days of baseline, which is not a week.
    const found = reading([], [{ ...DHAKA, firstDay: '2026-09-13' }]);

    expect(found.status).toBe('too_little_history');
  });
});

describe('what the screen is given', () => {
  it('lists every category for every reporting district, zero included', () => {
    const readings = readSignals([], [DHAKA], TODAY);

    expect(readings.map((entry) => entry.signal).sort()).toEqual(['dengue', 'diarrhoeal', 'fever']);
    expect(readings.every((entry) => entry.thisWeek === 0 && entry.status === 'normal')).toBe(true);
  });

  it('gives every day of the three weeks, oldest first', () => {
    const found = reading([cases('2026-09-23', 1)]);

    expect(found.daily).toHaveLength(21);
    expect(found.daily[0]?.day).toBe('2026-09-03');
    expect(found.daily.at(-1)).toEqual({ day: '2026-09-23', cases: 1 });
  });

  it('puts spikes first', () => {
    const readings = readSignals(
      [cases('2026-09-22', 8, { signal: 'fever' })],
      [{ division: 'Dhaka', district: 'Narayanganj', firstDay: '2026-08-01' }, DHAKA],
      TODAY,
    );

    expect(readings[0]).toMatchObject({ district: 'Dhaka', signal: 'fever', status: 'spike' });
  });
});
