import { describe, expect, it } from 'vitest';

import {
  deliveryPercent,
  figureHealth,
  stalestFigure,
  workspaceAttention,
  workspaceHealth,
  type FigureHealth,
  type MessageCounts,
  type SyncCounts,
} from '../health.js';

import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-10-06T12:00:00.000Z' as Timestamp;
const minutesAgo = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) - minutes * 60_000).toISOString() as Timestamp;

const QUIET: MessageCounts = { sent: 0, failed: 0, held: 0, waiting: 0 };
const NO_SYNC: SyncCounts = { lateActions: 0, slowestSeconds: 0, lastLateAt: null };

function figure(overrides: Partial<FigureHealth> = {}): FigureHealth {
  return {
    figure: 'beds',
    shared: true,
    asOf: minutesAgo(2),
    ageMinutes: 2,
    stale: false,
    ...overrides,
  };
}

describe('a figure’s age, by the rule a patient’s screen uses (FR-SUP-06, FR-OFF-03)', () => {
  it('is fresh inside the hospital’s own threshold and stale once it reaches it', () => {
    const fresh = figureHealth({ figure: 'beds', shared: true, asOf: minutesAgo(9) }, NOW, 10);
    expect(fresh).toMatchObject({ ageMinutes: 9, stale: false });

    const stale = figureHealth({ figure: 'beds', shared: true, asOf: minutesAgo(10) }, NOW, 10);
    expect(stale).toMatchObject({ ageMinutes: 10, stale: true });

    // A hospital that set a longer threshold is held to its own.
    const lenient = figureHealth({ figure: 'beds', shared: true, asOf: minutesAgo(25) }, NOW, 30);
    expect(lenient.stale).toBe(false);
  });

  it('never confirmed has no age and is stale: unknown is not fresh', () => {
    const never = figureHealth({ figure: 'capabilities', shared: true, asOf: null }, NOW, 10);
    expect(never).toMatchObject({ asOf: null, ageMinutes: null, stale: true });
  });
});

describe('what asks for somebody’s attention (FR-SUP-06)', () => {
  it('nothing, where every shared figure is fresh and every message went', () => {
    expect(
      workspaceAttention({
        live: true,
        figures: [figure()],
        messages: { ...QUIET, sent: 40, held: 3 },
      }),
    ).toEqual([]);
  });

  it('not a figure that is merely stale: most are, most of a night, and it is ranked instead', () => {
    expect(
      workspaceAttention({
        live: true,
        figures: [figure({ stale: true, ageMinutes: 180 })],
        messages: QUIET,
      }),
    ).toEqual([]);
  });

  it('a figure a live hospital publishes that nobody ever confirmed', () => {
    expect(
      workspaceAttention({
        live: true,
        figures: [figure({ stale: true, asOf: null, ageMinutes: null })],
        messages: QUIET,
      }),
    ).toEqual(['unconfirmed_figures']);
  });

  it('not an unconfirmed figure the hospital keeps to itself: nobody is shown it (FR-NET-04)', () => {
    expect(
      workspaceAttention({
        live: true,
        figures: [figure({ stale: true, asOf: null, ageMinutes: null, shared: false })],
        messages: QUIET,
      }),
    ).toEqual([]);
  });

  it('not a workspace that is not public: an unconfirmed figure is what setting up looks like', () => {
    expect(
      workspaceAttention({
        live: false,
        figures: [figure({ stale: true, asOf: null, ageMinutes: null })],
        messages: QUIET,
      }),
    ).toEqual([]);
  });

  it('a message that failed, or one still waiting: somebody was not told', () => {
    expect(
      workspaceAttention({ live: true, figures: [], messages: { ...QUIET, sent: 9, failed: 1 } }),
    ).toEqual(['messages']);
    expect(
      workspaceAttention({ live: false, figures: [], messages: { ...QUIET, waiting: 2 } }),
    ).toEqual(['messages']);
  });

  it('a held message is not a failure: quiet hours and a missing number are decisions', () => {
    expect(
      workspaceAttention({ live: true, figures: [], messages: { ...QUIET, held: 12 } }),
    ).toEqual([]);
  });

  it('both, in the order they are said', () => {
    expect(
      workspaceAttention({
        live: true,
        figures: [figure({ stale: true, asOf: null, ageMinutes: null })],
        messages: { ...QUIET, failed: 2 },
      }),
    ).toEqual(['unconfirmed_figures', 'messages']);
  });
});

describe('the stale-data offender: a workspace’s oldest shared figure (FR-SUP-06)', () => {
  it('is the oldest of the stale ones a patient is shown', () => {
    expect(
      stalestFigure({
        live: true,
        figures: [
          figure({ figure: 'beds', stale: true, ageMinutes: 45 }),
          figure({ figure: 'capabilities', stale: true, ageMinutes: 180 }),
        ],
      }),
    ).toEqual({ figure: 'capabilities', ageMinutes: 180 });
  });

  it('is nothing where every shared figure is fresh', () => {
    expect(
      stalestFigure({ live: true, figures: [figure(), figure({ ageMinutes: 9 })] }),
    ).toBeNull();
  });

  it('leaves out a figure kept from the network, one never confirmed, and a workspace that is not public', () => {
    expect(
      stalestFigure({
        live: true,
        figures: [
          figure({ stale: true, ageMinutes: 600, shared: false }),
          figure({ stale: true, asOf: null, ageMinutes: null }),
        ],
      }),
    ).toBeNull();
    expect(
      stalestFigure({ live: false, figures: [figure({ stale: true, ageMinutes: 600 })] }),
    ).toBeNull();
  });
});

describe('a workspace’s health, assembled', () => {
  it('carries each figure’s age and never flags late sync: offline work arriving is the product working (FR-OFF-01)', () => {
    const health = workspaceHealth({
      live: true,
      stamps: [
        { figure: 'beds', shared: true, asOf: minutesAgo(3) },
        { figure: 'capabilities', shared: true, asOf: minutesAgo(4) },
      ],
      messages: { ...QUIET, sent: 12 },
      sync: { lateActions: 14, slowestSeconds: 1_560, lastLateAt: minutesAgo(600) },
      now: NOW,
      thresholdMinutes: 10,
    });
    expect(health.figures.map((entry) => entry.ageMinutes)).toEqual([3, 4]);
    expect(health.sync.lateActions).toBe(14);
    expect(health.attention).toEqual([]);
    expect(health.stalest).toBeNull();
  });

  it('a hospital with no figure to report has none, and is not stale for it', () => {
    const health = workspaceHealth({
      live: true,
      stamps: [],
      messages: QUIET,
      sync: NO_SYNC,
      now: NOW,
      thresholdMinutes: 10,
    });
    expect(health.figures).toEqual([]);
    expect(health.attention).toEqual([]);
  });
});

describe('the share of messages that went', () => {
  it('is of what was attempted, rounded down, and nothing where nothing was', () => {
    expect(deliveryPercent(QUIET)).toBeNull();
    expect(deliveryPercent({ ...QUIET, held: 5 })).toBeNull();
    expect(deliveryPercent({ ...QUIET, sent: 10 })).toBe(100);
    expect(deliveryPercent({ ...QUIET, sent: 199, failed: 1 })).toBe(99);
    expect(deliveryPercent({ ...QUIET, sent: 2, failed: 1 })).toBe(66);
  });
});
