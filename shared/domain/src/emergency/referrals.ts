/**
 * The referral state machine (`FR-EMG-07..09`, `APP_FLOW.md` B4).
 *
 * One definition of what may happen to a referral, used by the API as its
 * guard and by both ER consoles to apply an action before the server has
 * answered — the arrangement `cases.ts` has for a case, for the same reason.
 *
 * No I/O.
 *
 * ## The lifecycle, and whose tap each step is
 *
 *   sent ─seen→ seen                          (receiver touched the card in LIST-B07-IN)
 *     │          │
 *     ├──accept──┴→ accepted ─arrive→ arrived  (receiver: BTN-B07-IN-ACCEPT, -ARRIVED)
 *     ├──decline─┬→ declined                   (receiver, with a reason: BTN-B07-IN-DECLINE)
 *     └──cancel──┴──────────┴→ cancelled       (sender, before arrival: BTN-B07-REFER-CANCEL)
 *
 * `FR-EMG-08`'s timeline is these stamps: sent, seen, accepted, arrived. An
 * answer given before anybody touched the card stamps `seen` with it — the
 * timeline never says a hospital accepted a referral it had not seen.
 *
 * ## Two hospitals, one referral
 *
 * Every action belongs to one side. The receiving ER sees, answers and
 * records the arrival; the sending ER can only withdraw. A console acting on
 * the other side's step is refused (`WRONG_SIDE`), whatever its role.
 *
 * ## Who holds the person
 *
 * The owner's ruling (2026-09-22): the sending ER keeps the case until the
 * receiving ER records the arrival. So `arrive` is the moment two things
 * happen at once — the receiving ER gives the person a token, and the sending
 * ER's case closes as `referred` (`cases.ts`). Until then the case is on the
 * sender's triage list, counted in its load, and held: it cannot be handed to
 * the ward or discharged while a referral of it is open.
 *
 * ## Replays
 *
 * As with a case: an action whose outcome is already the referral's state is
 * a replay from an offline outbox (`referralAlreadyApplied`), answered as a
 * success without writing.
 */

import { toEpochMs } from '../util/time.js';

import { isInEr, type EmergencyCaseView, type EmergencyGuardResult } from './cases.js';
import { needFor, type EmergencyNeed } from './ranking.js';

import type {
  BedKind,
  CapabilityKind,
  EmergencyProblem,
  ReferralState,
  Sex,
  TriageColor,
} from '../types/enums.js';
import type { Timestamp } from '../types/ids.js';

/** The states somebody is still waiting on. */
export const OPEN_REFERRAL_STATES = ['sent', 'seen', 'accepted'] as const;

/** What a console can do to a referral once it exists. */
export const REFERRAL_ACTIONS = ['seen', 'accept', 'decline', 'cancel', 'arrive'] as const;
export type ReferralAction = (typeof REFERRAL_ACTIONS)[number];

/** Which of the two hospitals a console is, for this referral. */
export type ReferralSide = 'sender' | 'receiver';

/** The longest note a referral carries. A summary, not a case file. */
export const REFERRAL_NOTE_MAX = 500;

/** Which side takes each step. */
const SIDE_OF_ACTION: Readonly<Record<ReferralAction, ReferralSide>> = {
  seen: 'receiver',
  accept: 'receiver',
  decline: 'receiver',
  arrive: 'receiver',
  cancel: 'sender',
};

/**
 * What the receiving ER is told (`FR-EMG-08`, "sends patient summary").
 *
 * The case as the sending ER holds it — problem, colour, age and sex — and a
 * short note. No name and no number: it is read by a second hospital, and the
 * case itself names nobody (`DB-P7`).
 */
export interface ReferralSummary {
  readonly problem: EmergencyProblem;
  readonly triage: TriageColor | null;
  readonly ageYears: number | null;
  readonly sex: Sex | null;
  readonly note: string | null;
}

/** One end of a referral: a facility and the number its ER answers. */
export interface ReferralParty {
  readonly hospitalId: string;
  readonly nameBn: string;
  readonly nameEn: string;
  /** The ER desk's line, so either side can pick up the phone. */
  readonly phone: string | null;
}

/** A referral as both consoles show it. Names nobody. */
export interface ReferralView {
  readonly id: string;
  readonly from: ReferralParty;
  readonly to: ReferralParty;
  /** The sending ER's case, and the token it calls them by. */
  readonly emergencyCaseId: string | null;
  readonly fromTokenLabel: string | null;
  /** The case the receiving ER opened on arrival, and its token. */
  readonly arrivedCaseId: string | null;
  readonly arrivedTokenLabel: string | null;
  readonly requiredCapability: CapabilityKind | null;
  readonly requiredBedKind: BedKind | null;
  readonly summary: ReferralSummary;
  readonly state: ReferralState;
  readonly sentAt: Timestamp;
  readonly seenAt: Timestamp | null;
  readonly respondedAt: Timestamp | null;
  readonly arrivedAt: Timestamp | null;
  readonly closedAt: Timestamp | null;
  readonly declineReason: string | null;
}

