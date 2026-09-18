/**
 * Bengali numerals (`TYP-04`, `I18N-04`).
 *
 * CLAUDE.md §11 lists this among the non-negotiables most likely to be dropped
 * under pressure, so it gets a test that would notice.
 */

import { describe, expect, it } from 'vitest';

import {
  formatMinutes,
  formatNumber,
  formatPhone,
  formatSerial,
  formatTaka,
  hasBengaliDigits,
  toBengaliDigits,
  toLatinDigits,
} from '../numerals.js';

describe('digit substitution', () => {
  it('maps all ten digits', () => {
    expect(toBengaliDigits('0123456789')).toBe('০১২৩৪৫৬৭৮৯');
    expect(toLatinDigits('০১২৩৪৫৬৭৮৯')).toBe('0123456789');
  });

  it('round-trips', () => {
    expect(toLatinDigits(toBengaliDigits('1018'))).toBe('1018');
  });

  it('leaves surrounding text alone', () => {
    // The substitution runs over already-formatted strings, so separators and
    // Bangla words have to survive it untouched.
    expect(toBengaliDigits('সিরিয়াল ১৮ / 18')).toBe('সিরিয়াল ১৮ / ১৮');
    expect(toBengaliDigits('৳1,500.50')).toBe('৳১,৫০০.৫০');
  });

  it('detects Bengali digits', () => {
    expect(hasBengaliDigits('১৮')).toBe(true);
    expect(hasBengaliDigits('18')).toBe(false);
    expect(hasBengaliDigits('কোনো সংখ্যা নেই')).toBe(false);
  });
});

describe('TYP-04: the surface decides the script', () => {
  it('gives a patient Bengali and a receptionist Latin', () => {
    // Not an inconsistency. A receptionist types serials against a Latin
    // keypad forty times an hour; the patient reads theirs in a corridor.
    expect(formatSerial(18, 'bengali')).toBe('১৮');
    expect(formatSerial(18, 'latin')).toBe('18');
  });

  it('never groups a serial', () => {
    // A serial is a label, not a quantity: ১,০১৮ reads as one thousand.
    expect(formatSerial(1018, 'bengali')).toBe('১০১৮');
    expect(formatSerial(1018, 'latin')).toBe('1018');
  });
});

describe('grouping follows the reader, not the developer', () => {
  it('groups in the South Asian pattern for Bangla', () => {
    // 1,23,456 — thousand, then lakh. Not 123,456.
    expect(formatNumber(123456, 'bengali')).toBe('১,২৩,৪৫৬');
    expect(formatNumber(123456, 'latin')).toBe('123,456');
  });

  it('handles a crore', () => {
    expect(formatNumber(12345678, 'bengali')).toBe('১,২৩,৪৫,৬৭৮');
  });
});

describe('money is integer poisha (DB-P5)', () => {
  it('renders a whole fee without decimals', () => {
    expect(formatTaka(150000, 'bengali')).toBe('৳১,৫০০');
    expect(formatTaka(150000, 'latin')).toBe('৳1,500');
  });

  it('keeps paisa when there are any, so a total still adds up', () => {
    expect(formatTaka(150050, 'latin')).toBe('৳1,500.50');
    expect(formatTaka(150050, 'bengali')).toBe('৳১,৫০০.৫০');
  });

  it('refuses a float, rather than rounding one silently', () => {
    expect(() => formatTaka(1500.5, 'latin')).toThrow(/integer poisha/);
  });

  it('renders zero', () => {
    expect(formatTaka(0, 'bengali')).toBe('৳০');
  });
});

describe('an ETA claims only the precision it has', () => {
  it('rounds to whole minutes', () => {
    // FR-QUE-11 is a projection from a rolling average. Seconds would be a
    // lie about how well we know the answer.
    expect(formatMinutes(39.6, 'bengali')).toBe('৪০');
    expect(formatMinutes(39.4, 'latin')).toBe('39');
  });

  it('never shows a negative wait', () => {
    expect(formatMinutes(-5, 'latin')).toBe('0');
  });
});

describe('phone numbers stay Latin everywhere', () => {
  it('groups without converting', () => {
    // DB-P6 stores +8801XXXXXXXXX. A person dials these and pastes them into
    // other systems; Bengali digits would make them unusable.
    // Grouped as this country writes them: 01712-345678 nationally.
    expect(formatPhone('+8801712345678')).toBe('+880 1712-345678');
    expect(hasBengaliDigits(formatPhone('+8801712345678'))).toBe(false);
  });

  it('passes a number it does not recognise through unchanged', () => {
    // Honest degradation: a malformed number is shown as stored rather than
    // reformatted into something that looks valid.
    expect(formatPhone('01712345678')).toBe('01712345678');
  });
});
