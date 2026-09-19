/**
 * The message catalogue (`I18N-01`, `I18N-02`, `TYP-05`).
 *
 * A missing key cannot happen — every message holds both languages in one
 * entry, so there is nowhere for one to go missing from. What a type cannot
 * check is what this checks: that nothing is blank, that Bangla is really
 * Bangla, and that its sentences end the way Bangla sentences end.
 */

import { describe, expect, it } from 'vitest';

import { CONSOLE, PATIENT, format, t, tp, type Message } from '../messages.js';

/**
 * Both catalogues, checked together.
 *
 * A rule that holds for the console and not for the patient app is worse than
 * no rule: the patient surface is the one a stranger reads, in Bangla, on a
 * phone — so it is the one where a Latin digit or an English fallback shows.
 */
const entries = [
  ...(Object.entries(CONSOLE) as [string, Message][]).map(
    ([key, message]) => [`console.${key}`, message] as [string, Message],
  ),
  ...(Object.entries(PATIENT) as [string, Message][]).map(
    ([key, message]) => [`patient.${key}`, message] as [string, Message],
  ),
];

describe('every key carries both languages', () => {
  it.each(entries)('%s', (_key, message) => {
    expect(message.bn.trim()).not.toBe('');
    expect(message.en.trim()).not.toBe('');
  });

  it('has something to check', () => {
    // Guards against the suite passing because a catalogue is empty.
    expect(Object.keys(CONSOLE).length).toBeGreaterThan(40);
    expect(Object.keys(PATIENT).length).toBeGreaterThan(30);
  });
});

describe('the Bangla is written, not transliterated', () => {
  it.each(entries)('%s is in Bengali script', (key, message) => {
    // Every Bangla string must contain Bengali codepoints. A key that slipped
    // through as English text in the bn slot is the most common way a
    // "translated" product ships half-English.
    expect(/[ঀ-৿]/.test(message.bn), `${key} has no Bengali script`).toBe(true);
  });

  it('ends Bangla sentences with দাঁড়ি, never a full stop (TYP-05)', () => {
    for (const [key, message] of entries) {
      // Only sentences — labels and column headers carry no terminator.
      const isSentence = message.bn.includes(' ') && /[।.]$/.test(message.bn);
      if (!isSentence) continue;

      expect(message.bn.endsWith('।'), `${key} ends with a full stop`).toBe(true);
    }
  });
});

describe('reading a message', () => {
  it('returns the language asked for', () => {
    expect(t('callNext', 'bn')).toBe('পরবর্তী রোগী ডাকুন');
    expect(t('callNext', 'en')).toBe('Call next patient');
  });

  it('fills named placeholders', () => {
    expect(format('calledPatient', 'en', { serial: '18' })).toBe('Called serial 18');
    expect(format('calledPatient', 'bn', { serial: '১৮' })).toContain('১৮');
  });

  it('leaves an unfilled placeholder visible rather than blank', () => {
    // FR-OFF-05: never render a placeholder that could be mistaken for real
    // data. A visibly broken string is better than a confidently empty one.
    expect(format('calledPatient', 'en', {})).toContain('{serial}');
  });
});

describe('button labels are verbs (FRONTEND.md §5.1)', () => {
  it('asks for an action rather than naming a noun', () => {
    // "সিরিয়াল নিন", not "জমা" — a label that names the noun leaves the
    // person guessing what pressing it will do.
    expect(t('callNext', 'bn')).toContain('ডাকুন');
    expect(t('retry', 'bn')).toContain('করুন');
    expect(tp('confirmBooking', 'bn')).toContain('করুন');
    expect(tp('findDoctor', 'bn')).toContain('খুঁজুন');
  });
});

describe('the patient catalogue', () => {
  it('reads both languages', () => {
    expect(tp('yourSerial', 'bn')).toBe('আপনার সিরিয়াল');
    expect(tp('yourSerial', 'en')).toBe('Your serial');
  });

  it('itemises the fee in words a person uses (FR-PAT-21)', () => {
    // Four lines, each labelled: consultation, service fee, total, and what is
    // still owed on arrival. A total with no breakdown is a number somebody
    // has to take on trust.
    for (const key of ['feeConsultation', 'feePlatform', 'feeTotal', 'feeDueAtHospital'] as const) {
      expect(tp(key, 'bn').trim()).not.toBe('');
    }
  });
});
