/**
 * The weekly schedule → each day's chambers (pilot step 22, `FR-SUP-01`).
 */

import { describe, expect, it } from 'vitest';

import {
  addDhakaDays,
  MATERIALISE_DAYS,
  plannedSessions,
  type ScheduleTemplate,
} from '../materialise.js';

import type { DhakaDate } from '../../types/ids.js';

const date = (value: string): DhakaDate => value as DhakaDate;

/** 2026-09-29 is a Tuesday in Dhaka. */
const TUESDAY = date('2026-09-29');

function template(overrides: Partial<ScheduleTemplate> = {}): ScheduleTemplate {
  return {
    id: 't1',
    weekday: 2,
    startTime: '17:00:00',
    endTime: '21:00:00',
    activeFrom: date('2026-01-01'),
    activeTo: null,
    ...overrides,
  };
}

describe('plannedSessions', () => {
  it('makes one chamber per matching weekday across the eight days', () => {
    const sessions = plannedSessions([template()], TUESDAY);
    // Today (Tuesday) and next Tuesday are both inside today + seven days.
    expect(sessions.map((s) => s.sessionDate)).toEqual(['2026-09-29', '2026-10-06']);
    expect(MATERIALISE_DAYS).toBe(8);
  });

  it('turns the Dhaka wall clock into the UTC instant stored', () => {
    const [first] = plannedSessions([template()], TUESDAY);
    // 17:00 in Dhaka (UTC+6) is 11:00 UTC.
    expect(first?.plannedStart).toBe('2026-09-29T11:00:00.000Z');
    expect(first?.plannedEnd).toBe('2026-09-29T15:00:00.000Z');
  });

  it('keeps to the active range, with active_to inclusive', () => {
    expect(plannedSessions([template({ activeFrom: date('2026-09-30') })], TUESDAY)).toHaveLength(
      1,
    );
    expect(plannedSessions([template({ activeTo: TUESDAY })], TUESDAY)).toHaveLength(1);
    expect(plannedSessions([template({ activeTo: date('2026-09-28') })], TUESDAY)).toHaveLength(0);
  });

  it('reads ISO weekdays: 7 is Sunday, 5 is Friday', () => {
    const sunday = plannedSessions([template({ weekday: 7 })], TUESDAY);
    expect(sunday.map((s) => s.sessionDate)).toEqual(['2026-10-04']);
    const friday = plannedSessions([template({ weekday: 5 })], TUESDAY);
    expect(friday.map((s) => s.sessionDate)).toEqual(['2026-10-02']);
  });

  it('is the same answer every time — the job may run as often as it likes', () => {
    const templates = [template(), template({ id: 't2', weekday: 5, startTime: '09:30' })];
    expect(plannedSessions(templates, TUESDAY)).toEqual(plannedSessions(templates, TUESDAY));
  });

  it('refuses a time it cannot read rather than guessing', () => {
    expect(() => plannedSessions([template({ startTime: '5pm' })], TUESDAY)).toThrow(RangeError);
  });
});

describe('addDhakaDays', () => {
  it('crosses month ends', () => {
    expect(addDhakaDays(date('2026-09-30'), 1)).toBe('2026-10-01');
    expect(addDhakaDays(date('2026-12-31'), 1)).toBe('2027-01-01');
  });
});
