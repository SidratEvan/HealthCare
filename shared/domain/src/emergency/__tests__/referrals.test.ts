import { describe, expect, it } from 'vitest';

import {
  applyLocalReferral,
  asksForSomething,
  canActOnReferral,
  canRefer,
  defaultNeed,
  incomingOrder,
  isOpenReferral,
  referralAlreadyApplied,
  referralCandidates,
  referralTimeline,
  sideOf,
  REFERRAL_ACTIONS,
  type ReferralAction,
  type ReferralSide,
  type ReferralView,
} from '../referrals.js';

import type { ReferralState } from '../../types/enums.js';
import type { Timestamp } from '../../types/ids.js';

const NOW = '2026-09-22T10:00:00.000Z' as Timestamp;
const at = (minutes: number): Timestamp =>
  new Date(Date.parse(NOW) + minutes * 60_000).toISOString() as Timestamp;

const JAMUNA = 'hospital-jamuna';
const SHAPLA = 'hospital-shapla';

function sent(overrides: Partial<ReferralView> = {}): ReferralView {
  return {
    id: 'referral-1',
    from: { hospitalId: JAMUNA, nameBn: 'যমুনা', nameEn: 'Jamuna', phone: null },
    to: { hospitalId: SHAPLA, nameBn: 'শাপলা', nameEn: 'Shapla', phone: null },
    emergencyCaseId: 'case-1',
    fromTokenLabel: 'ER-4',
    arrivedCaseId: null,
    arrivedTokenLabel: null,
    requiredCapability: 'cardiac',
    requiredBedKind: null,
    summary: { problem: 'cardiac', triage: 'red', ageYears: 58, sex: 'male', note: null },
    state: 'sent',
    sentAt: at(-10),
    seenAt: null,
    respondedAt: null,
    arrivedAt: null,
    closedAt: null,
    declineReason: null,
    ...overrides,
  };
}

const SIDE: Record<ReferralAction, ReferralSide> = {
  seen: 'receiver',
  accept: 'receiver',
  decline: 'receiver',
  arrive: 'receiver',
  cancel: 'sender',
};

describe('the lifecycle (FR-EMG-08)', () => {
  const allowed = (state: ReferralState, action: ReferralAction): boolean =>
    canActOnReferral({ state }, action, SIDE[action], { reason: 'বার্ন ইউনিট পূর্ণ' }).ok;

  it('lets a new referral be seen, accepted, declined or withdrawn — not arrive', () => {
    expect(allowed('sent', 'seen')).toBe(true);
    expect(allowed('sent', 'accept')).toBe(true);
    expect(allowed('sent', 'decline')).toBe(true);
    expect(allowed('sent', 'cancel')).toBe(true);
    expect(allowed('sent', 'arrive')).toBe(false);
  });

  it('answers a seen referral, but does not see it twice', () => {
    expect(allowed('seen', 'seen')).toBe(false);
    expect(allowed('seen', 'accept')).toBe(true);
    expect(allowed('seen', 'decline')).toBe(true);
    expect(allowed('seen', 'cancel')).toBe(true);
    expect(allowed('seen', 'arrive')).toBe(false);
  });

  it('after acceptance allows only the arrival, or the sender withdrawing', () => {
    expect(allowed('accepted', 'arrive')).toBe(true);
    expect(allowed('accepted', 'cancel')).toBe(true);
    expect(allowed('accepted', 'decline')).toBe(false);
    expect(allowed('accepted', 'accept')).toBe(false);
  });

  it('lets nothing happen to a referral that is over', () => {
    for (const state of ['declined', 'arrived', 'cancelled'] as const) {
      for (const action of REFERRAL_ACTIONS) {
        expect(allowed(state, action), `${state} → ${action}`).toBe(false);
      }
      expect(isOpenReferral(state)).toBe(false);
    }
    for (const state of ['sent', 'seen', 'accepted'] as const) {
      expect(isOpenReferral(state)).toBe(true);
    }
  });

  it('needs a reason to decline (BACKEND.md §7.5)', () => {
    const blank = canActOnReferral({ state: 'seen' }, 'decline', 'receiver', { reason: '   ' });
    expect(blank).toMatchObject({ ok: false, code: 'REASON_REQUIRED' });
  });
});

