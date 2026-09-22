/**
 * The bed state machine (`FR-BED-01`, `FR-BED-02`, `APP_FLOW.md` B3).
 *
 * One definition of what a ward console may do to a bed, used by the API as
 * its guard and by the console to apply an action before the server has
 * answered. It is the same arrangement as the queue reducer and for the same
 * reason: a console that shows a bed as occupied and a server that refuses the
 * admit are two sources of truth about one bed, and the ward nurse will
 * believe whichever is in front of her (`FR-QUE-05`, applied to beds).
 *
 * No I/O. A bed is a value in, a decision or a new value out.
 *
 * ## The five states and what moves between them
 *
 *   free ─admit→ occupied ─discharge→ cleaning ─clean_done→ free
 *     │            │
 *     │            └─transfer→ (this bed: cleaning, the target: occupied)
 *     ├─reserve→ reserved ─release→ free        (or ─admit→ occupied)
 *     ├─clean_start→ cleaning
 *     └─oos→ out_of_service ─restore→ free
 *
 * A discharged bed goes to *cleaning*, never straight to free
 * (`BTN-B06-DISCHARGE`: "bed enters cleaning state with a timer → then free").
 * The "then free" is a person tapping `clean_done`, not the timer running out:
 * a bed that frees itself after twenty minutes is a free bed published without
 * anybody having looked at it, which is the invented availability `PRD.md`
 * §3.2 forbids. The timer is shown so the ward can see a bed that has been
 * "being cleaned" for three hours.
 *
 * ## A lapsed hold is free
 *
 * A reservation past its `reservedUntil` counts as free everywhere — here,
 * and in `v_public_hospital_capacity`, which is the same rule in SQL. The
 * logged RELEASE is written by the server the next time the board is read;
 * nothing in the meantime treats the bed as taken.
 */

import { toEpochMs } from '../util/time.js';

import type { BedKind, BedState } from '../types/enums.js';
import type { DhakaDate, Timestamp } from '../types/ids.js';

/** The event types `bed_events.type` allows (migration 0008). */
export const BED_EVENT_TYPES = [
  'ADMIT',
  'DISCHARGE',
  'TRANSFER',
  'RESERVE',
  'RELEASE',
  'CLEAN_START',
  'CLEAN_DONE',
  'OOS',
  'RESTORE',
] as const;
export type BedEventType = (typeof BED_EVENT_TYPES)[number];

/** What a ward console can ask of one bed. Each is one route (BACKEND.md §7.5). */
export const BED_ACTIONS = [
  'admit',
  'discharge',
  'transfer',
  'reserve',
  'release',
  'clean_start',
  'clean_done',
  'oos',
  'restore',
] as const;
export type BedAction = (typeof BED_ACTIONS)[number];

/** Where a stay came from (`admissions.source`). */
export const ADMISSION_SOURCES = ['er', 'opd', 'app_request', 'referral'] as const;
export type AdmissionSource = (typeof ADMISSION_SOURCES)[number];

/**
 * The hold lengths `BTN-B06-RESERVE` offers, in minutes.
 *
 * A short menu rather than a free field: a nurse holding a bed for a family
 * on their way should choose between "half an hour" and "four hours", not type
 * a number, and a hold of three days is a bed quietly removed from the public
 * count.
 */
export const HOLD_MINUTE_CHOICES = [30, 60, 120, 240] as const;
export const MAX_HOLD_MINUTES = 240;

/** One bed as the ward board shows it. Carries no patient identity (`DB-P7`). */
export interface BedView {
  readonly id: string;
  readonly wardId: string;
  readonly label: string;
  readonly kind: BedKind;
  readonly state: BedState;
  readonly nightlyPoisha: number;
  readonly lastCleanedAt: Timestamp | null;
  /** When the current state began: the cleaning timer counts from here. */
  readonly stateChangedAt: Timestamp;
  readonly expectedDischargeDate: DhakaDate | null;
  readonly reservedUntil: Timestamp | null;
  readonly oosReason: string | null;
  readonly admissionId: string | null;
  /** The bed request this bed is held for, when the hold came from one. */
  readonly heldForRequestId: string | null;
}

/** One ward, as a tab on the board (`TAB-B06-<ward>`). */
export interface WardView {
  readonly id: string;
  readonly nameBn: string;
  readonly nameEn: string;
  readonly floor: number;
  readonly kind: BedKind;
}

export type BedGuardCode =
  | 'WRONG_STATE'
  | 'HELD_FOR_SOMEONE_ELSE'
  | 'REASON_REQUIRED'
  | 'HOLD_OUT_OF_RANGE'
  | 'SAME_BED'
  | 'DISCHARGE_DATE_PAST'
  | 'NOT_OCCUPIED';

export type BedGuardResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: BedGuardCode; readonly detail: string };

