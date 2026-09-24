/**
 * Anonymised facility benchmarking (`FR-GOV-04`).
 *
 * "Anonymised facility benchmarking (wait times, turnaround, feedback)." The
 * repository hands over one row per live facility from `v_gov_benchmark` —
 * its kind, and nothing that names it — and this ranks each measure on its
 * own.
 *
 * No I/O.
 *
 * ## Each measure is ranked separately
 *
 * A table with one row per facility and a column per measure would let a
 * reader follow one facility across every column, and a facility's profile is
 * most of the way to its name. Ranked separately, each measure answers the
 * question benchmarking is for — how spread out are facilities on this, and
 * where does the middle sit — without building that profile.
 *
 * ## Too few is not a figure
 *
 * A median over two lab orders or an average over three feedback forms is not
 * a benchmark, and ranking it beside a figure built from two hundred would
 * put a facility at the top of a table on luck. Below `MIN_BENCHMARK_SAMPLE`
 * a facility is left out of that measure and counted as `tooFew`, so the
 * screen can say how many could not be compared rather than pretend they were
 * (`PRD.md` §3.2).
 */

import type { FacilityKind } from '../types/enums.js';

/** Fewest observations a facility needs before its figure is compared. */
export const MIN_BENCHMARK_SAMPLE = 5;

/** One row of `v_gov_benchmark`. */
export interface FacilityFigures {
  readonly kind: FacilityKind;
  readonly avgWaitMinutes: number | null;
  readonly waitsMeasured: number;
  readonly medianTurnaroundHours: number | null;
  readonly turnaroundsMeasured: number;
  readonly waitScore: number | null;
  readonly doctorScore: number | null;
  readonly cleanlinessScore: number | null;
  readonly billingScore: number | null;
  readonly responses: number;
}

export type BenchmarkMeasure =
  'wait' | 'turnaround' | 'score_wait' | 'score_doctor' | 'score_cleanliness' | 'score_billing';

export interface BenchmarkEntry {
  readonly kind: FacilityKind;
  /** Rounded for display: minutes and scores to one place, hours to one. */
  readonly value: number;
  /** How many observations it rests on. */
  readonly sample: number;
}

export interface Benchmark {
  readonly measure: BenchmarkMeasure;
  /** Whether a lower figure is the better one (a wait) or a higher (a score). */
  readonly better: 'lower' | 'higher';
  /** Best first. */
  readonly entries: readonly BenchmarkEntry[];
  /** The middle of the compared facilities, or null when none could be. */
  readonly median: number | null;
  /** Facilities left out for resting on fewer than the minimum. */
  readonly tooFew: number;
}

interface MeasureSpec {
  readonly measure: BenchmarkMeasure;
  readonly better: 'lower' | 'higher';
  readonly value: (row: FacilityFigures) => number | null;
  readonly sample: (row: FacilityFigures) => number;
}

const MEASURES: readonly MeasureSpec[] = [
  {
    measure: 'wait',
    better: 'lower',
    value: (row) => row.avgWaitMinutes,
    sample: (row) => row.waitsMeasured,
  },
  {
    measure: 'turnaround',
    better: 'lower',
    value: (row) => row.medianTurnaroundHours,
    sample: (row) => row.turnaroundsMeasured,
  },
  {
    measure: 'score_wait',
    better: 'higher',
    value: (row) => row.waitScore,
    sample: (row) => row.responses,
  },
  {
    measure: 'score_doctor',
    better: 'higher',
    value: (row) => row.doctorScore,
    sample: (row) => row.responses,
  },
  {
    measure: 'score_cleanliness',
    better: 'higher',
    value: (row) => row.cleanlinessScore,
    sample: (row) => row.responses,
  },
  {
    measure: 'score_billing',
    better: 'higher',
    value: (row) => row.billingScore,
    sample: (row) => row.responses,
  },
];

/** Ranks every measure across the facilities given, each on its own. */
export function benchmark(facilities: readonly FacilityFigures[]): Benchmark[] {
  return MEASURES.map((spec) => {
    const compared: BenchmarkEntry[] = [];
    let tooFew = 0;

    for (const row of facilities) {
      const value = spec.value(row);
      const sample = spec.sample(row);

      // A facility with no observations at all has nothing to benchmark — a
      // clinic with no lab is not "too few" on turnaround, it is absent.
      if (value === null || sample === 0) continue;

      if (sample < MIN_BENCHMARK_SAMPLE) {
        tooFew += 1;
        continue;
      }

      compared.push({ kind: row.kind, value: round1(value), sample });
    }

    compared.sort((a, b) => (spec.better === 'lower' ? a.value - b.value : b.value - a.value));

    return {
      measure: spec.measure,
      better: spec.better,
      entries: compared,
      median: median(compared.map((entry) => entry.value)),
      tooFew,
    };
  });
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[middle] ?? 0)
      : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
  return round1(value);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