describe('two hospitals, one referral', () => {
  it('lets only the receiving ER see, answer and record arrival', () => {
    for (const action of ['seen', 'accept', 'decline', 'arrive'] as const) {
      const verdict = canActOnReferral({ state: 'accepted' }, action, 'sender', {
        reason: 'x',
      });
      expect(verdict).toMatchObject({ ok: false, code: 'WRONG_SIDE' });
    }
  });

  it('lets only the sending ER withdraw', () => {
    expect(canActOnReferral({ state: 'sent' }, 'cancel', 'receiver')).toMatchObject({
      ok: false,
      code: 'WRONG_SIDE',
    });
    expect(canActOnReferral({ state: 'sent' }, 'cancel', 'sender').ok).toBe(true);
  });

  it('knows which side a hospital is, and when it is neither', () => {
    expect(sideOf(sent(), JAMUNA)).toBe('sender');
    expect(sideOf(sent(), SHAPLA)).toBe('receiver');
    expect(sideOf(sent(), 'hospital-padma')).toBeNull();
  });
});

describe('replays (FR-OFF-01)', () => {
  it('recognises an action whose outcome is already the referral', () => {
    expect(referralAlreadyApplied(sent({ state: 'seen', seenAt: at(-5) }), 'seen')).toBe(true);
    expect(referralAlreadyApplied(sent({ state: 'accepted', seenAt: at(-5) }), 'seen')).toBe(true);
    expect(referralAlreadyApplied(sent({ state: 'accepted' }), 'accept')).toBe(true);
    // An accepted referral that has since arrived was accepted.
    expect(referralAlreadyApplied(sent({ state: 'arrived' }), 'accept')).toBe(true);
    expect(referralAlreadyApplied(sent({ state: 'declined' }), 'decline')).toBe(true);
    expect(referralAlreadyApplied(sent({ state: 'cancelled' }), 'cancel')).toBe(true);
    expect(referralAlreadyApplied(sent({ state: 'arrived' }), 'arrive')).toBe(true);
  });

  it('does not mistake a different outcome for a replay', () => {
    expect(referralAlreadyApplied(sent(), 'seen')).toBe(false);
    expect(referralAlreadyApplied(sent({ state: 'declined' }), 'accept')).toBe(false);
    expect(referralAlreadyApplied(sent({ state: 'cancelled' }), 'arrive')).toBe(false);
  });
});

describe('the optimistic update (applyLocalReferral)', () => {
  it('stamps seen with an answer nobody saw first — the timeline never skips it', () => {
    const accepted = applyLocalReferral(
      sent(),
      { referralId: 'referral-1', action: 'accept', at: at(0) },
      'receiver',
    );
    expect(accepted).toMatchObject({ state: 'accepted', seenAt: at(0), respondedAt: at(0) });
  });

  it('keeps the first seen stamp when the answer comes later', () => {
    const declined = applyLocalReferral(
      sent({ state: 'seen', seenAt: at(-4) }),
      { referralId: 'referral-1', action: 'decline', at: at(0), reason: '  শয্যা নেই ' },
      'receiver',
    );
    expect(declined).toMatchObject({
      state: 'declined',
      seenAt: at(-4),
      respondedAt: at(0),
      closedAt: at(0),
      declineReason: 'শয্যা নেই',
    });
  });

  it('records the arrival without inventing a token', () => {
    const arrived = applyLocalReferral(
      sent({ state: 'accepted', seenAt: at(-5), respondedAt: at(-4) }),
      { referralId: 'referral-1', action: 'arrive', at: at(0) },
      'receiver',
    );
    expect(arrived).toMatchObject({ state: 'arrived', arrivedAt: at(0), closedAt: at(0) });
    expect(arrived.arrivedTokenLabel).toBeNull();
  });

  it('leaves the referral alone when the guard refuses', () => {
    const before = sent();
    expect(
      applyLocalReferral(
        before,
        { referralId: 'referral-1', action: 'arrive', at: at(0) },
        'receiver',
      ),
    ).toBe(before);
    expect(
      applyLocalReferral(
        before,
        { referralId: 'referral-1', action: 'accept', at: at(0) },
        'sender',
      ),
    ).toBe(before);
  });
});

