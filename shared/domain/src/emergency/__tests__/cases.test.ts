import { describe, expect, it } from 'vitest';

import {
  alreadyApplied,
  applyLocalCase,
  canActOn,
  expectedArrival,
  inboundOrder,
  loadOf,
  nextTokenLabel,
  triageOrder,
  type EmergencyAction,
  type EmergencyCaseView,
} from '../cases.js';

import type { EmergencyState } from '../../types/enums.js';
import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-21T12:00:00.000Z' as Timestamp;
const at = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString() as Timestamp;

function inbound(overrides: Partial<EmergencyCaseView> = {}): EmergencyCaseView {
  return {
    id: 'case-1',
    hospitalId: 'hospital-1',
    state: 'inbound',
    problem: 'burn',
    triage: null,
    tokenLabel: null,
    ageYears: null,
    sex: null,
    hasPhone: false,
    inboundAt: at(-5),
    inboundEtaMinutes: 20,
    acknowledgedAt: null,
    arrivedAt: null,
    closedAt: null,
    declineReason: null,
    admitBedKind: null,
    admitRequestedAt: null,
    ...overrides,
  };
}

function arrived(overrides: Partial<EmergencyCaseView> = {}): EmergencyCaseView {
  return inbound({ state: 'arrived', arrivedAt: at(-1), tokenLabel: 'ER-3', ...overrides });
}

describe('the lifecycle (APP_FLOW.md B4)', () => {
  const allowed = (state: EmergencyState, action: EmergencyAction): boolean =>
    canActOn(inbound({ state }), action, {
      reason: 'বার্ন ইউনিট পূর্ণ',
      triage: 'red',
      bedKind: 'burn',
    }).ok;

  it('lets an alert be acknowledged, accepted, declined or called off — and nothing else', () => {
    expect(allowed('inbound', 'acknowledge')).toBe(true);
    expect(allowed('inbound', 'accept')).toBe(true);
    expect(allowed('inbound', 'decline')).toBe(true);
    expect(allowed('inbound', 'cancel')).toBe(true);
    expect(allowed('inbound', 'triage')).toBe(false);
    expect(allowed('inbound', 'handoff')).toBe(false);
    expect(allowed('inbound', 'discharge')).toBe(false);
  });

  it('acknowledges once, and still accepts or declines afterwards', () => {
    expect(allowed('acknowledged', 'acknowledge')).toBe(false);
    expect(allowed('acknowledged', 'accept')).toBe(true);
    expect(allowed('acknowledged', 'decline')).toBe(true);
  });

  it('triages, hands off and discharges only somebody in the ER (FR-EMG-03)', () => {
    for (const action of ['triage', 'handoff', 'discharge'] as const) {
      expect(allowed('arrived', action)).toBe(true);
      expect(allowed('acknowledged', action)).toBe(false);
      expect(allowed('discharged', action)).toBe(false);
    }
  });

  it('never declines somebody who is already here — that is a referral (FR-EMG-07)', () => {
    expect(canActOn(arrived(), 'decline', { reason: 'পূর্ণ' })).toMatchObject({
      ok: false,
      code: 'WRONG_STATE',
    });
  });

  it('requires a reason to decline (FR-EMG-02)', () => {
    expect(canActOn(inbound(), 'decline', { reason: '  ' })).toMatchObject({
      ok: false,
      code: 'REASON_REQUIRED',
    });
  });

  it('lets the ward admit only a case the ER handed over (BTN-B07-ADMIT)', () => {
    expect(canActOn(arrived(), 'admit')).toMatchObject({ ok: false, code: 'NOT_HANDED_OFF' });
    expect(canActOn(arrived({ admitBedKind: 'burn', admitRequestedAt: at(-1) }), 'admit').ok).toBe(
      true,
    );
  });
});

describe('a referral holds the case (FR-EMG-07, the owner’s ruling of 2026-09-22)', () => {
  const held = { openReferral: true, bedKind: 'general' as const };

  it('refuses a handoff, a discharge or an admission while another ER is answering', () => {
    expect(canActOn(arrived(), 'handoff', held)).toMatchObject({
      ok: false,
      code: 'REFERRAL_OPEN',
    });
    expect(canActOn(arrived(), 'discharge', held)).toMatchObject({
      ok: false,
      code: 'REFERRAL_OPEN',
    });
    expect(
      canActOn(arrived({ admitBedKind: 'general', admitRequestedAt: at(-1) }), 'admit', held),
    ).toMatchObject({ ok: false, code: 'REFERRAL_OPEN' });
  });

  it('still triages a held case — the person is still here', () => {
    expect(canActOn(arrived(), 'triage', { openReferral: true, triage: 'red' }).ok).toBe(true);
  });

  it('closes the case as referred when the other ER records the arrival', () => {
    const referred = applyLocalCase(arrived(), { caseId: 'case-1', action: 'refer', at: at(30) });
    expect(referred).toMatchObject({ state: 'referred', closedAt: at(30) });
    expect(alreadyApplied(referred, 'refer')).toBe(true);
    expect(canActOn(inbound(), 'refer').ok).toBe(false);
  });
});

