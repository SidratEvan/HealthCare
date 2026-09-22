/**
 * The ER case state machine (`FR-EMG-01..04`, `APP_FLOW.md` B4, A6).
 *
 * One definition of what may happen to an emergency case, used by the API as
 * its guard and by the ER console to apply an action before the server has
 * answered — the arrangement the queue reducer and the bed board already have,
 * for the same reason (`FR-QUE-05`): a console that shows a case as accepted
 * and a server that refused it are two truths about one person.
 *
 * No I/O.
 *
 * ## The lifecycle
 *
 *   inbound ─acknowledge→ acknowledged           (BTN-B07-PREPARE: "হাসপাতাল প্রস্তুত")
 *      │                     │
 *      ├──────accept─────────┴→ arrived           (BTN-B07-ACCEPT: here, given a token)
 *      ├──────decline────────┬→ declined          (BTN-B07-DECLINE, with a reason)
 *      └──────cancel─────────┴→ cancelled         (BTN-A10C-CANCEL, the family)
 *
 *   arrived ─triage→ arrived                      (BTN-B07-TRIAGE-<c>, any number of times)
 *      ├─handoff→ arrived, waiting for a bed      (BTN-B07-ADMIT)
 *      │             └─admit→ admitted            (the ward places them, S-B-06)
 *      └─discharge→ discharged                    (seen and sent home)
 *
 * A walk-in starts at `arrived`. `in_treatment` and `referred` exist in the
 * enum; nothing in this version moves a case into them — referral is step 16,
 * and nothing in `APP_FLOW.md` B4 separates "being seen" from "here".
 *
 * ## "Accept" means the person is here
 *
 * `BTN-B07-ACCEPT` "creates an ER case record": the row already exists as an
 * alert, so what accepting creates is the *case* — a token called aloud, a
 * place on the triage list (`TBL-B07-TRIAGE`), an arrival time. Somebody is
 * accepted when they walk in, not while they are still in a car; "we are
 * ready for you" is `acknowledge`.
 *
 * ## Replays
 *
 * The ER console queues actions offline (`FR-OFF-01`), and an ER case has no
 * event log of its own to deduplicate against. So an action whose outcome is
 * already the case's state is a replay (`alreadyApplied`), answered as a
 * success without writing — acknowledging an acknowledged case, triaging red a
 * case that is red. Anything else the guard refuses is refused.
 */

import { addMinutes, toEpochMs } from '../util/time.js';

import type {
  BedKind,
  EmergencyProblem,
  EmergencyState,
  Sex,
  TriageColor,
} from '../types/enums.js';
import type { Timestamp } from '../types/ids.js';

/** The states a case counts towards the ER's load in (`FR-EMG-04`). */
export const OPEN_EMERGENCY_STATES = [
  'inbound',
  'acknowledged',
  'arrived',
  'in_treatment',
] as const;

/** Before arrival: the alert half of the console (`CARD-B07-<caseId>`). */
export const ON_THE_WAY_STATES = ['inbound', 'acknowledged'] as const;

/** In the ER: the triage half (`TBL-B07-TRIAGE`). */
export const IN_ER_STATES = ['arrived', 'in_treatment'] as const;

/** What a console, the family or the ward can do to a case. */
export const EMERGENCY_ACTIONS = [
  'acknowledge',
  'accept',
  'decline',
  'cancel',
  'triage',
  'handoff',
  'discharge',
  'admit',
] as const;
export type EmergencyAction = (typeof EMERGENCY_ACTIONS)[number];

/** A case as the ER console shows it. `contactPhone` is staff-only. */
export interface EmergencyCaseView {
  readonly id: string;
  readonly hospitalId: string;
  readonly state: EmergencyState;
  readonly problem: EmergencyProblem;
  readonly triage: TriageColor | null;
  readonly tokenLabel: string | null;
  readonly ageYears: number | null;
  readonly sex: Sex | null;
  readonly contactPhone: string | null;
  readonly inboundAt: Timestamp | null;
  readonly inboundEtaMinutes: number | null;
  readonly acknowledgedAt: Timestamp | null;
  readonly arrivedAt: Timestamp | null;
  readonly closedAt: Timestamp | null;
  readonly declineReason: string | null;
  readonly admitBedKind: BedKind | null;
  readonly admitRequestedAt: Timestamp | null;
}

export type EmergencyGuardCode = 'WRONG_STATE' | 'REASON_REQUIRED' | 'NOT_HANDED_OFF';

