/**
 * The bed state machine (`FR-BED-01`, `FR-BED-02`).
 *
 * Written around the mistakes a ward makes at the end of a long shift: a
 * patient admitted into a bed another family was promised, a discharged bed
 * published as free before anybody has cleaned it, an occupied bed marked
 * broken with the patient still in it.
 */

import { describe, expect, it } from 'vitest';

import { timestamp, type DhakaDate } from '../../types/ids.js';
import {
  applyLocal,
  canApply,
  canForecastDischarge,
  canReceiveTransfer,
  effectiveState,
  outcomeOf,
  BED_ACTIONS,
  MAX_HOLD_MINUTES,
  type BedView,
} from '../board.js';

const NOW = timestamp('2026-09-21T10:00:00.000Z');
const EARLIER = timestamp('2026-09-21T09:00:00.000Z');
const LATER = timestamp('2026-09-21T11:00:00.000Z');

function bed(overrides: Partial<BedView> = {}): BedView {
  return {
    id: 'bed-301',
    wardId: 'ward-3',
    label: '301',
    kind: 'general',
    state: 'free',
    nightlyPoisha: 120_000,
    lastCleanedAt: EARLIER,
    stateChangedAt: EARLIER,
    expectedDischargeDate: null,
    reservedUntil: null,
    oosReason: null,
    admissionId: null,
    heldForRequestId: null,
    ...overrides,
  };
}

const occupied = (overrides: Partial<BedView> = {}): BedView =>
  bed({ state: 'occupied', admissionId: 'adm-1', ...overrides });

describe('what each state allows', () => {
  it('admits into a free bed, and into nothing that is taken, dirty or broken', () => {
    expect(canApply(bed(), 'admit', NOW).ok).toBe(true);
    for (const state of ['occupied', 'cleaning', 'out_of_service'] as const) {
      const verdict = canApply(bed({ state, oosReason: 'x' }), 'admit', NOW);
      expect(verdict.ok, state).toBe(false);
    }
  });

  it('discharges into cleaning, never straight to free', () => {
    expect(canApply(occupied(), 'discharge', NOW).ok).toBe(true);
    expect(outcomeOf('discharge')).toEqual({ type: 'DISCHARGE', to: 'cleaning' });

    const verdict = canApply(bed(), 'discharge', NOW);
    expect(verdict).toMatchObject({ ok: false, code: 'NOT_OCCUPIED' });
  });

  it('frees a bed only when somebody says the cleaning is done', () => {
    const dirty = bed({ state: 'cleaning' });
    expect(canApply(dirty, 'clean_done', NOW).ok).toBe(true);
    expect(canApply(bed(), 'clean_done', NOW)).toMatchObject({ ok: false, code: 'WRONG_STATE' });
    // There is no timer that frees it: a dirty bed stays dirty until a person
    // says otherwise, however long ago it was discharged.
    expect(effectiveState(bed({ state: 'cleaning', stateChangedAt: EARLIER }), LATER)).toBe(
      'cleaning',
    );
  });

  it('refuses to take an occupied bed out of service, or one without a reason', () => {
    expect(canApply(occupied(), 'oos', NOW, { reason: 'oxygen' }).ok).toBe(false);
    expect(canApply(bed(), 'oos', NOW, { reason: '  ' })).toMatchObject({
      ok: false,
      code: 'REASON_REQUIRED',
    });
    expect(canApply(bed(), 'oos', NOW, { reason: 'oxygen line' }).ok).toBe(true);
    expect(canApply(bed({ state: 'cleaning' }), 'oos', NOW, { reason: 'leak' }).ok).toBe(true);
  });

  it('restores only a bed that is out of service', () => {
    expect(canApply(bed({ state: 'out_of_service', oosReason: 'x' }), 'restore', NOW).ok).toBe(
      true,
    );
    expect(canApply(bed(), 'restore', NOW).ok).toBe(false);
  });

  it('holds a bed for a bounded time only', () => {
    expect(canApply(bed(), 'reserve', NOW, { holdMinutes: 60 }).ok).toBe(true);
    expect(canApply(bed(), 'reserve', NOW, { holdMinutes: 0 }).ok).toBe(false);
    expect(canApply(bed(), 'reserve', NOW, { holdMinutes: MAX_HOLD_MINUTES + 1 })).toMatchObject({
      ok: false,
      code: 'HOLD_OUT_OF_RANGE',
    });
    expect(canApply(occupied(), 'reserve', NOW, { holdMinutes: 60 }).ok).toBe(false);
  });

  it('gives every action exactly one outcome', () => {
    for (const action of BED_ACTIONS) {
      expect(outcomeOf(action).type).toMatch(/^[A-Z_]+$/);
    }
  });
});

