/**
 * Emergency ranking (`FR-PAT-43`, `FR-PAT-45`, `S-A-10b`).
 *
 * "Results are ranked by: required capability present → estimated travel time
 * → current emergency load → free beds." And: "A facility with stale data
 * (> configurable threshold) is shown with an explicit stale warning and
 * ranked lower."
 *
 * Pure. The geography is `fn_nearby_hospitals` (migration 0013), travel time
 * is an adapter (`TRAVEL_TIME_MODE`), the figures are
 * `v_public_hospital_capacity` — this module takes all three as numbers and
 * decides an order. It lives in `shared/domain` because the order is a
 * product rule, and the ER console's refer-out suggestion (`FR-EMG-02`) uses
 * the same one.
 *
 * ## The order, exactly
 *
 *   1. Can take the case: the required capability is available now. When the
 *      problem needs no particular capability, every facility ties here.
 *   2. Fresh before stale (`FR-PAT-45`). Inside the capability tier, not above
 *      it: a stale burn unit still outranks a fresh hospital with no burn unit
 *      at all, because the second is certainly wrong and the first only
 *      possibly so.
 *   3. Travel time, shortest first. Unknown (no position given) sorts last.
 *   4. Emergency load, lightest first (`FR-EMG-04`).
 *   5. Free beds of the relevant kind, most first.
 *   6. The hospital id, so the order is total and two phones asking the same
 *      question at the same moment are told the same thing.
 *
 * ## "Nearest capable facility" is read through staleness
 *
 * `FR-PAT-41` gives a critical case "the nearest capable facility". That is
 * the first result of this same order, not a second ranking by distance alone:
 * a burn unit whose data nobody has confirmed for four hours is not *known* to
 * be capable now, and `FR-PAT-45` applies to every result. The card still says
 * how far each facility is, and the stale one still appears — second, amber,
 * with its age.
 *
 * ## Problem → capability
 *
 * `FR-PAT-42` names eight problems and `FR-EMG-05` six capabilities; no
 * document maps one to the other, so the owner ruled (2026-09-21): four
 * problems need a capability, four need only an ER. A child is not mapped to
 * the NICU — that is a neonatal unit and would mis-rank an older child — and
 * obstetric and breathing emergencies are not mapped to anything this schema
 * names.
 */

import type { BedKind, CapabilityKind, EmergencyProblem } from '../types/enums.js';
import type { Timestamp } from '../types/ids.js';

/** What each problem needs a facility to be able to do right now. */
export const PROBLEM_CAPABILITY: Readonly<Record<EmergencyProblem, CapabilityKind | null>> = {
  burn: 'burn_unit',
  accident: 'trauma_ot',
  cardiac: 'cardiac',
  stroke: 'stroke',
  breathing: null,
  child: null,
  obstetric: null,
  other: null,
};

/**
 * The kind of bed whose free count matters for each problem.
 *
 * Only burns have one: `FR-PAT-50` lists a burn bed as its own kind, and the
 * pitch (`PRD.md` §24 step 7) is "a free burn bed with fresh data". Every
 * other problem is counted against the facility's free beds as a whole.
 */
export const PROBLEM_BED_KIND: Readonly<Record<EmergencyProblem, BedKind | null>> = {
  burn: 'burn',
  accident: null,
  cardiac: null,
  stroke: null,
  breathing: null,
  child: null,
  obstetric: null,
  other: null,
};

/**
 * How far emergency search looks, in metres.
 *
 * Fifty kilometres covers Dhaka and its ring — Narayanganj, Gazipur, Savar —
 * and keeps a Chattogram hospital off a Dhaka family's list. No document names
 * a radius; this one is recorded in `docs/STATUS.md` as a choice awaiting the
 * owner's word.
 */
export const EMERGENCY_SEARCH_RADIUS_METRES = 50_000;

/** Null when no problem was chosen yet: a critical case's first screen. */
export function requiredCapability(problem: EmergencyProblem | null): CapabilityKind | null {
  return problem === null ? null : PROBLEM_CAPABILITY[problem];
}

export function relevantBedKind(problem: EmergencyProblem | null): BedKind | null {
  return problem === null ? null : PROBLEM_BED_KIND[problem];
}

/** The public figures a result card is built from (`v_public_hospital_capacity`). */
export interface CapacityFigures {
  readonly bedTotal: number;
  readonly bedFree: number;
  readonly icuTotal: number | null;
  readonly icuAsOf: Timestamp | null;
  readonly bedsAsOf: Timestamp | null;
  readonly capabilityAsOf: Timestamp | null;
  readonly byKind: readonly {
    readonly kind: BedKind;
    readonly free: number;
    readonly asOf: Timestamp | null;
  }[];
}