export type EmergencyGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: EmergencyGuardCode; readonly detail: string };

const ALLOWED: EmergencyGuardResult = { ok: true };

function deny(code: EmergencyGuardCode, detail: string): EmergencyGuardResult {
  return { ok: false, code, detail };
}

/** What the caller knows about the action beyond its name. */
export interface EmergencyActionContext {
  readonly reason?: string | null;
  readonly triage?: TriageColor | null;
  readonly bedKind?: BedKind | null;
}

export function isOpen(state: EmergencyState): boolean {
  return (OPEN_EMERGENCY_STATES as readonly EmergencyState[]).includes(state);
}

export function isOnTheWay(state: EmergencyState): boolean {
  return (ON_THE_WAY_STATES as readonly EmergencyState[]).includes(state);
}

export function isInEr(state: EmergencyState): boolean {
  return (IN_ER_STATES as readonly EmergencyState[]).includes(state);
}

/** May this action be taken on this case, now? */
export function canActOn(
  current: EmergencyCaseView,
  action: EmergencyAction,
  context: EmergencyActionContext = {},
): EmergencyGuardResult {
  const { state } = current;

  switch (action) {
    case 'acknowledge':
      return state === 'inbound'
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} case cannot be acknowledged.`);

    case 'accept':
      return isOnTheWay(state)
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} case cannot be accepted.`);

    case 'decline':
      if (!isOnTheWay(state)) {
        // Somebody already in the ER who must go elsewhere is a referral
        // (`FR-EMG-07`, step 16), not a decline.
        return deny('WRONG_STATE', `A ${state} case cannot be declined.`);
      }
      return (context.reason ?? '').trim() === ''
        ? deny('REASON_REQUIRED', 'Say why the case is declined.')
        : ALLOWED;

    case 'cancel':
      return isOnTheWay(state)
        ? ALLOWED
        : deny('WRONG_STATE', `A ${state} case cannot be called off.`);

    case 'triage':
      return isInEr(state)
        ? ALLOWED
        : deny('WRONG_STATE', 'Only somebody in the ER can be triaged.');

    case 'handoff':
      return isInEr(state)
        ? ALLOWED
        : deny('WRONG_STATE', 'Only somebody in the ER can be handed to the ward.');

    case 'discharge':
      return isInEr(state) ? ALLOWED : deny('WRONG_STATE', `A ${state} case cannot be discharged.`);

    case 'admit':
      if (!isInEr(state)) return deny('WRONG_STATE', `A ${state} case cannot be admitted.`);
      return current.admitRequestedAt === null
        ? deny('NOT_HANDED_OFF', 'The ER has not handed this case to the ward.')
        : ALLOWED;
  }
}

/**
 * True when the action's outcome is already the case's state — a replay from
 * an offline outbox, or a second tap on a slow connection.
 */
export function alreadyApplied(
  current: EmergencyCaseView,
  action: EmergencyAction,
  context: EmergencyActionContext = {},
): boolean {
  switch (action) {
    case 'acknowledge':
      return current.state === 'acknowledged';
    case 'accept':
      return current.arrivedAt !== null && current.inboundAt !== null;
    case 'decline':
      return current.state === 'declined';
    case 'cancel':
      return current.state === 'cancelled';
    case 'triage':
      return isInEr(current.state) && current.triage === (context.triage ?? null);
    case 'handoff':
      return isInEr(current.state) && current.admitBedKind === (context.bedKind ?? null);
    case 'discharge':
      return current.state === 'discharged';
    case 'admit':
      return current.state === 'admitted';
  }
}

/** One action as the console applies it before the server answers. */
export interface LocalEmergencyChange {
  readonly caseId: string;
  readonly action: EmergencyAction;
  readonly at: Timestamp;
  readonly reason?: string | null;
  readonly triage?: TriageColor | null;
  readonly bedKind?: BedKind | null;
}

/**
 * The case with one change applied — the console's optimistic update.
 *
 * Unchanged when the guard refuses: a queued action that no longer makes sense
 * renders as nothing rather than as an impossible case, and the outbox rolls
 * it back when the server refuses it too. An accepted case has no token until
 * the server gives it one; the console shows the arrival without inventing a
 * number somebody might call aloud.
 */
