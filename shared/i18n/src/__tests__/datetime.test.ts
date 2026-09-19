/**
 * Clock formatting (`I18N-05`, `TYP-04`, `DB-P4`).
 *
 * One rule is being enforced here and it is worth stating plainly: **"AM" and
 * "PM" never appear in Bangla copy.** `Intl` will happily produce `২:৫৫ PM`,
 * which is the half-translated output that marks an interface as English
 * wearing Bangla numerals — so the tests below check for the absence of those
 * two strings as carefully as they check for the presence of the right ones.
 */

import { describe, expect, it } from 'vitest';

import { dayPeriod, formatClock, formatDateTime } from '../datetime.js';

/** A UTC instant at a given Dhaka wall-clock hour (UTC+6, no DST). */
function dhaka(hour24: number, minute = 0): string {
  return new Date(Date.UTC(2026, 8, 18, hour24 - 6, minute)).toISOString();
}

describe('the parts of the day (I18N-05)', () => {
  it.each([
    [7, 'সকাল'],
    [11, 'সকাল'],
    [12, 'দুপুর'],
    [14, 'দুপুর'],
    [15, 'বিকাল'],
    [17, 'বিকাল'],
    [18, 'সন্ধ্যা'],
    [19, 'সন্ধ্যা'],
    [20, 'রাত'],
    [23, 'রাত'],
    [0, 'রাত'],
    [5, 'রাত'],
  ])('calls %i o%s hour by its Bangla name', (hour, expected) => {
    expect(dayPeriod(hour)).toBe(expected);
  });

  it('uses exactly the five words the document names', () => {
    const words = new Set(Array.from({ length: 24 }, (_, hour) => dayPeriod(hour)));

    // Five, not six. ভোর is a real part of the day and a real word, and
    // `I18N-05` does not list it — so it is deliberately absent rather than
    // added because it would be nice.
    expect([...words].sort()).toEqual(['দুপুর', 'বিকাল', 'রাত', 'সকাল', 'সন্ধ্যা'].sort());
  });
});

describe('a clock time on a patient surface', () => {
  it('reads as a Bangla sentence, period first', () => {
    expect(formatClock(dhaka(17, 12), 'bengali')).toBe('বিকাল ৫:১২');
  });

  it('never says AM or PM', () => {
    // The whole reason this module exists. `Intl.DateTimeFormat('bn-BD')`
    // produces "৫:১২ PM", and that is the tell FRONTEND.md §0.2 bans.
    for (let hour = 0; hour < 24; hour += 1) {
      const formatted = formatClock(dhaka(hour, 30), 'bengali');
      expect(formatted).not.toContain('AM');
      expect(formatted).not.toContain('PM');
    }
  });

  it('carries no Latin digits (I18N-04)', () => {
    expect(formatClock(dhaka(9, 5), 'bengali')).not.toMatch(/[0-9]/);
  });

  it('says twelve, not zero, at midday and midnight', () => {
    expect(formatClock(dhaka(12, 0), 'bengali')).toBe('দুপুর ১২:০০');
    expect(formatClock(dhaka(0, 0), 'bengali')).toBe('রাত ১২:০০');
  });
});

describe('a clock time on a console surface (TYP-04)', () => {
  it('keeps Latin digits and the familiar suffix', () => {
    // A receptionist reads these against a Latin keypad forty times an hour,
    // and a period word beside Latin digits is the same mismatch in reverse.
    expect(formatClock(dhaka(17, 12), 'latin')).toBe('5:12 PM');
    expect(formatClock(dhaka(9, 5), 'latin')).toBe('9:05 AM');
  });
});

describe('timezone and robustness', () => {
  it('reads an instant in Dhaka, not in the runner’s timezone (DB-P4)', () => {
    // 11:30 UTC is 17:30 in Dhaka. A CI box in another timezone must not
    // change what a Bangladeshi patient is told.
    expect(formatClock('2026-09-18T11:30:00.000Z', 'bengali')).toBe('বিকাল ৫:৩০');
  });

  it('returns nothing rather than "Invalid Date" for a broken timestamp', () => {
    // A screen showing "Invalid Date" beside a serial is worse than one
    // showing nothing: it invites somebody to distrust the number too.
    expect(formatClock('not a timestamp', 'bengali')).toBe('');
  });
});

describe('a date with its time', () => {
  it('leads with the day, because that is what is being checked', () => {
    const formatted = formatDateTime(dhaka(18, 0), 'bengali');

    expect(formatted).toContain('সন্ধ্যা ৬:০০');
    expect(formatted).not.toContain('PM');
  });
});
