/**
 * Counting beds (`FR-BED-04`, `FR-BED-05`, `FR-BED-06`).
 *
 * The public count here must be the same arithmetic as
 * `v_public_hospital_capacity`: `database/tests/beds.test.ts` asserts the SQL
 * half with the same situations, so a rule changed on one side and not the
 * other fails one of the two suites.
 */

import { describe, expect, it } from 'vitest';

import { BED_KINDS } from '../../types/enums.js';
import { timestamp, type DhakaDate } from '../../types/ids.js';
import {
  bedFigure,
  forecastTomorrow,
  mirrorMismatches,
  nextDay,
  tallyByKind,
  type PublicCapacity,
} from '../capacity.js';

import type { BedView } from '../board.js';

const NOW = timestamp('2026-09-21T10:00:00.000Z');
const TODAY = '2026-09-21' as DhakaDate;

let counter = 0;
function bed(overrides: Partial<BedView> = {}): BedView {
  counter += 1;
  return {
    id: `bed-${String(counter)}`,
    wardId: 'ward',
    label: String(300 + counter),
    kind: 'general',
    state: 'free',
    nightlyPoisha: 120_000,
    lastCleanedAt: null,
    stateChangedAt: NOW,
    expectedDischargeDate: null,
    reservedUntil: null,
    oosReason: null,
    admissionId: null,
    heldForRequestId: null,
    version: 1,
    ...overrides,
  };
}

describe('tallyByKind — what the public is told', () => {
  it('leaves a broken bed out of the total, and counts a lapsed hold as free', () => {
    const tallies = tallyByKind(
      [
        bed(),
        bed({ state: 'occupied', admissionId: 'a' }),
        bed({ state: 'out_of_service', oosReason: 'oxygen' }),
        bed({ state: 'reserved', reservedUntil: timestamp('2026-09-21T09:59:00.000Z') }),
        bed({ state: 'reserved', reservedUntil: timestamp('2026-09-21T11:00:00.000Z') }),
      ],
      NOW,
      BED_KINDS,
    );

    expect(tallies).toEqual([
      { kind: 'general', total: 4, free: 2, nightlyMinPoisha: 120_000, nightlyMaxPoisha: 120_000 },
    ]);
  });

  it('lists only kinds the hospital has, in bed_kind order', () => {
    const tallies = tallyByKind(
      [
        bed({ kind: 'icu', nightlyPoisha: 2_200_000 }),
        bed({ kind: 'cabin', nightlyPoisha: 550_000 }),
      ],
      NOW,
      BED_KINDS,
    );
    expect(tallies.map((entry) => entry.kind)).toEqual(['cabin', 'icu']);
  });

  it('reports a price range when a kind is priced differently across wards', () => {
    const [tally] = tallyByKind(
      [bed({ nightlyPoisha: 100_000 }), bed({ nightlyPoisha: 130_000 })],
      NOW,
      BED_KINDS,
    );
    expect(tally).toMatchObject({ nightlyMinPoisha: 100_000, nightlyMaxPoisha: 130_000 });
  });
});

describe('forecastTomorrow — staff only (FR-BED-04)', () => {
  it('adds beds being cleaned and patients leaving by tomorrow to what is free now', () => {
    const [forecast] = forecastTomorrow(
      [
        bed(),
        bed({ state: 'cleaning' }),
        bed({ state: 'occupied', admissionId: 'a', expectedDischargeDate: TODAY }),
        bed({ state: 'occupied', admissionId: 'b', expectedDischargeDate: nextDay(TODAY) }),
        bed({
          state: 'occupied',
          admissionId: 'c',
          expectedDischargeDate: '2026-09-25' as DhakaDate,
        }),
        bed({ state: 'occupied', admissionId: 'd' }),
        bed({ state: 'reserved', reservedUntil: timestamp('2026-09-21T12:00:00.000Z') }),
      ],
      NOW,
      TODAY,
      BED_KINDS,
    );

    expect(forecast).toEqual({ kind: 'general', freeNow: 1, freeTomorrow: 4, unforecast: 1 });
  });

  it('rolls over month ends in Dhaka dates', () => {
    expect(nextDay('2026-09-30' as DhakaDate)).toBe('2026-10-01');
    expect(nextDay('2026-12-31' as DhakaDate)).toBe('2027-01-01');
  });
});

describe('mirrorMismatches — the board against the published figure (FR-BED-06)', () => {
  const published = (free: number): PublicCapacity => ({
    hospitalId: 'h',
    bedTotal: 2,
    bedFree: free,
    icuTotal: null,
    icuFree: null,
    icuAsOf: null,
    bedsAsOf: NOW,
    byKind: [
      {
        kind: 'general',
        total: 2,
        free,
        nightlyMinPoisha: 120_000,
        nightlyMaxPoisha: 120_000,
        asOf: NOW,
      },
    ],
  });

  it('agrees when both were counted from the same beds', () => {
    const board = tallyByKind(
      [bed(), bed({ state: 'occupied', admissionId: 'a' })],
      NOW,
      BED_KINDS,
    );
    expect(mirrorMismatches(board, published(1))).toEqual([]);
  });

  it('names the kind that disagrees — an admit the public has not heard about yet', () => {
    const board = tallyByKind(
      [bed({ state: 'occupied', admissionId: 'a' }), bed({ state: 'occupied', admissionId: 'b' })],
      NOW,
      BED_KINDS,
    );
    expect(mirrorMismatches(board, published(1))).toEqual(['general']);
  });
});

describe('bedFigure: what a patient may be told (FR-PAT-14, owner 8 October)', () => {
  const at = (minutesAgo: number) =>
    timestamp(new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString());

  it('gives the exact count while the figure is fresh', () => {
    expect(bedFigure(4, at(3), NOW, 10)).toEqual({ kind: 'count', free: 4 });
    expect(bedFigure(0, at(9), NOW, 10)).toEqual({ kind: 'count', free: 0 });
  });

  it('is not known once the threshold is reached, free beds or none (decision 10)', () => {
    expect(bedFigure(4, at(10), NOW, 10)).toEqual({ kind: 'unknown' });
    expect(bedFigure(0, at(240), NOW, 10)).toEqual({ kind: 'unknown' });
  });

  it("follows the hospital's own threshold", () => {
    expect(bedFigure(2, at(25), NOW, 30)).toEqual({ kind: 'count', free: 2 });
    expect(bedFigure(2, at(25), NOW, 20)).toEqual({ kind: 'unknown' });
  });

  it('never turns an unknown into a zero', () => {
    expect(bedFigure(null, at(1), NOW, 10)).toEqual({ kind: 'unknown' });
    expect(bedFigure(3, null, NOW, 10)).toEqual({ kind: 'unknown' });
  });
});
