/**
 * Time (DB-P4).
 *
 * The cases worth testing are the ones where UTC and Dhaka disagree about what
 * day it is, because that is where a chamber gets published on the wrong day
 * or a receptionist's "today" stops matching the database's.
 */

import { describe, expect, it } from 'vitest';

import { id, timestamp, type DhakaDate } from '../../types/ids.js';
import {
  addMinutes,
  addSeconds,
  differenceInMinutes,
  differenceInSeconds,
  dhakaWeekday,
  floorToMinute,
  fromDhakaWallClock,
  fromEpochMs,
  isAfter,
  isBefore,
  maxTimestamp,
  minTimestamp,
  toDhakaClock,
  toDhakaDate,
  toEpochMs,
  DHAKA_UTC_OFFSET_MINUTES,
} from '../time.js';

describe('the Dhaka offset', () => {
  it('is a fixed six hours, because Bangladesh keeps no daylight saving', () => {
    expect(DHAKA_UTC_OFFSET_MINUTES).toBe(360);
  });
});

describe('parsing and formatting', () => {
  it('round-trips an instant', () => {
    const value = timestamp('2026-09-17T11:12:00.000Z');
    expect(fromEpochMs(toEpochMs(value))).toBe(value);
  });

  it('refuses a value that is not an instant', () => {
    expect(() => toEpochMs(timestamp('not a date'))).toThrow(/ISO-8601/);
    expect(() => fromEpochMs(Number.NaN)).toThrow(/finite/);
  });
});

describe('arithmetic', () => {
  it('adds seconds and minutes', () => {
    const start = timestamp('2026-09-17T11:00:00.000Z');

    expect(addSeconds(start, 90)).toBe(timestamp('2026-09-17T11:01:30.000Z'));
    expect(addMinutes(start, 30)).toBe(timestamp('2026-09-17T11:30:00.000Z'));
  });

  it('measures differences, signed', () => {
    const earlier = timestamp('2026-09-17T11:00:00.000Z');
    const later = timestamp('2026-09-17T11:45:00.000Z');

    expect(differenceInMinutes(later, earlier)).toBe(45);
    expect(differenceInMinutes(earlier, later)).toBe(-45);
    expect(differenceInSeconds(later, earlier)).toBe(2_700);
  });

  it('compares', () => {
    const earlier = timestamp('2026-09-17T11:00:00.000Z');
    const later = timestamp('2026-09-17T11:45:00.000Z');

    expect(isBefore(earlier, later)).toBe(true);
    expect(isAfter(earlier, later)).toBe(false);
    expect(maxTimestamp(earlier, later)).toBe(later);
    expect(minTimestamp(earlier, later)).toBe(earlier);
  });

  it('floors to the minute, so an ETA does not jitter between recalculations', () => {
    // FR-QUE-13: a value flipping between 6:04:59 and 6:05:01 looks like the
    // system changing its mind.
    expect(floorToMinute(timestamp('2026-09-17T11:04:59.999Z'))).toBe(
      timestamp('2026-09-17T11:04:00.000Z'),
    );
  });
});

describe('which day it is in Dhaka', () => {
  it('agrees with UTC in the middle of the day', () => {
    expect(toDhakaDate(timestamp('2026-09-17T11:00:00.000Z'))).toBe('2026-09-17');
  });

  it('is already tomorrow after 18:00 UTC', () => {
    // An evening chamber at 00:30 Dhaka on the 18th is 18:30 UTC on the 17th.
    expect(toDhakaDate(timestamp('2026-09-17T18:30:00.000Z'))).toBe('2026-09-18');
  });

  it('is still yesterday before 06:00 UTC', () => {
    // 05:00 UTC is 11:00 in Dhaka on the same day; 23:00 UTC on the 16th is
    // 05:00 on the 17th.
    expect(toDhakaDate(timestamp('2026-09-16T23:00:00.000Z'))).toBe('2026-09-17');
  });

  it('reads the wall clock a hospital thinks in', () => {
    // A five-o'clock evening chamber.
    expect(toDhakaClock(timestamp('2026-09-17T11:00:00.000Z'))).toEqual({ hour: 17, minute: 0 });
  });
});

describe('materialising a session from a template', () => {
  it('turns a Dhaka wall-clock time into the stored instant', () => {
    const date = id<DhakaDate>('2026-09-17');

    expect(fromDhakaWallClock(date, 17, 0)).toBe(timestamp('2026-09-17T11:00:00.000Z'));
    expect(fromDhakaWallClock(date, 9, 30)).toBe(timestamp('2026-09-17T03:30:00.000Z'));
  });

  it('handles a chamber that runs past midnight in Dhaka', () => {
    const date = id<DhakaDate>('2026-09-17');

    // 00:30 on the 17th in Dhaka is 18:30 on the 16th in UTC.
    expect(fromDhakaWallClock(date, 0, 30)).toBe(timestamp('2026-09-16T18:30:00.000Z'));
  });

  it('round-trips against toDhakaClock', () => {
    const date = id<DhakaDate>('2026-09-17');

    for (const hour of [0, 6, 9, 13, 17, 20, 23]) {
      for (const minute of [0, 15, 30, 45]) {
        const instant = fromDhakaWallClock(date, hour, minute);
        expect(toDhakaClock(instant)).toEqual({ hour, minute });
      }
    }
  });

  it('refuses a malformed date or an out-of-range clock', () => {
    expect(() => fromDhakaWallClock(id<DhakaDate>('17-09-2026'), 17, 0)).toThrow(/YYYY-MM-DD/);
    expect(() => fromDhakaWallClock(id<DhakaDate>('2026-09-17'), 24, 0)).toThrow(/Hour/);
    expect(() => fromDhakaWallClock(id<DhakaDate>('2026-09-17'), 17, 60)).toThrow(/Minute/);
  });
});

describe('the weekday a template is keyed on', () => {
  it('is ISO-8601, so it matches session_templates.weekday exactly', () => {
    // 2026-09-17 is a Thursday: ISO 4.
    expect(dhakaWeekday(timestamp('2026-09-17T11:00:00.000Z'))).toBe(4);
    // 2026-09-20 is a Sunday: ISO 7, not 0.
    expect(dhakaWeekday(timestamp('2026-09-20T11:00:00.000Z'))).toBe(7);
    // 2026-09-21 is a Monday: ISO 1.
    expect(dhakaWeekday(timestamp('2026-09-21T11:00:00.000Z'))).toBe(1);
  });

  it('uses the Dhaka day, not the UTC one', () => {
    // 18:30 UTC Thursday is already Friday in Dhaka.
    expect(dhakaWeekday(timestamp('2026-09-17T18:30:00.000Z'))).toBe(5);
  });
});
