/**
 * What typed text means, and the order results come in (`FR-PAT-16`–`18`).
 */

import { describe, expect, it } from 'vitest';

import { BED_KINDS, CAPABILITY_KINDS } from '../../types/enums.js';
import { SPECIALTIES } from '../../types/specialties.js';
import {
  SEARCH_BED_KINDS,
  SEARCH_CAPABILITIES,
  foldSearchText,
  needKey,
  parseNeed,
  readSearch,
  suggestNeeds,
  type SearchNeed,
} from '../needs.js';
import { confirmedTallyOfKind, orderForNeed, tallyOfKind } from '../order.js';

import type { PublicCapacity } from '../../beds/capacity.js';
import type { Timestamp } from '../../types/ids.js';

const AS_OF = '2026-10-05T10:00:00.000Z' as Timestamp;

function capacity(
  hospitalId: string,
  kinds: readonly { kind: 'icu' | 'general'; free: number; total: number; confirmed?: boolean }[],
): PublicCapacity {
  return {
    hospitalId,
    bedTotal: kinds.reduce((sum, entry) => sum + entry.total, 0),
    bedFree: kinds.reduce((sum, entry) => sum + entry.free, 0),
    icuTotal: null,
    icuFree: null,
    icuAsOf: null,
    bedsAsOf: AS_OF,
    byKind: kinds.map((entry) => ({
      kind: entry.kind,
      free: entry.free,
      total: entry.total,
      asOf: entry.confirmed === false ? null : AS_OF,
    })) as unknown as PublicCapacity['byKind'],
  };
}

describe('a need as a key', () => {
  it('round-trips every need the search offers', () => {
    const needs: SearchNeed[] = [
      ...SPECIALTIES.map((entry) => ({ kind: 'specialty', code: entry.code }) as const),
      ...SEARCH_BED_KINDS.map((bedKind) => ({ kind: 'bed', bedKind }) as const),
      ...SEARCH_CAPABILITIES.map((capability) => ({ kind: 'capability', capability }) as const),
    ];

    for (const need of needs) expect(parseNeed(needKey(need))).toEqual(need);
  });

  it('refuses a need the data does not hold (FR-PAT-18)', () => {
    expect(parseNeed('specialty:ONCO')).toBeNull();
    expect(parseNeed('bed:penthouse')).toBeNull();
    expect(parseNeed('capability:teleport')).toBeNull();
    expect(parseNeed('icu')).toBeNull();
    expect(parseNeed('')).toBeNull();
  });

  it('offers only kinds the schema has', () => {
    for (const kind of SEARCH_BED_KINDS) expect(BED_KINDS).toContain(kind);
    for (const kind of SEARCH_CAPABILITIES) expect(CAPABILITY_KINDS).toContain(kind);
  });

  it('does not offer the two services that are outside V1 as needs', () => {
    expect(SEARCH_CAPABILITIES).not.toContain('blood_bank');
    expect(SEARCH_CAPABILITIES).not.toContain('ambulance');
  });
});

describe('reading what somebody typed', () => {
  it('folds case, spacing and edge punctuation', () => {
    expect(foldSearchText('  ICU  ')).toBe('icu');
    expect(foldSearchText('Burn   Unit?')).toBe('burn unit');
    expect(foldSearchText('')).toBe('');
  });

  it.each([
    ['ICU', 'bed:icu'],
    ['icu', 'bed:icu'],
    ['আইসিইউ', 'bed:icu'],
    ['NICU', 'bed:nicu'],
    ['কেবিন', 'bed:cabin'],
    ['burn', 'capability:burn_unit'],
    ['Burn unit', 'capability:burn_unit'],
    ['বার্ন ইউনিট', 'capability:burn_unit'],
    ['dialysis', 'capability:dialysis'],
    ['Cardiology', 'specialty:CARD'],
    ['কার্ডিওলজি', 'specialty:CARD'],
    ['cardiologist', 'specialty:CARD'],
    ['শিশু', 'specialty:PAED'],
    ['ENT', 'specialty:ENT'],
  ])('reads %s as %s', (typed, key) => {
    const reading = readSearch(typed);
    expect(reading.need === null ? null : needKey(reading.need)).toBe(key);
  });

  it('keeps the text as well, so names can still be matched', () => {
    expect(readSearch('  Heart ').text).toBe('Heart');
  });

  it('reads a name as a name, not as a need', () => {
    // A person, a hospital, and a word that only contains a need.
    for (const typed of ['Dr Rahman', 'Shapla General', 'Burnett', 'ডা. করিম']) {
      expect(readSearch(typed).need).toBeNull();
      expect(readSearch(typed).text).toBe(typed);
    }
  });

  it('reads nothing as nothing', () => {
    expect(readSearch('')).toEqual({ need: null, text: null });
    expect(readSearch('   ')).toEqual({ need: null, text: null });
    expect(readSearch(null)).toEqual({ need: null, text: null });
  });

  it('gives every name to one need only', () => {
    // A name two needs share would be read as neither, silently.
    const typed = [
      'icu',
      'ccu',
      'nicu',
      'hdu',
      'cabin',
      'bed',
      'burn',
      'cardiac',
      'stroke',
      'dialysis',
      'trauma',
      'isolation',
      'heart',
      'skin',
      'bone',
    ];
    for (const word of typed) expect(readSearch(word).need, word).not.toBeNull();
  });
});

