import { describe, expect, it } from 'vitest';

import { EMERGENCY_PROBLEMS } from '../../types/enums.js';
import { freshnessOf } from '../freshness.js';
import {
  PROBLEM_CAPABILITY,
  rankCandidates,
  relevantFreeBeds,
  requiredCapability,
  stampsFor,
  type CapacityFigures,
  type RankCandidate,
} from '../ranking.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-21T12:00:00.000Z' as Timestamp;
const minutesAgo = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString() as Timestamp;

function candidate(overrides: Partial<RankCandidate> & { hospitalId: string }): RankCandidate {
  return {
    hasCapability: true,
    stale: false,
    travelMinutes: 20,
    erLoad: 3,
    freeBeds: 5,
    ...overrides,
  };
}

const ids = (ranked: readonly RankCandidate[]): string[] => ranked.map((entry) => entry.hospitalId);

describe('FR-PAT-43: capability, then travel time, then load, then beds', () => {
  it('puts a facility that can take the case above a nearer one that cannot', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'near-unable', hasCapability: false, travelMinutes: 5 }),
      candidate({ hospitalId: 'far-able', hasCapability: true, travelMinutes: 40 }),
    ]);
    expect(ids(ranked)).toEqual(['far-able', 'near-unable']);
  });

  it('breaks a capability tie on travel time, then load, then free beds', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'slow', travelMinutes: 30 }),
      candidate({ hospitalId: 'busy', travelMinutes: 10, erLoad: 9 }),
      candidate({ hospitalId: 'quiet-few-beds', travelMinutes: 10, erLoad: 2, freeBeds: 1 }),
      candidate({ hospitalId: 'quiet-many-beds', travelMinutes: 10, erLoad: 2, freeBeds: 6 }),
    ]);
    expect(ids(ranked)).toEqual(['quiet-many-beds', 'quiet-few-beds', 'busy', 'slow']);
  });

  it('treats "nothing required" as a tie, not as unable', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'b', hasCapability: null, travelMinutes: 15 }),
      candidate({ hospitalId: 'a', hasCapability: null, travelMinutes: 8 }),
    ]);
    expect(ids(ranked)).toEqual(['a', 'b']);
  });

  it('sorts an unknown travel time, load or bed count last rather than first', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'unknown-travel', travelMinutes: null }),
      candidate({ hospitalId: 'known-travel', travelMinutes: 55 }),
    ]);
    expect(ids(ranked)).toEqual(['known-travel', 'unknown-travel']);

    const byBeds = rankCandidates([
      candidate({ hospitalId: 'no-figure', freeBeds: null }),
      candidate({ hospitalId: 'zero', freeBeds: 0 }),
    ]);
    expect(ids(byBeds)).toEqual(['zero', 'no-figure']);
  });

  it('gives two phones asking the same question the same order', () => {
    const tied = [candidate({ hospitalId: 'y' }), candidate({ hospitalId: 'x' })];
    expect(ids(rankCandidates(tied))).toEqual(['x', 'y']);
    expect(ids(rankCandidates([...tied].reverse()))).toEqual(['x', 'y']);
  });

  it('leaves its input alone', () => {
    const input = [
      candidate({ hospitalId: 'b', travelMinutes: 9 }),
      candidate({ hospitalId: 'a' }),
    ];
    rankCandidates(input);
    expect(ids(input)).toEqual(['b', 'a']);
  });
});

describe('FR-PAT-45: stale data is ranked lower, inside its capability tier', () => {
  it('stages the pitch: a fresh burn unit further away above a stale one nearer (PRD.md §24 step 7)', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'jamuna', stale: true, travelMinutes: 9, erLoad: 8, freeBeds: 2 }),
      candidate({ hospitalId: 'padma', stale: false, travelMinutes: 38, erLoad: 3, freeBeds: 1 }),
      candidate({ hospitalId: 'shapla', hasCapability: false, travelMinutes: 6 }),
    ]);
    expect(ids(ranked)).toEqual(['padma', 'jamuna', 'shapla']);
  });

  it('never lifts a stale able facility below a fresh unable one', () => {
    const ranked = rankCandidates([
      candidate({ hospitalId: 'fresh-unable', hasCapability: false }),
      candidate({ hospitalId: 'stale-able', hasCapability: true, stale: true }),
    ]);
    expect(ids(ranked)).toEqual(['stale-able', 'fresh-unable']);
  });
});

describe('problem → capability (owner ruling, 2026-09-21)', () => {
  it('maps four problems to a capability and four to none', () => {
    expect(PROBLEM_CAPABILITY).toEqual({
      burn: 'burn_unit',
      accident: 'trauma_ot',
      cardiac: 'cardiac',
      stroke: 'stroke',
      breathing: null,
      child: null,
      obstetric: null,
      other: null,
    });
    expect(Object.keys(PROBLEM_CAPABILITY).sort()).toEqual([...EMERGENCY_PROBLEMS].sort());
  });

  it('requires nothing before a problem is chosen (FR-PAT-41, the critical screen)', () => {
    expect(requiredCapability(null)).toBeNull();
  });
});

describe('the figures a result card stands on', () => {
  const padma: CapacityFigures = {
    bedTotal: 60,
    bedFree: 7,
    icuTotal: 8,
    icuAsOf: minutesAgo(3),
    bedsAsOf: minutesAgo(9),
    capabilityAsOf: minutesAgo(2),
    byKind: [
      { kind: 'general', free: 5, asOf: minutesAgo(5) },
      { kind: 'burn', free: 1, asOf: minutesAgo(4) },
    ],
  };

  it('counts burn beds for a burn, and every free bed otherwise', () => {
    expect(relevantFreeBeds('burn', padma)).toBe(1);
    expect(relevantFreeBeds('cardiac', padma)).toBe(7);
    expect(relevantFreeBeds(null, padma)).toBe(7);
  });

  it('says "no burn beds here" as null, not as zero free', () => {
    const shapla: CapacityFigures = {
      ...padma,
      byKind: [{ kind: 'general', free: 5, asOf: null }],
    };
    expect(relevantFreeBeds('burn', shapla)).toBeNull();
  });

  it('ranks a burn card on its capability and its burn beds — not the rest of the hospital', () => {
    expect(stampsFor('burn', padma)).toEqual([minutesAgo(2), minutesAgo(4)]);
    // Nine minutes old overall, but the burn card shows none of those figures.
    expect(freshnessOf(stampsFor('burn', padma), NOW, 10)).toMatchObject({
      ageMinutes: 4,
      stale: false,
    });
  });

  it('ranks a card with no capability required on the hospital total', () => {
    expect(stampsFor('other', padma)).toEqual([minutesAgo(9)]);
  });

  it('never lets a full ICU nobody can touch turn a fresh burn unit stale', () => {
    const oldIcu: CapacityFigures = { ...padma, icuAsOf: minutesAgo(300) };
    expect(freshnessOf(stampsFor('burn', oldIcu), NOW, 10).stale).toBe(false);
  });

  it('lets one never-confirmed figure make the whole card stale', () => {
    const unconfirmed: CapacityFigures = { ...padma, capabilityAsOf: null };
    expect(freshnessOf(stampsFor('burn', unconfirmed), NOW, 10).stale).toBe(true);
  });
});
