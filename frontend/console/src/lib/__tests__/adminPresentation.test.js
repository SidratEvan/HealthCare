/** Bangladesh periods and snapshot-derived attention (FR-ADM-01/10/12). */
import { describe, expect, it } from 'vitest';

import { dhakaDate, reportRange } from '../admin.js';
import { attentionFor, chamberGroups } from '../adminBoard.js';

const chamber = {
  sessionId: 'chamber-1',
  doctorNameBn: 'ডেমো',
  doctorNameEn: 'Demo',
  departmentNameBn: 'বিভাগ',
  departmentNameEn: 'Department',
  room: '1',
  status: 'scheduled',
  plannedStart: '2026-12-31T17:00:00Z',
  plannedEnd: '2026-12-31T20:00:00Z',
  actualStart: null,
  declaredDelayMinutes: 30,
  waiting: 2,
  seen: 0,
  noShows: 0,
  desks: [{ id: 'desk-1', nameBn: 'ডেস্ক', nameEn: 'Desk' }],
};
function overview(chambers = [chamber]) {
  return {
    date: '2026-12-31',
    serverTs: '2026-12-31T17:30:00Z',
    chambers,
    chambersTruncated: false,
    doctors: { scheduled: 1, sitting: 0 },
    waiting: 2,
    appointments: { booked: 2, seen: 0 },
    beds: null,
    emergency: null,
  };
}

describe('inclusive Bangladesh report dates', () => {
  it.each([
    ['2026-12-31T17:59:59.999Z', '2026-12-31'],
    ['2026-12-31T18:00:00Z', '2027-01-01'],
    ['2028-02-29T18:00:00Z', '2028-03-01'],
  ])('uses Asia/Dhaka at %s', (clock, expected) =>
    expect(dhakaDate(0, new Date(clock))).toBe(expected),
  );
  it.each([0, 6, 29, 89])('holds one clock for a %s-day lookback', (days) => {
    const range = reportRange(days, new Date('2027-01-01T18:00:00Z'));
    expect(range.to).toBe('2027-01-02');
    expect((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000).toBe(days);
  });
});
describe('operational attention', () => {
  it('uses the captured server time and never cumulative delay as present lateness', () => {
    expect(attentionFor(overview()).map((i) => i.message)).toEqual(['adminAttentionOverdue']);
    expect(attentionFor({ ...overview(), serverTs: '2026-12-31T16:00:00Z' })).toEqual([]);
    expect(
      attentionFor(
        overview([{ ...chamber, status: 'running', actualStart: chamber.plannedStart }]),
      ),
    ).toEqual([]);
  });
  it('explains paused queues, missing rooms and missing desk assignments', () => {
    expect(
      attentionFor(overview([{ ...chamber, status: 'paused', room: null, desks: [] }])).map(
        (i) => i.message,
      ),
    ).toEqual(['adminAttentionPaused', 'adminAttentionRoom', 'adminAttentionDesk']);
    expect(attentionFor(overview([{ ...chamber, status: 'paused', waiting: 0 }]))).toEqual([]);
  });
  it.each(['ended', 'cancelled'])('does not raise active attention for %s', (status) =>
    expect(attentionFor(overview([{ ...chamber, status, room: null, desks: [] }]))).toEqual([]),
  );
  it('distinguishes unavailable beds, unknown timestamp and stale measured beds', () => {
    expect(attentionFor(overview([]))).toEqual([]);
    for (const asOf of [null, '2026-12-31T17:24:59Z'])
      expect(
        attentionFor({ ...overview([]), beds: { free: 0, total: 1, asOf } }).map((i) => i.message),
      ).toEqual(['adminAttentionBeds']);
    expect(
      attentionFor({ ...overview([]), beds: { free: 0, total: 1, asOf: '2026-12-31T17:30:00Z' } }),
    ).toEqual([]);
  });
  it('shows multi-desk membership without duplicating within one group and keeps unassigned chambers', () => {
    const groups = chamberGroups([
      { ...chamber, desks: [...chamber.desks, { id: 'desk-2', nameBn: 'দুই', nameEn: 'Two' }] },
      { ...chamber, sessionId: 'chamber-2', desks: [] },
    ]);
    expect(groups.map((g) => g.id)).toEqual(['desk-1', 'desk-2', 'unassigned']);
    expect(groups.map((g) => g.chambers.length)).toEqual([1, 1, 1]);
  });
});