describe('offering a need while somebody types', () => {
  it('offers nothing for one letter', () => {
    expect(suggestNeeds('c')).toEqual([]);
  });

  it('offers the needs whose name starts with what was typed', () => {
    expect(suggestNeeds('card').map(needKey)).toContain('specialty:CARD');
    expect(suggestNeeds('dia').map(needKey)).toEqual(['capability:dialysis']);
    expect(suggestNeeds('আই').map(needKey)).toContain('bed:icu');
  });

  it('offers a need by a later word of its name', () => {
    expect(suggestNeeds('unit').map(needKey)).toContain('capability:burn_unit');
  });

  it('puts an exact name first and keeps to the limit', () => {
    expect(suggestNeeds('burn').map(needKey)[0]).toBe('capability:burn_unit');
    expect(suggestNeeds('ca', 2)).toHaveLength(2);
  });

  it('offers nothing for a name', () => {
    expect(suggestNeeds('Rahman')).toEqual([]);
  });
});

describe('the order of results', () => {
  const a = { id: 'a', beds: capacity('a', [{ kind: 'icu', free: 1, total: 8 }]) };
  const b = { id: 'b', beds: capacity('b', [{ kind: 'icu', free: 5, total: 10 }]) };
  const full = { id: 'full', beds: capacity('full', [{ kind: 'icu', free: 0, total: 6 }]) };
  const unconfirmed = {
    id: 'unconfirmed',
    beds: capacity('unconfirmed', [{ kind: 'icu', free: 9, total: 9, confirmed: false }]),
  };
  const none = { id: 'none', beds: capacity('none', [{ kind: 'general', free: 30, total: 40 }]) };

  it('puts the most free beds of the kind asked for first', () => {
    const ordered = orderForNeed([a, full, b], { kind: 'bed', bedKind: 'icu' });
    expect(ordered.map((entry) => entry.id)).toEqual(['b', 'a', 'full']);
  });

  it('puts a full hospital before one that has never confirmed its count', () => {
    // Nine unconfirmed beds are not nine beds (PRD §3.2).
    const ordered = orderForNeed([unconfirmed, none, full], { kind: 'bed', bedKind: 'icu' });
    expect(ordered.map((entry) => entry.id)).toEqual(['full', 'unconfirmed', 'none']);
  });

  it('leaves the order alone for a specialty, a capability or no need', () => {
    const list = [a, b, full];
    expect(orderForNeed(list, null)).toBe(list);
    expect(orderForNeed(list, { kind: 'specialty', code: 'CARD' })).toBe(list);
    expect(orderForNeed(list, { kind: 'capability', capability: 'burn_unit' })).toBe(list);
  });

  it('reads one kind out of the published figures', () => {
    expect(tallyOfKind(a.beds, 'icu')?.free).toBe(1);
    expect(tallyOfKind(a.beds, 'cabin')).toBeNull();
    expect(tallyOfKind(null, 'icu')).toBeNull();
  });

  it('does not hand out a count nobody has confirmed', () => {
    expect(tallyOfKind(unconfirmed.beds, 'icu')?.free).toBe(9);
    expect(confirmedTallyOfKind(unconfirmed.beds, 'icu')).toBeNull();
    expect(confirmedTallyOfKind(a.beds, 'icu')?.free).toBe(1);
  });
});