export function applyLocalCase(
  current: EmergencyCaseView,
  change: LocalEmergencyChange,
): EmergencyCaseView {
  const context: EmergencyActionContext = {
    reason: change.reason ?? null,
    triage: change.triage ?? null,
    bedKind: change.bedKind ?? null,
  };
  if (!canActOn(current, change.action, context).ok) return current;

  switch (change.action) {
    case 'acknowledge':
      return { ...current, state: 'acknowledged', acknowledgedAt: change.at };
    case 'accept':
      return { ...current, state: 'arrived', arrivedAt: change.at };
    case 'decline':
      return {
        ...current,
        state: 'declined',
        declineReason: (change.reason ?? '').trim(),
        closedAt: change.at,
      };
    case 'cancel':
      return { ...current, state: 'cancelled', closedAt: change.at };
    case 'triage':
      return { ...current, triage: change.triage ?? null };
    case 'handoff':
      return {
        ...current,
        admitBedKind: change.bedKind ?? null,
        admitRequestedAt: current.admitRequestedAt ?? change.at,
      };
    case 'discharge':
      return { ...current, state: 'discharged', closedAt: change.at };
    case 'admit':
      return { ...current, state: 'admitted', closedAt: change.at };
  }
}

/** `FR-EMG-04`: the load is counted from cases, never typed. */
export function loadOf(cases: readonly Pick<EmergencyCaseView, 'state'>[]): number {
  return cases.filter((entry) => isOpen(entry.state)).length;
}

/**
 * The triage list's order (`TBL-B07-TRIAGE`): "red rows pin to top".
 *
 * Then the untriaged, ahead of yellow and green — somebody nobody has assessed
 * yet could be red, and "unknown" sorting last would hide them at the bottom
 * of a busy list. Within a colour, whoever has waited longest first.
 */
export function triageOrder<T extends Pick<EmergencyCaseView, 'triage' | 'arrivedAt' | 'id'>>(
  cases: readonly T[],
): T[] {
  const weight = (triage: TriageColor | null): number =>
    triage === 'red' ? 0 : triage === null ? 1 : triage === 'yellow' ? 2 : 3;

  return [...cases].sort(
    (a, b) =>
      weight(a.triage) - weight(b.triage) ||
      stamp(a.arrivedAt) - stamp(b.arrivedAt) ||
      (a.id < b.id ? -1 : 1),
  );
}

/**
 * When an inbound person is expected at the door, or null when their phone
 * could not estimate it.
 */
export function expectedArrival(
  current: Pick<EmergencyCaseView, 'inboundAt' | 'inboundEtaMinutes'>,
): Timestamp | null {
  if (current.inboundAt === null || current.inboundEtaMinutes === null) return null;
  return addMinutes(current.inboundAt, current.inboundEtaMinutes);
}

/**
 * The alert list's order: unanswered alerts first, then by who arrives first.
 * An alert with no ETA sorts after those with one, in the order it came in.
 */
export function inboundOrder<
  T extends Pick<EmergencyCaseView, 'state' | 'inboundAt' | 'inboundEtaMinutes' | 'id'>,
>(cases: readonly T[]): T[] {
  return [...cases].sort((a, b) => {
    const answered = Number(a.state !== 'inbound') - Number(b.state !== 'inbound');
    if (answered !== 0) return answered;
    const arrivalA = expectedArrival(a);
    const arrivalB = expectedArrival(b);
    if (arrivalA !== null && arrivalB !== null && arrivalA !== arrivalB) {
      return toEpochMs(arrivalA) - toEpochMs(arrivalB);
    }
    if (arrivalA === null && arrivalB !== null) return 1;
    if (arrivalB === null && arrivalA !== null) return -1;
    return stamp(a.inboundAt) - stamp(b.inboundAt) || (a.id < b.id ? -1 : 1);
  });
}

/**
 * The next token an ER can call aloud: `ER-<n>`.
 *
 * `n` starts one past today's arrivals at this hospital and skips any label an
 * open case still answers to — yesterday's `ER-7` may still be on a trolley
 * when today's seventh arrival walks in. The database's
 * `emergency_cases_open_token_key` is the backstop; this is how it is never
 * reached.
 */
export function nextTokenLabel(arrivedToday: number, openLabels: ReadonlySet<string>): string {
  let n = arrivedToday + 1;
  while (openLabels.has(tokenLabel(n))) n += 1;
  return tokenLabel(n);
}

export function tokenLabel(n: number): string {
  return `ER-${String(n)}`;
}

function stamp(value: Timestamp | null): number {
  return value === null ? Number.POSITIVE_INFINITY : toEpochMs(value);
}
