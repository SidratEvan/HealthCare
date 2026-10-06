/**
 * A hospital workspace's state, and how ready it is (`PRD.md` §14c,
 * `FR-ONB-02`–`04`, `FR-ONB-06`).
 *
 * Two things live here because both sides need the same answer to each. The
 * API uses them to refuse; the console uses them to say, before anybody taps,
 * what is allowed and what is still missing.
 *
 * ## The states
 *
 *   setup ──request──▶ ready_for_review ──approve──▶ active ──▶ closed
 *     ▲                      │ send back                 │  ▲
 *     └──────────────────────┘                  suspend ▼  │ reinstate
 *                                                    suspended ──▶ closed
 *
 * Going live is two acts by two people (`FR-ONB-04`): the hospital's
 * administrator asks, a platform administrator approves. Nothing in this file
 * lets one person do both, because the actions carry who may take them.
 *
 * ## Readiness is counted, never stored
 *
 * `FR-ONB-03`: the checklist is what exists — departments, doctors, schedules,
 * beds, staff — counted when it is asked for. A stored "70% complete" is wrong
 * the moment somebody deletes a schedule, and nobody would know.
 */

import type { OrgLifecycle } from '../types/enums.js';

/** Who takes each action: the hospital's own administrator, or the platform's. */
export const ORG_ACTIONS = {
  request_review: 'hospital',
  approve: 'platform',
  send_back: 'platform',
  suspend: 'platform',
  reinstate: 'platform',
  close: 'platform',
} as const;
export type OrgAction = keyof typeof ORG_ACTIONS;

const TRANSITIONS: Readonly<Record<OrgAction, Partial<Record<OrgLifecycle, OrgLifecycle>>>> = {
  request_review: { setup: 'ready_for_review' },
  approve: { ready_for_review: 'active' },
  send_back: { ready_for_review: 'setup' },
  suspend: { active: 'suspended' },
  reinstate: { suspended: 'active' },
  close: { active: 'closed', suspended: 'closed' },
};

/** The state an action leads to from this one, or null when it is not allowed. */
export function nextLifecycle(from: OrgLifecycle, action: OrgAction): OrgLifecycle | null {
  return TRANSITIONS[action][from] ?? null;
}

/** The actions a platform administrator may take on a workspace in this state. */
export function platformActions(from: OrgLifecycle): readonly OrgAction[] {
  return (Object.keys(ORG_ACTIONS) as OrgAction[]).filter(
    (action) => ORG_ACTIONS[action] === 'platform' && nextLifecycle(from, action) !== null,
  );
}

/**
 * Whether an action must say why.
 *
 * Sending a hospital back, suspending it and closing it are each something
 * its administrator will read and have to act on; an empty reason there is a
 * closed door with no sign on it.
 */
export function actionNeedsNote(action: OrgAction): boolean {
  return action === 'send_back' || action === 'suspend' || action === 'close';
}

/** Only an active workspace is in front of patients (`FR-NET-03`). */
export function isPublicLifecycle(lifecycle: OrgLifecycle): boolean {
  return lifecycle === 'active';
}

// ---------------------------------------------------------------------------
// The checklist (`FR-ONB-03`)
// ---------------------------------------------------------------------------

/** What exists at a hospital, counted when asked. */
export interface SetupCounts {
  readonly departments: number;
  /** Active doctors, verified or not. */
  readonly doctors: number;
  /** Of those, the ones whose BMDC number the platform has verified. */
  readonly verifiedDoctors: number;
  /** Weekly chamber schedules. */
  readonly schedules: number;
  readonly beds: number;
  /** Active staff accounts, the administrator's own included. */
  readonly staff: number;
}

export const CHECKLIST_ITEMS = [
  'departments',
  'doctors',
  'schedules',
  'staff',
  'beds',
  'verified_doctors',
] as const;
export type ChecklistItemKey = (typeof CHECKLIST_ITEMS)[number];

export interface ChecklistItem {
  readonly key: ChecklistItemKey;
  readonly count: number;
  readonly done: boolean;
  /**
   * Whether review can be asked for without it.
   *
   * Beds are not required: a diagnostic centre and a clinic have none, and
   * that is a kind of hospital, not an unfinished one. Verified doctors are
   * not the hospital's to do — the platform verifies them during review
   * (`FR-ONB-05`) — so they cannot be a condition of asking for it.
   */
  readonly required: boolean;
}

export function setupChecklist(counts: SetupCounts): readonly ChecklistItem[] {
  return [
    { key: 'departments', count: counts.departments, done: counts.departments > 0, required: true },
    { key: 'doctors', count: counts.doctors, done: counts.doctors > 0, required: true },
    { key: 'schedules', count: counts.schedules, done: counts.schedules > 0, required: true },
    { key: 'staff', count: counts.staff, done: counts.staff > 0, required: true },
    { key: 'beds', count: counts.beds, done: counts.beds > 0, required: false },
    {
      key: 'verified_doctors',
      count: counts.verifiedDoctors,
      done: counts.verifiedDoctors > 0,
      required: false,
    },
  ];
}

/** The required items still missing. Empty when review can be asked for. */
export function missingForReview(counts: SetupCounts): readonly ChecklistItemKey[] {
  return setupChecklist(counts)
    .filter((item) => item.required && !item.done)
    .map((item) => item.key);
}

/**
 * What stops an approval, if anything.
 *
 * Everything asking for review needs, and one more thing only the platform
 * can supply: at least one verified doctor. Unverified doctors are never
 * published (`FR-SUP-02`), so a hospital approved with none would go live
 * with nobody a patient could book — a listing that leads nowhere, which is
 * the thing this whole flow exists to prevent.
 */
export function missingForApproval(counts: SetupCounts): readonly ChecklistItemKey[] {
  const missing = [...missingForReview(counts)];
  if (counts.verifiedDoctors === 0) missing.push('verified_doctors');
  return missing;
}
