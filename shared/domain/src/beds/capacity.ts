/**
 * Counting beds (`FR-BED-04`, `FR-BED-05`, `FR-BED-06`).
 *
 * Two different counts live here, and they must not be confused:
 *
 * **What the public is told** — `tallyByKind` — is the same arithmetic
 * `v_public_hospital_capacity` does in SQL: a bed is free when it is free or
 * its hold has lapsed, and a bed out of service is not capacity at all. The
 * ward board computes it from its own tiles and shows it next to what the view
 * returned (`<CapacityMirror>`), so a disagreement between the two is visible
 * on the screen of the person who can fix it. The test that proves they agree
 * is step 14's definition of done.
 *
 * **What tomorrow may look like** — `forecastTomorrow` — is for staff only.
 * `FR-BED-04` says the expected discharge dates drive "tomorrow's predicted
 * availability"; it does not say to publish a prediction, and a family told a
 * bed will be free tomorrow has been told something nobody can promise.
 */

import { effectiveState, type BedView } from './board.js';

import type { BedKind } from '../types/enums.js';
import type { DhakaDate, Timestamp } from '../types/ids.js';

/** One bed type, counted as the public sees it (`FR-PAT-51`). */
export interface KindTally {
  readonly kind: BedKind;
  /** Beds in service. A bed out of service is not capacity. */
  readonly total: number;
  readonly free: number;
  readonly nightlyMinPoisha: number | null;
  readonly nightlyMaxPoisha: number | null;
}

/**
 * Free and total per kind, in `bed_kind` declaration order.
 *
 * `order` is the enum's order, passed in rather than imported so the caller
 * decides whether the list is the full catalogue or only kinds present.
 */
export function tallyByKind(
  beds: readonly BedView[],
  now: Timestamp,
  order: readonly BedKind[],
): readonly KindTally[] {
  const tallies: KindTally[] = [];

  for (const kind of order) {
    const ofKind = beds.filter((bed) => bed.kind === kind);
    if (ofKind.length === 0) continue;

    const inService = ofKind.filter((bed) => bed.state !== 'out_of_service');
    const prices = inService.map((bed) => bed.nightlyPoisha);

    tallies.push({
      kind,
      total: inService.length,
      free: inService.filter((bed) => effectiveState(bed, now) === 'free').length,
      nightlyMinPoisha: prices.length === 0 ? null : Math.min(...prices),
      nightlyMaxPoisha: prices.length === 0 ? null : Math.max(...prices),
    });
  }

  return tallies;
}

/** One bed type's outlook for tomorrow (`FR-BED-04`). Staff only. */
export interface KindForecast {
  readonly kind: BedKind;
  /** Free now, including lapsed holds. */
  readonly freeNow: number;
  /**
   * Free now, plus beds being cleaned, plus occupied beds whose patient is
   * expected to leave today or tomorrow. A live hold is not counted: the
   * family it is held for is arriving.
   */
  readonly freeTomorrow: number;
  /** Occupied beds with no expected discharge at all — the forecast's blind spot. */
  readonly unforecast: number;
}

export function forecastTomorrow(
  beds: readonly BedView[],
  now: Timestamp,
  today: DhakaDate,
  order: readonly BedKind[],
): readonly KindForecast[] {
  const tomorrow = nextDay(today);
  const forecasts: KindForecast[] = [];

  for (const kind of order) {
    const ofKind = beds.filter((bed) => bed.kind === kind);
    if (ofKind.length === 0) continue;

    let freeNow = 0;
    let leaving = 0;
    let cleaning = 0;
    let unforecast = 0;

    for (const bed of ofKind) {
      const state = effectiveState(bed, now);
      if (state === 'free') freeNow += 1;
      if (state === 'cleaning') cleaning += 1;
      if (state === 'occupied') {
        if (bed.expectedDischargeDate === null) unforecast += 1;
        else if (bed.expectedDischargeDate <= tomorrow) leaving += 1;
      }
    }

    forecasts.push({ kind, freeNow, freeTomorrow: freeNow + cleaning + leaving, unforecast });
  }

  return forecasts;
}

/** The calendar day after `date`, both in Dhaka. */
export function nextDay(date: DhakaDate): DhakaDate {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, (day ?? 1) + 1));
  return next.toISOString().slice(0, 10) as DhakaDate;
}

/** The public figures for one hospital, as `v_public_hospital_capacity` returns them. */
export interface PublicCapacity {
  readonly hospitalId: string;
  readonly bedTotal: number;
  readonly bedFree: number;
  /** Null when the hospital has no ICU — which is not the same as a full one. */
  readonly icuTotal: number | null;
  readonly icuFree: number | null;
  readonly icuAsOf: Timestamp | null;
  /** The oldest kind's stamp; null when any kind has never been confirmed. */
  readonly bedsAsOf: Timestamp | null;
  readonly byKind: readonly (KindTally & { readonly asOf: Timestamp | null })[];
}

/**
 * Whether the board's own count matches what the public is shown.
 *
 * Returns the kinds that disagree. Empty is the normal case; anything else is
 * a bug, because both are computed from the same rows by the same rule — and
 * it is exactly the bug `FR-BED-06` puts on the ward's screen rather than
 * hiding.
 */
export function mirrorMismatches(
  board: readonly KindTally[],
  published: PublicCapacity,
): readonly BedKind[] {
  const publishedByKind = new Map(published.byKind.map((entry) => [entry.kind, entry]));
  const kinds = new Set<BedKind>([...board.map((entry) => entry.kind), ...publishedByKind.keys()]);

  const mismatched: BedKind[] = [];
  for (const kind of kinds) {
    const mine = board.find((entry) => entry.kind === kind);
    const theirs = publishedByKind.get(kind);
    if (mine?.free !== theirs?.free || mine?.total !== theirs?.total) mismatched.push(kind);
  }
  return mismatched;
}