/**
 * What a case needs a facility to have: a capability, a kind of free bed, or
 * both. From the problem for a family's search; chosen by the coordinator for
 * a referral (`FR-EMG-07`), where "our ICU is full" is a bed kind and names no
 * capability at all.
 */
export interface EmergencyNeed {
  readonly capability: CapabilityKind | null;
  readonly bedKind: BedKind | null;
}

/** The need a problem implies (`PROBLEM_CAPABILITY`, `PROBLEM_BED_KIND`). */
export function needFor(problem: EmergencyProblem | null): EmergencyNeed {
  return { capability: requiredCapability(problem), bedKind: relevantBedKind(problem) };
}

/**
 * Free beds that answer this problem: the relevant kind's, or the whole
 * hospital's. Null when there is no such figure — a hospital with no burn
 * ward has *no burn beds*, which a card says in words, not as a zero.
 */
export function relevantFreeBeds(
  problem: EmergencyProblem | null,
  figures: CapacityFigures,
): number | null {
  return freeBedsFor(needFor(problem), figures);
}

/** `relevantFreeBeds` for a need rather than a problem. */
export function freeBedsFor(need: EmergencyNeed, figures: CapacityFigures): number | null {
  if (need.bedKind !== null) {
    return figures.byKind.find((entry) => entry.kind === need.bedKind)?.free ?? null;
  }
  return figures.bedTotal === 0 ? null : figures.bedFree;
}

/**
 * The stamps of the figures a result is *ranked on*, for `freshnessOf`.
 *
 * The capability flag when one is required, and the relevant bed count. These
 * decide the order, so their age decides whether `FR-PAT-45` de-ranks the
 * result.
 *
 * The ICU count is shown on every card (`FR-PAT-44`) but decides nothing, and
 * it is deliberately not here: a full ICU has no action that renews its stamp
 * without changing a bed, so counting it would turn a burn unit confirmed a
 * minute ago stale because of a ward nobody could touch. The card gives the
 * ICU figure its own freshness line instead — every number keeps its own age.
 * A referral that *asks* for an ICU bed ranks on the ICU's figure, so there
 * the ICU's age is the one that counts.
 */
export function stampsFor(
  problem: EmergencyProblem | null,
  figures: CapacityFigures,
): (Timestamp | null)[] {
  return stampsForNeed(needFor(problem), figures);
}

/** `stampsFor` for a need rather than a problem. */
export function stampsForNeed(need: EmergencyNeed, figures: CapacityFigures): (Timestamp | null)[] {
  const stamps: (Timestamp | null)[] = [];

  if (need.capability !== null) stamps.push(figures.capabilityAsOf);

  if (need.bedKind !== null) {
    const entry = figures.byKind.find((candidate) => candidate.kind === need.bedKind);
    if (entry !== undefined) stamps.push(entry.asOf);
  } else if (figures.bedTotal > 0) {
    stamps.push(figures.bedsAsOf);
  }

  return stamps;
}

/** What the order is decided on. */
export interface RankCandidate {
  readonly hospitalId: string;
  /** Null when the problem needs no particular capability. */
  readonly hasCapability: boolean | null;
  readonly stale: boolean;
  /** Null when the caller gave no position. */
  readonly travelMinutes: number | null;
  readonly erLoad: number | null;
  readonly freeBeds: number | null;
}

/** `FR-PAT-43` then `FR-PAT-45`, as a comparator. */
export function compareCandidates(a: RankCandidate, b: RankCandidate): number {
  return (
    rankOf(a.hasCapability) - rankOf(b.hasCapability) ||
    Number(a.stale) - Number(b.stale) ||
    ascendingNullsLast(a.travelMinutes, b.travelMinutes) ||
    ascendingNullsLast(a.erLoad, b.erLoad) ||
    ascendingNullsLast(negate(a.freeBeds), negate(b.freeBeds)) ||
    (a.hospitalId < b.hospitalId ? -1 : a.hospitalId > b.hospitalId ? 1 : 0)
  );
}

/** A new array in ranked order; the input is left alone. */
export function rankCandidates<T extends RankCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compareCandidates);
}

/** Able before unable; "nothing required" ties with able. */
function rankOf(hasCapability: boolean | null): number {
  return hasCapability === false ? 1 : 0;
}

function ascendingNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function negate(value: number | null): number | null {
  return value === null ? null : -value;
}