describe('replays from an offline console (FR-OFF-01, SY-02)', () => {
  it('recognises an action whose outcome is already the case', () => {
    expect(alreadyApplied(inbound({ state: 'acknowledged' }), 'acknowledge')).toBe(true);
    expect(alreadyApplied(arrived(), 'accept')).toBe(true);
    expect(alreadyApplied(arrived({ triage: 'red' }), 'triage', { triage: 'red' })).toBe(true);
    expect(alreadyApplied(arrived({ triage: 'red' }), 'triage', { triage: 'yellow' })).toBe(false);
  });

  it('does not mistake a walk-in for an accepted alert', () => {
    expect(alreadyApplied(arrived({ inboundAt: null }), 'accept')).toBe(false);
  });
});

describe("the console's optimistic update", () => {
  it('applies an allowed change and stamps it', () => {
    const next = applyLocalCase(inbound(), { caseId: 'case-1', action: 'acknowledge', at: NOW });
    expect(next).toMatchObject({ state: 'acknowledged', acknowledgedAt: NOW });
  });

  it('closes a declined case with its reason', () => {
    const next = applyLocalCase(inbound(), {
      caseId: 'case-1',
      action: 'decline',
      at: NOW,
      reason: '  বার্ন ইউনিট পূর্ণ ',
    });
    expect(next).toMatchObject({
      state: 'declined',
      declineReason: 'বার্ন ইউনিট পূর্ণ',
      closedAt: NOW,
    });
  });

  it('accepts without inventing a token somebody might call aloud', () => {
    const next = applyLocalCase(inbound(), { caseId: 'case-1', action: 'accept', at: NOW });
    expect(next).toMatchObject({ state: 'arrived', arrivedAt: NOW, tokenLabel: null });
  });

  it('keeps the first handoff time when the kind of bed is changed', () => {
    const first = applyLocalCase(arrived(), {
      caseId: 'case-1',
      action: 'handoff',
      at: at(1),
      bedKind: 'icu',
    });
    const second = applyLocalCase(first, {
      caseId: 'case-1',
      action: 'handoff',
      at: at(4),
      bedKind: 'hdu',
    });
    expect(second).toMatchObject({ admitBedKind: 'hdu', admitRequestedAt: at(1) });
  });

  it('leaves the case alone when the guard refuses', () => {
    const current = inbound();
    expect(
      applyLocalCase(current, { caseId: 'case-1', action: 'triage', at: NOW, triage: 'red' }),
    ).toBe(current);
  });
});

describe('FR-EMG-04: the load is counted, never typed', () => {
  it('counts alerts and people in the ER, and nobody who has left', () => {
    const states: EmergencyState[] = [
      'inbound',
      'acknowledged',
      'arrived',
      'in_treatment',
      'admitted',
      'discharged',
      'declined',
      'cancelled',
      'referred',
    ];
    expect(loadOf(states.map((state) => ({ state })))).toBe(4);
  });
});

describe('TBL-B07-TRIAGE order: "red rows pin to top"', () => {
  it('puts red first, then the untriaged, then yellow and green, longest waiting first', () => {
    const ordered = triageOrder([
      arrived({ id: 'green', triage: 'green', arrivedAt: at(-50) }),
      arrived({ id: 'yellow', triage: 'yellow', arrivedAt: at(-40) }),
      arrived({ id: 'unknown', triage: null, arrivedAt: at(-2) }),
      arrived({ id: 'red-late', triage: 'red', arrivedAt: at(-5) }),
      arrived({ id: 'red-early', triage: 'red', arrivedAt: at(-30) }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      'red-early',
      'red-late',
      'unknown',
      'yellow',
      'green',
    ]);
  });
});

describe('the alert list', () => {
  it('computes when an inbound person is expected, or says it cannot', () => {
    expect(expectedArrival(inbound({ inboundAt: at(-5), inboundEtaMinutes: 20 }))).toBe(at(15));
    expect(expectedArrival(inbound({ inboundEtaMinutes: null }))).toBeNull();
  });

  it('puts unanswered alerts first, then whoever arrives soonest', () => {
    const ordered = inboundOrder([
      inbound({ id: 'answered-soon', state: 'acknowledged', inboundEtaMinutes: 1 }),
      inbound({ id: 'no-eta', inboundEtaMinutes: null }),
      inbound({ id: 'late', inboundEtaMinutes: 40 }),
      inbound({ id: 'soon', inboundEtaMinutes: 8 }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['soon', 'late', 'no-eta', 'answered-soon']);
  });
});

describe('tokens called aloud', () => {
  it("numbers from today's arrivals and skips a label an open case still answers to", () => {
    expect(nextTokenLabel(0, new Set())).toBe('ER-1');
    expect(nextTokenLabel(6, new Set(['ER-7', 'ER-8']))).toBe('ER-9');
  });
});
