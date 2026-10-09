/**
 * The preferred hours a chamber offers (`FR-PAT-28`; plan R1).
 */

import { describe, expect, it } from 'vitest';

import { arrivalWindowAt, arrivalWindows } from '../arrivalWindows.js';

// 17:00 to 20:30 in Dhaka.
const START = '2026-10-08T11:00:00.000Z';
const END = '2026-10-08T14:30:00.000Z';

describe('arrivalWindows', () => {
  it('counts hours from the chamber’s start and cuts the last at its end', () => {
    expect(arrivalWindows(START, END)).toEqual([
      { start: '2026-10-08T11:00:00.000Z', end: '2026-10-08T12:00:00.000Z' },
      { start: '2026-10-08T12:00:00.000Z', end: '2026-10-08T13:00:00.000Z' },
      { start: '2026-10-08T13:00:00.000Z', end: '2026-10-08T14:00:00.000Z' },
      { start: '2026-10-08T14:00:00.000Z', end: '2026-10-08T14:30:00.000Z' },
    ]);
  });

  it('offers nothing for a chamber that makes no sense', () => {
    expect(arrivalWindows(END, START)).toEqual([]);
    expect(arrivalWindows('not a time', END)).toEqual([]);
  });

  it('offers at most twelve hours', () => {
    expect(arrivalWindows(START, '2026-10-09T11:00:00.000Z')).toHaveLength(12);
  });
});

describe('arrivalWindowAt', () => {
  it('names a window by its start, however the instant is written', () => {
    expect(arrivalWindowAt(START, END, '2026-10-08T18:00:00+06:00')).toEqual({
      start: '2026-10-08T12:00:00.000Z',
      end: '2026-10-08T13:00:00.000Z',
    });
  });

  it('refuses a start that is not one of the chamber’s', () => {
    expect(arrivalWindowAt(START, END, '2026-10-08T12:30:00.000Z')).toBeNull();
    expect(arrivalWindowAt(START, END, '2026-10-08T15:00:00.000Z')).toBeNull();
    expect(arrivalWindowAt(START, END, 'tomorrow')).toBeNull();
  });
});