describe('the timeline (FR-EMG-08)', () => {
  it('lists sent, seen, accepted and arrived in order', () => {
    const steps = referralTimeline(
      sent({
        state: 'arrived',
        seenAt: at(-8),
        respondedAt: at(-6),
        arrivedAt: at(30),
        closedAt: at(30),
      }),
    );
    expect(steps.map((step) => step.step)).toEqual(['sent', 'seen', 'accepted', 'arrived']);
  });

  it('shows a decline as a decline, and a withdrawal where it happened', () => {
    expect(
      referralTimeline(
        sent({ state: 'declined', seenAt: at(-8), respondedAt: at(-6), closedAt: at(-6) }),
      ).map((step) => step.step),
    ).toEqual(['sent', 'seen', 'declined']);

    expect(
      referralTimeline(
        sent({ state: 'cancelled', seenAt: at(-8), respondedAt: at(-6), closedAt: at(-2) }),
      ).map((step) => step.step),
    ).toEqual(['sent', 'seen', 'accepted', 'cancelled']);
  });
});

describe('who can be referred (the owner’s ruling, 2026-09-22)', () => {
  it('refers only somebody in the ER', () => {
    expect(canRefer({ state: 'arrived' }, false).ok).toBe(true);
    for (const state of ['inbound', 'acknowledged', 'discharged', 'declined'] as const) {
      expect(canRefer({ state }, false)).toMatchObject({ ok: false, code: 'WRONG_STATE' });
    }
  });

  it('asks one hospital at a time', () => {
    expect(canRefer({ state: 'arrived' }, true)).toMatchObject({
      ok: false,
      code: 'REFERRAL_OPEN',
    });
  });
});

describe('what a referral asks for', () => {
  it('defaults to the problem’s own need', () => {
    expect(defaultNeed('burn')).toEqual({ capability: 'burn_unit', bedKind: 'burn' });
    expect(defaultNeed('cardiac')).toEqual({ capability: 'cardiac', bedKind: null });
  });

  it('leaves the choice to the coordinator when the problem maps to nothing', () => {
    const need = defaultNeed('breathing');
    expect(need).toEqual({ capability: null, bedKind: null });
    expect(asksForSomething(need)).toBe(false);
    expect(asksForSomething({ capability: null, bedKind: 'icu' })).toBe(true);
  });
});

describe('the refer-out list (FR-EMG-07)', () => {
  it('keeps only ERs with the capability and a free bed, and counts the rest', () => {
    const results = [
      { id: 'a', hasCapability: true, freeBeds: 2 },
      { id: 'b', hasCapability: false, freeBeds: 5 },
      { id: 'c', hasCapability: true, freeBeds: 0 },
      { id: 'd', hasCapability: null, freeBeds: null },
      { id: 'e', hasCapability: null, freeBeds: 1 },
    ];
    const { candidates, withoutCapability, withoutBeds } = referralCandidates(results);
    expect(candidates.map((entry) => entry.id)).toEqual(['a', 'e']);
    expect(withoutCapability).toBe(1);
    expect(withoutBeds).toBe(2);
  });
});

describe('the incoming list’s order (LIST-B07-IN)', () => {
  it('puts unanswered referrals first, longest waiting first', () => {
    const ordered = incomingOrder([
      sent({ id: 'accepted-early', state: 'accepted', sentAt: at(-30) }),
      sent({ id: 'new', state: 'sent', sentAt: at(-1) }),
      sent({ id: 'waiting', state: 'seen', sentAt: at(-12) }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(['waiting', 'new', 'accepted-early']);
  });
});