const ALLOWED: BedGuardResult = { ok: true };

function deny(code: BedGuardCode, detail: string): BedGuardResult {
  return { ok: false, code, detail };
}

/** True when a reservation has run out (`BTN-B06-RESERVE`: "expiry auto-releases"). */
export function holdLapsed(bed: Pick<BedView, 'state' | 'reservedUntil'>, now: Timestamp): boolean {
  return (
    bed.state === 'reserved' &&
    bed.reservedUntil !== null &&
    toEpochMs(bed.reservedUntil) <= toEpochMs(now)
  );
}

/**
 * The state a bed is actually in, once a lapsed hold is counted as free.
 *
 * Everything that decides or displays uses this rather than `bed.state`, so
 * the console, the server and the public view agree on one bed at one instant.
 */
export function effectiveState(
  bed: Pick<BedView, 'state' | 'reservedUntil'>,
  now: Timestamp,
): BedState {
  return holdLapsed(bed, now) ? 'free' : bed.state;
}

/** What the caller knows about the action beyond its name. */
export interface BedActionContext {
  /** Admitting the patient this bed is held for, when there is one. */
  readonly bedRequestId?: string | null;
  readonly reason?: string | null;
  readonly holdMinutes?: number | null;
}

/**
 * May this action be taken on this bed, now?
 *
 * The only rules here are about the bed. Whether the patient is already in
 * another bed, or the target of a transfer is in the same hospital, are
 * questions about rows, and the server answers them against the database.
 */
export function canApply(
  bed: BedView,
  action: BedAction,
  now: Timestamp,
  context: BedActionContext = {},
): BedGuardResult {
  const state = effectiveState(bed, now);

  switch (action) {
    case 'admit':
      if (state === 'free') return ALLOWED;
      if (state === 'reserved') {
        // A held bed is for the family it was held for. Admitting a walk-in
        // into it would break a promise the patient app is showing them.
        if (bed.heldForRequestId === null) return ALLOWED;
        return bed.heldForRequestId === (context.bedRequestId ?? null)
          ? ALLOWED
          : deny('HELD_FOR_SOMEONE_ELSE', 'This bed is held for another request.');
      }
      return deny('WRONG_STATE', `A ${state} bed cannot be admitted into.`);

    case 'discharge':
    case 'transfer':
      return state === 'occupied'
        ? ALLOWED
        : deny('NOT_OCCUPIED', 'Only an occupied bed has somebody to discharge or move.');

    case 'reserve': {
      if (state !== 'free') return deny('WRONG_STATE', `A ${state} bed cannot be reserved.`);
      const minutes = context.holdMinutes ?? null;
      if (minutes === null || minutes <= 0 || minutes > MAX_HOLD_MINUTES) {
        return deny(
          'HOLD_OUT_OF_RANGE',
          `A hold is between 1 and ${String(MAX_HOLD_MINUTES)} minutes.`,
        );
      }
      return ALLOWED;
    }

    case 'release':
      // A lapsed hold is already free; releasing it is the server's sweep,
      // not a console action, so the console sees nothing to release.
      return state === 'reserved' ? ALLOWED : deny('WRONG_STATE', 'That bed is not reserved.');

    case 'clean_start':
      return state === 'free'
        ? ALLOWED
        : deny('WRONG_STATE', 'Only a free bed can be sent for cleaning.');

    case 'clean_done':
      return state === 'cleaning' ? ALLOWED : deny('WRONG_STATE', 'That bed is not being cleaned.');

    case 'oos':
      // Not from occupied: a patient is in it, and not from a live hold: a
      // family is on the way to it. Both must be dealt with first.
      if (state !== 'free' && state !== 'cleaning') {
        return deny('WRONG_STATE', `A ${state} bed cannot be taken out of service.`);
      }
      if ((context.reason ?? '').trim() === '') {
        return deny('REASON_REQUIRED', 'Say why the bed is out of service.');
      }
      return ALLOWED;

    case 'restore':
      return state === 'out_of_service'
        ? ALLOWED
        : deny('WRONG_STATE', 'That bed is not out of service.');
  }
}

/** Whether a transfer may land on `target`. */
export function canReceiveTransfer(
  source: BedView,
  target: BedView,
  now: Timestamp,
): BedGuardResult {
  if (source.id === target.id)
    return deny('SAME_BED', 'A patient cannot be moved to the bed they are in.');
  const state = effectiveState(target, now);
  if (state === 'free') return ALLOWED;
  if (state === 'reserved' && target.heldForRequestId === null) return ALLOWED;
  return deny('WRONG_STATE', `A ${state} bed cannot receive a transfer.`);
}