export type ReferralGuardCode = 'WRONG_STATE' | 'WRONG_SIDE' | 'REASON_REQUIRED';

export type ReferralGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: ReferralGuardCode; readonly detail: string };

const ALLOWED = { ok: true } as const;

function deny(code: ReferralGuardCode, detail: string): ReferralGuardResult {
  return { ok: false, code, detail };
}

export function isOpenReferral(state: ReferralState): boolean {
  return (OPEN_REFERRAL_STATES as readonly ReferralState[]).includes(state);
}

/** Which side this hospital is, or null when it is neither. */
export function sideOf(
  referral: Pick<ReferralView, 'from' | 'to'>,
  hospitalId: string,
): ReferralSide | null {
  if (referral.from.hospitalId === hospitalId) return 'sender';
  if (referral.to.hospitalId === hospitalId) return 'receiver';
  return null;
}

/** May this side take this step, now? */
export function canActOnReferral(
  current: Pick<ReferralView, 'state'>,
  action: ReferralAction,
  side: ReferralSide,
  context: { readonly reason?: string | null } = {},
): ReferralGuardResult {
  if (SIDE_OF_ACTION[action] !== side) {
    return deny(
      'WRONG_SIDE',
      action === 'cancel'
        ? 'Only the ER that sent a referral can withdraw it.'
        : 'Only the ER a referral was sent to can answer it.',
    );
  }

  const { state } = current;
  switch (action) {
    case 'seen':
      return state === 'sent'
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} referral cannot be marked seen.`);

    case 'accept':
      return state === 'sent' || state === 'seen'
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} referral cannot be accepted.`);

    case 'decline':
      if (state !== 'sent' && state !== 'seen') {
        return deny('WRONG_STATE', `A ${state} referral cannot be declined.`);
      }
      return (context.reason ?? '').trim() === ''
        ? deny('REASON_REQUIRED', 'Say why the referral is declined.')
        : ALLOWED;

    case 'cancel':
      return isOpenReferral(state)
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} referral cannot be withdrawn.`);

    case 'arrive':
      return state === 'accepted'
        ? ALLOWED
        : deny('WRONG_STATE', 'Only an accepted referral can arrive.');
  }
}

/**
 * True when the action's outcome is already the referral's — a replay from an
 * offline outbox, or a second tap on a slow connection.
 */
export function referralAlreadyApplied(
  current: Pick<ReferralView, 'state' | 'seenAt'>,
  action: ReferralAction,
): boolean {
  switch (action) {
    case 'seen':
      return current.seenAt !== null;
    case 'accept':
      return current.state === 'accepted' || current.state === 'arrived';
    case 'decline':
      return current.state === 'declined';
    case 'cancel':
      return current.state === 'cancelled';
    case 'arrive':
      return current.state === 'arrived';
  }
}

/** One action as a console applies it before the server answers. */
export interface LocalReferralChange {
  readonly referralId: string;
  readonly action: ReferralAction;
  readonly at: Timestamp;
  readonly reason?: string | null;
}

/**
 * The referral with one change applied — a console's optimistic update.
 *
 * Unchanged when the guard refuses, as `applyLocalCase` is. An arrival has no
 * receiving case or token until the server makes them; the console shows the
 * arrival without inventing a token somebody might call aloud.
 */
export function applyLocalReferral(
  current: ReferralView,
  change: LocalReferralChange,
  side: ReferralSide,
): ReferralView {
  if (!canActOnReferral(current, change.action, side, { reason: change.reason ?? null }).ok) {
    return current;
  }

  const seenAt = current.seenAt ?? change.at;
  switch (change.action) {
    case 'seen':
      return { ...current, state: 'seen', seenAt };
    case 'accept':
      return { ...current, state: 'accepted', seenAt, respondedAt: change.at };
    case 'decline':
      return {
        ...current,
        state: 'declined',
        seenAt,
        respondedAt: change.at,
        closedAt: change.at,
        declineReason: (change.reason ?? '').trim(),
      };
    case 'cancel':
      return { ...current, state: 'cancelled', closedAt: change.at };
    case 'arrive':
      return { ...current, state: 'arrived', arrivedAt: change.at, closedAt: change.at };
  }
}

/** A step of `FR-EMG-08`'s timeline. */
export type ReferralStep = 'sent' | 'seen' | 'accepted' | 'declined' | 'arrived' | 'cancelled';

/**
 * The timeline as it happened, oldest first: sent, seen, then the answer, then
 * the arrival — or the withdrawal wherever it came. Only steps that happened.
 */
export function referralTimeline(
  referral: Pick<
    ReferralView,
    'state' | 'sentAt' | 'seenAt' | 'respondedAt' | 'arrivedAt' | 'closedAt'
  >,
): readonly { readonly step: ReferralStep; readonly at: Timestamp }[] {
  const steps: { step: ReferralStep; at: Timestamp }[] = [{ step: 'sent', at: referral.sentAt }];
  if (referral.seenAt !== null) steps.push({ step: 'seen', at: referral.seenAt });
  if (referral.respondedAt !== null) {
    steps.push({
      step: referral.state === 'declined' ? 'declined' : 'accepted',
      at: referral.respondedAt,
    });
  }
  if (referral.arrivedAt !== null) steps.push({ step: 'arrived', at: referral.arrivedAt });
  if (referral.state === 'cancelled' && referral.closedAt !== null) {
    steps.push({ step: 'cancelled', at: referral.closedAt });
  }
  return steps;
}

/**
 * May this case be referred now (`FR-EMG-07`)?
 *
 * Only somebody in the ER: before arrival, "we cannot take you" is a decline
 * (`FR-EMG-02`), and the family is told so — the owner's ruling of 2026-09-22
 * keeps referral for people who are here. And one open referral at a time:
 * two ERs both getting ready for somebody who can only go to one of them is a
 * bay held for nobody (`referrals_one_open_per_case`).
 */
export function canRefer(
  current: Pick<EmergencyCaseView, 'state'>,
  openReferral: boolean,
): EmergencyGuardResult {
  if (!isInEr(current.state)) {
    return {
      ok: false,
      code: 'WRONG_STATE',
      detail: 'Only somebody in the ER can be referred.',
    };
  }
  return openReferral
    ? {
        ok: false,
        code: 'REFERRAL_OPEN',
        detail: 'This case already has a referral waiting. Withdraw it first.',
      }
    : { ok: true };
}

/**
 * What a referral asks for when the coordinator has not said: the problem's
 * own need. Null on both sides for a problem that maps to nothing — the
 * coordinator chooses then, because a guess at what a breathless child needs
 * is not the console's to make.
 */
export function defaultNeed(problem: EmergencyProblem): EmergencyNeed {
  return needFor(problem);
}

/** A referral asks for something (`referrals_asks_for_something`). */
export function asksForSomething(need: EmergencyNeed): boolean {
  return need.capability !== null || need.bedKind !== null;
}

/**
 * `FR-EMG-07`: "search other hospitals filtered by required capability and
 * free beds". What is left out is counted, so the sheet can say how many ERs
 * were passed over and why, rather than presenting a short list as all there
 * is.
 *
 * - A facility known **not** to have the capability is out.
 * - A facility with no free bed of the kind asked for is out — no such beds at
 *   all (`freeBeds` null) or none free (zero).
 *
 * A stale figure is not excluded for being stale: it stays, ranked lower and
 * labelled with its age (`FR-PAT-45`), because "nobody has confirmed it" is
 * not "it is full".
 */
export function referralCandidates<
  T extends { readonly hasCapability: boolean | null; readonly freeBeds: number | null },
>(
  results: readonly T[],
): {
  readonly candidates: readonly T[];
  readonly withoutCapability: number;
  readonly withoutBeds: number;
} {
  let withoutCapability = 0;
  let withoutBeds = 0;
  const candidates: T[] = [];
  for (const result of results) {
    if (result.hasCapability === false) {
      withoutCapability += 1;
    } else if (result.freeBeds === null || result.freeBeds <= 0) {
      withoutBeds += 1;
    } else {
      candidates.push(result);
    }
  }
  return { candidates, withoutCapability, withoutBeds };
}

/**
 * The incoming list's order (`LIST-B07-IN`): unanswered first, oldest first —
 * somebody has been waiting longest in another ER — then accepted ones by
 * when they were accepted.
 */
export function incomingOrder<T extends Pick<ReferralView, 'state' | 'sentAt' | 'id'>>(
  referrals: readonly T[],
): T[] {
  return [...referrals].sort((a, b) => {
    const answered = Number(a.state === 'accepted') - Number(b.state === 'accepted');
    if (answered !== 0) return answered;
    return toEpochMs(a.sentAt) - toEpochMs(b.sentAt) || (a.id < b.id ? -1 : 1);
  });
}
