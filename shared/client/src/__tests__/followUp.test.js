import { describe, expect, it } from 'vitest';

import { customFollowUpDays, followUpDateIn, followUpDateLabel } from '../doctor/followUp.js';

describe('date-only custom follow-up (FR-DOC-07, DB-P4)', () => {
  it.each([
    ['1', 1],
    ['১', 1],
    ['365', 365],
    ['৩৬৫', 365],
    [' ৫ ', 5],
    ['005', 5],
  ])('accepts whole days in both numeral systems: %s', (raw, expected) =>
    expect(customFollowUpDays(raw)).toBe(expected),
  );
  it.each([
    '',
    ' ',
    '0',
    '০',
    '-1',
    '-১',
    '1.5',
    '১.৫',
    '366',
    '৩৬৬',
    'NaN',
    '1e2',
    '+1',
    '1/2',
    '∞',
  ])('refuses invalid signing input: %s', (raw) => expect(customFollowUpDays(raw)).toBeNull());
  it.each([
    ['2026-10-10T17:59:59.999Z', 1, '2026-10-11'],
    ['2026-10-10T18:00:00.000Z', 1, '2026-10-12'],
    ['2026-12-31T18:00:00.000Z', 365, '2028-01-01'],
    ['2028-02-28T12:00:00.000Z', 1, '2028-02-29'],
    ['2026-01-31T12:00:00.000Z', 1, '2026-02-01'],
  ])('uses the Dhaka day and handles calendar rollover: %s + %i', (at, days, expected) => {
    expect(followUpDateIn(days, new Date(at))).toBe(expected);
  });
  it('renders the stored calendar day in both languages', () => {
    expect(followUpDateLabel('2026-10-14', 'en')).toBe('Wednesday, 14 October 2026');
    expect(followUpDateLabel('2026-10-14', 'bn')).toContain('১৪');
    expect(followUpDateLabel('2026-10-14', 'bn')).toContain('২০২৬');
  });
});