/** Whether `date` may be set as an expected discharge (`FR-BED-04`). */
export function canForecastDischarge(
  bed: BedView,
  date: DhakaDate | null,
  today: DhakaDate,
): BedGuardResult {
  if (bed.state !== 'occupied')
    return deny('NOT_OCCUPIED', 'Only an occupied bed has a discharge to forecast.');
  if (date !== null && date < today) {
    return deny('DISCHARGE_DATE_PAST', 'An expected discharge cannot be in the past.');
  }
  return ALLOWED;
}

/** The event an action writes and the state it leaves the bed in. */
export function outcomeOf(action: BedAction): {
  readonly type: BedEventType;
  readonly to: BedState;
} {
  switch (action) {
    case 'admit':
      return { type: 'ADMIT', to: 'occupied' };
    case 'discharge':
      return { type: 'DISCHARGE', to: 'cleaning' };
    case 'transfer':
      // The bed being left. The bed being entered gets its own TRANSFER,
      // ending in `occupied`.
      return { type: 'TRANSFER', to: 'cleaning' };
    case 'reserve':
      return { type: 'RESERVE', to: 'reserved' };
    case 'release':
      return { type: 'RELEASE', to: 'free' };
    case 'clean_start':
      return { type: 'CLEAN_START', to: 'cleaning' };
    case 'clean_done':
      return { type: 'CLEAN_DONE', to: 'free' };
    case 'oos':
      return { type: 'OOS', to: 'out_of_service' };
    case 'restore':
      return { type: 'RESTORE', to: 'free' };
  }
}

/** One action as the console applies it locally, before the server answers. */
export interface LocalBedChange {
  readonly bedId: string;
  readonly action: BedAction;
  readonly at: Timestamp;
  readonly toBedId?: string | null;
  readonly holdMinutes?: number | null;
  readonly reason?: string | null;
  readonly bedRequestId?: string | null;
  /** Stands in for the admission id the server has not issued yet. */
  readonly provisionalAdmissionId?: string | null;
}

/**
 * The board with one change applied — the console's optimistic update.
 *
 * Returns the board unchanged when the guard refuses, so a queued action that
 * no longer makes sense (the bed moved on while the console was offline)
 * renders as nothing rather than as a bed in an impossible state. The server
 * will refuse it too, and the outbox rolls it back.
 */
export function applyLocal(beds: readonly BedView[], change: LocalBedChange): readonly BedView[] {
  const source = beds.find((bed) => bed.id === change.bedId);
  if (source === undefined) return beds;

  const verdict = canApply(source, change.action, change.at, {
    bedRequestId: change.bedRequestId ?? null,
    reason: change.reason ?? null,
    holdMinutes: change.holdMinutes ?? null,
  });
  if (!verdict.ok) return beds;

  if (change.action === 'transfer') {
    const target = beds.find((bed) => bed.id === change.toBedId);
    if (target === undefined || !canReceiveTransfer(source, target, change.at).ok) return beds;

    return beds.map((bed) => {
      if (bed.id === source.id) return moved(bed, 'cleaning', change.at);
      if (bed.id === target.id) {
        return {
          ...moved(bed, 'occupied', change.at),
          admissionId: source.admissionId,
          expectedDischargeDate: source.expectedDischargeDate,
        };
      }
      return bed;
    });
  }

  const { to } = outcomeOf(change.action);

  return beds.map((bed) => {
    if (bed.id !== source.id) return bed;
    const next = moved(bed, to, change.at);

    switch (change.action) {
      case 'admit':
        return { ...next, admissionId: change.provisionalAdmissionId ?? `pending:${bed.id}` };
      case 'reserve':
        return {
          ...next,
          reservedUntil: addMinutesTo(change.at, change.holdMinutes ?? 0),
          heldForRequestId: change.bedRequestId ?? null,
        };
      case 'oos':
        return { ...next, oosReason: (change.reason ?? '').trim() };
      case 'clean_done':
        return { ...next, lastCleanedAt: change.at };
      case 'discharge':
      case 'transfer':
      case 'release':
      case 'clean_start':
      case 'restore':
        return next;
    }
  });
}

/** A bed moved into `state`, with every field that belonged to the old one cleared. */
function moved(bed: BedView, state: BedState, at: Timestamp): BedView {
  return {
    ...bed,
    state,
    stateChangedAt: at,
    // Each of these describes one state and must not survive into another —
    // the same rule the table's CHECK constraints enforce.
    admissionId: state === 'occupied' ? bed.admissionId : null,
    expectedDischargeDate: state === 'occupied' ? bed.expectedDischargeDate : null,
    reservedUntil: state === 'reserved' ? bed.reservedUntil : null,
    heldForRequestId: state === 'reserved' ? bed.heldForRequestId : null,
    oosReason: state === 'out_of_service' ? bed.oosReason : null,
  };
}

function addMinutesTo(at: Timestamp, minutes: number): Timestamp {
  return new Date(toEpochMs(at) + minutes * 60_000).toISOString() as Timestamp;
}
