/**
 * What choosing a locale decides (`GR-06`, `I18N-01`, `TYP-04`).
 *
 * The language switch (`SEG-A00-LANG`, `SEG-B00-LANG`) changes one value;
 * these are the three things that value has to carry with it — the digits,
 * the names, and how each language is offered — and the lab catalogue that
 * an order is named from in either language.
 */

import { describe, expect, it } from 'vitest';

import { formatClock } from '../datetime.js';
import { LAB_TEST_NAMES, isLabTestCode, labTestName } from '../lab.js';
import {
  DEFAULT_LOCALE,
  LANGUAGE_NAMES,
  LOCALES,
  isLocale,
  localName,
  numeralsFor,
} from '../locale.js';
import { formatNumber } from '../numerals.js';

describe('the two locales', () => {
  it('are Bangla, the default, and English', () => {
    expect(LOCALES).toEqual(['bn', 'en']);
    expect(DEFAULT_LOCALE).toBe('bn');
  });

  it('recognises only those two', () => {
    expect(isLocale('bn')).toBe(true);
    expect(isLocale('en')).toBe(true);
    for (const value of ['BN', 'bn-BD', 'en-GB', '', null, undefined, 1]) {
      expect(isLocale(value)).toBe(false);
    }
  });

  it('offers each language in its own script', () => {
    // Somebody looking for their language scans for its script, so the
    // switch never translates the names of the languages it offers.
    expect(LANGUAGE_NAMES.bn).toBe('বাংলা');
    expect(LANGUAGE_NAMES.en).toBe('English');
  });
});

describe('the digits follow the language (TYP-04)', () => {
  it('writes Bengali digits in Bangla and Latin in English', () => {
    expect(numeralsFor('bn')).toBe('bengali');
    expect(numeralsFor('en')).toBe('latin');
    expect(formatNumber(1234, numeralsFor('bn'))).toBe('১,২৩৪');
    expect(formatNumber(1234, numeralsFor('en'))).toBe('1,234');
  });

  it('says a clock time the way each language says it (I18N-05)', () => {
    // 11:30 UTC is 17:30 in Dhaka.
    expect(formatClock('2026-09-24T11:30:00Z', numeralsFor('bn'))).toBe('বিকাল ৫:৩০');
    expect(formatClock('2026-09-24T11:30:00Z', numeralsFor('en'))).toBe('5:30 PM');
  });
});

describe('a name held in both languages', () => {
  it('reads the one asked for', () => {
    expect(localName('bn', 'শাপলা জেনারেল হাসপাতাল', 'Shapla General Hospital')).toBe(
      'শাপলা জেনারেল হাসপাতাল',
    );
    expect(localName('en', 'শাপলা জেনারেল হাসপাতাল', 'Shapla General Hospital')).toBe(
      'Shapla General Hospital',
    );
  });

  it('falls back to Bangla rather than showing nothing', () => {
    // A record saved on a phone before English names existed has none, and
    // a heading in the wrong language is still better than an empty one.
    expect(localName('en', 'শাপলা', undefined)).toBe('শাপলা');
    expect(localName('en', 'শাপলা', null)).toBe('শাপলা');
    expect(localName('en', 'শাপলা', '   ')).toBe('শাপলা');
  });
});

describe('lab tests by code (FR-LAB-01)', () => {
  it('names every catalogue test in both languages', () => {
    for (const [code, name] of Object.entries(LAB_TEST_NAMES)) {
      expect(name.bn.trim(), code).not.toBe('');
      expect(name.en.trim(), code).not.toBe('');
      // The English half is English: no Bengali script slipped into it.
      expect(/[ঀ-৿]/.test(name.en), `${code} English has Bangla in it`).toBe(false);
    }
  });

  it('names an order by its code in the language being read', () => {
    expect(labTestName('XR-CHEST', 'bn', 'anything')).toBe('বুকের এক্স-রে');
    expect(labTestName('XR-CHEST', 'en', 'anything')).toBe('Chest X-ray');
  });

  it('shows a test the catalogue does not know as it was stored', () => {
    expect(isLabTestCode('BONE-SCAN')).toBe(false);
    expect(labTestName('BONE-SCAN', 'en', 'হাড়ের স্ক্যান')).toBe('হাড়ের স্ক্যান');
  });

  it('does not treat an inherited property as a test code', () => {
    expect(isLabTestCode('toString')).toBe(false);
  });
});