describe('holds', () => {
  const held = bed({
    state: 'reserved',
    reservedUntil: LATER,
    heldForRequestId: 'req-1',
  });

  it('keeps a held bed for the family it was held for', () => {
    expect(canApply(held, 'admit', NOW, { bedRequestId: 'req-1' }).ok).toBe(true);
    expect(canApply(held, 'admit', NOW, { bedRequestId: null })).toMatchObject({
      ok: false,
      code: 'HELD_FOR_SOMEONE_ELSE',
    });
    expect(canApply(held, 'admit', NOW, { bedRequestId: 'req-2' }).ok).toBe(false);
  });

  it('counts a lapsed hold as free, for anyone, at once', () => {
    expect(effectiveState(held, NOW)).toBe('reserved');
    expect(effectiveState(held, LATER)).toBe('free');
    expect(canApply(held, 'admit', LATER, { bedRequestId: null }).ok).toBe(true);
  });

  it("lets a transfer land on a manual hold, not on a family's", () => {
    const source = occupied({ id: 'bed-302', label: '302' });
    expect(canReceiveTransfer(source, held, NOW).ok).toBe(false);
    expect(
      canReceiveTransfer(source, bed({ state: 'reserved', reservedUntil: LATER }), NOW).ok,
    ).toBe(true);
    expect(canReceiveTransfer(source, source, NOW)).toMatchObject({ ok: false, code: 'SAME_BED' });
  });
});

describe('expected discharge (FR-BED-04)', () => {
  const today = '2026-09-21' as DhakaDate;

  it('is forecast for an occupied bed, for today or later', () => {
    expect(canForecastDischarge(occupied(), '2026-09-22' as DhakaDate, today).ok).toBe(true);
    expect(canForecastDischarge(occupied(), today, today).ok).toBe(true);
    expect(canForecastDischarge(occupied(), null, today).ok).toBe(true);
    expect(canForecastDischarge(occupied(), '2026-09-20' as DhakaDate, today)).toMatchObject({
      ok: false,
      code: 'DISCHARGE_DATE_PAST',
    });
    expect(canForecastDischarge(bed(), '2026-09-22' as DhakaDate, today).ok).toBe(false);
  });
});

describe('applyLocal — the console before the server answers', () => {
  it('moves a patient: the bed left goes to cleaning, the bed entered takes the stay', () => {
    const board = [
      occupied({ id: 'a', expectedDischargeDate: '2026-09-24' as DhakaDate }),
      bed({ id: 'b', label: '302' }),
    ];

    const after = applyLocal(board, { bedId: 'a', action: 'transfer', toBedId: 'b', at: NOW });

    expect(after.find((entry) => entry.id === 'a')).toMatchObject({
      state: 'cleaning',
      admissionId: null,
      expectedDischargeDate: null,
      stateChangedAt: NOW,
    });
    expect(after.find((entry) => entry.id === 'b')).toMatchObject({
      state: 'occupied',
      admissionId: 'adm-1',
      expectedDischargeDate: '2026-09-24',
    });
  });

  it('clears what belonged to the old state, as the table constraints require', () => {
    const [released] = applyLocal(
      [bed({ state: 'reserved', reservedUntil: LATER, heldForRequestId: null })],
      { bedId: 'bed-301', action: 'release', at: NOW },
    );
    expect(released).toMatchObject({ state: 'free', reservedUntil: null, heldForRequestId: null });

    const [broken] = applyLocal([bed()], {
      bedId: 'bed-301',
      action: 'oos',
      reason: '  oxygen line ',
      at: NOW,
    });
    expect(broken).toMatchObject({ state: 'out_of_service', oosReason: 'oxygen line' });
  });

  it('sets the expiry of a new hold from the moment it was taken', () => {
    const [held] = applyLocal([bed()], {
      bedId: 'bed-301',
      action: 'reserve',
      holdMinutes: 60,
      at: NOW,
    });
    expect(held?.reservedUntil).toBe('2026-09-21T11:00:00.000Z');
  });

  it('ignores an action the bed has moved past, rather than drawing an impossible bed', () => {
    const board = [occupied()];
    expect(applyLocal(board, { bedId: 'bed-301', action: 'admit', at: NOW })).toBe(board);
    expect(applyLocal(board, { bedId: 'no-such-bed', action: 'discharge', at: NOW })).toBe(board);
  });
});
