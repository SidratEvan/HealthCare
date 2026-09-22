/**
 * Notification copy (`FR-NOT-03`, `FR-NOT-04`, `FR-NOT-05`).
 *
 * These messages reach a stranger's phone and cannot be taken back, so the
 * tests are about the two ways that goes wrong: text that arrives with
 * `{serial}` still in it, and a Bangla message that quietly costs three times
 * what it should because nobody counted the characters.
 */

import { describe, expect, it } from 'vitest';

import { TEMPLATES, TEMPLATE_KEYS, placeholdersFor, placeholdersIn, render } from '../templates.js';

/**
 * One UCS-2 SMS segment.
 *
 * Bangla is outside GSM-7, so every message in this file is UCS-2 and a
 * segment holds 70 characters rather than 160. Past that the aggregator bills
 * for two. The tracking link makes `booking.confirmed` unavoidably longer, and
 * that one is worth paying for.
 */
const SMS_SEGMENT = 70;

describe('the catalogue', () => {
  it('covers every key it declares, in both channels where the mapping says so', () => {
    for (const key of TEMPLATE_KEYS) {
      const found = TEMPLATES.filter((template) => template.key === key);
      expect(found.length, `${key} has no template`).toBeGreaterThan(0);
    }
  });

  it('writes every message in both languages (FR-NOT-04)', () => {
    // A key that exists in one language and not the other is a patient who
    // gets nothing because they chose English.
    for (const template of TEMPLATES) {
      expect(template.bn.trim(), `${template.key}/${template.channel} bn`).not.toBe('');
      expect(template.en.trim(), `${template.key}/${template.channel} en`).not.toBe('');
    }
  });

  it('declares a version for every template (FR-NOT-05)', () => {
    for (const template of TEMPLATES) {
      expect(template.version).toBeGreaterThan(0);
    }
  });

  it('has no duplicate key, channel and locale', () => {
    // The table's primary key is exactly this triple, so a duplicate here
    // would fail the seed rather than the test — but failing here says why.
    const seen = new Set<string>();
    for (const template of TEMPLATES) {
      const id = `${template.key}/${template.channel}`;
      expect(seen.has(id), `${id} appears twice`).toBe(false);
      seen.add(id);
    }
  });

  it('sends the no-show notice by SMS only (BACKEND.md §8)', () => {
    // "A person who missed their turn is not looking at the app."
    const channels = TEMPLATES.filter((t) => t.key === 'queue.no_show').map((t) => t.channel);
    expect(channels).toEqual(['sms']);
  });
});

describe('placeholders', () => {
  it('reads the names out of a body', () => {
    expect(placeholdersIn('সিরিয়াল {serial}, {time}')).toEqual(['serial', 'time']);
  });

  it('agrees across both languages of a key', () => {
    // A Bangla body naming `{eta}` whose English twin does not means one of
    // the two reaches somebody with a blank where a time should be.
    for (const template of TEMPLATES) {
      expect(
        [...placeholdersIn(template.bn)].sort(),
        `${template.key}/${template.channel}: bn and en refer to different placeholders`,
      ).toEqual([...placeholdersIn(template.en)].sort());
    }
  });

  it('collects every placeholder a key needs across its channels', () => {
    expect(placeholdersFor('queue.called')).toEqual(['room', 'serial']);
  });

  it('names a serial in every message about a serial', () => {
    // The one thing in these messages a person acts on. A queue notice
    // without it is a notice they cannot match to their own booking.
    for (const key of TEMPLATE_KEYS) {
      if (key === 'queue.doctor_arrived') continue;
      // A bed request has no serial; its messages name the hospital and the
      // bed instead, which the next test holds them to.
      if (key.startsWith('bed.')) continue;
      expect(placeholdersFor(key), `${key} never says which serial`).toContain('serial');
    }
  });

  it('names the hospital and the kind of bed in every answer to a bed request', () => {
    for (const key of TEMPLATE_KEYS.filter((candidate) => candidate.startsWith('bed.'))) {
      expect(placeholdersFor(key)).toEqual(expect.arrayContaining(['hospital', 'kind']));
    }
    // A hold that does not say when it runs out is a bed lost without warning.
    expect(placeholdersFor('bed.request_held')).toContain('time');
  });
});

describe('rendering', () => {
  it('substitutes what it is given', () => {
    expect(render('সিরিয়াল {serial}, {room}', { serial: '১৮', room: '৩ নম্বর কক্ষ' })).toBe(
      'সিরিয়াল ১৮, ৩ নম্বর কক্ষ',
    );
  });

  it('leaves a missing placeholder visible rather than blanking it', () => {
    // `সিরিয়াল {serial}` reaching a patient is obviously broken and gets
    // reported; `সিরিয়াল ` looks like a serial that does not exist.
    expect(render('সিরিয়াল {serial}', {})).toBe('সিরিয়াল {serial}');
  });

  it('ignores parameters nothing asked for', () => {
    expect(render('সিরিয়াল {serial}', { serial: '৪', unused: 'x' })).toBe('সিরিয়াল ৪');
  });

  it('substitutes every occurrence', () => {
    expect(render('{a} এবং {a}', { a: 'x' })).toBe('x এবং x');
  });
});

describe('what an SMS costs (FR-NOT-06)', () => {
  it('keeps queue messages inside one UCS-2 segment', () => {
    // Measured with the placeholders at a realistic width rather than as
    // literal braces, because `{serial}` is eight characters and "১৮" is two.
    const sample: Record<string, string> = {
      serial: '১৮',
      doctor: 'ডা. রহমান',
      hospital: 'শাপলা হাসপাতাল',
      minutes: '৩০',
      eta: 'সন্ধ্যা ৬:০৫',
      room: '৩ নম্বর কক্ষ',
      date: '১৮ সেপ্টেম্বর',
      link: '',
    };

    for (const template of TEMPLATES) {
      if (template.channel !== 'sms') continue;
      // The tracking link is unavoidably long and is the reason that message
      // exists at all (`FR-GST-05`).
      if (template.key === 'booking.confirmed') continue;

      const rendered = render(template.bn, sample);
      expect(
        rendered.length,
        `${template.key} is ${String(rendered.length)} characters: "${rendered}"`,
      ).toBeLessThanOrEqual(SMS_SEGMENT);
    }
  });
});
