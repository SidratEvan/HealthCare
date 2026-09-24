/**
 * The national dashboard's calls to the API (BACKEND.md §7.7, `S-B-13`).
 *
 * Four reads, no parameters, no writes — the shapes are `gov.service`'s own.
 * Kept out of the screen for the reason `lib/admin.ts` is: a screen reads as
 * a sequence of decisions, and a test can hand it a fake.
 *
 * ## Four requests, not one
 *
 * `S-B-10` makes one request because every section of it is one facility's
 * day. These four are different questions answered from different views with
 * different ages, and `BACKEND.md` §7.7 gives them separate routes; one that
 * fails — the heat map, say — should leave the capacity map standing rather
 * than taking the whole screen with it.
 *
 * ## Online-only, like the hospital dashboard
 *
 * Nothing here is an action, so there is nothing to queue. When the network
 * goes, the screen keeps what it last had and its ages keep ageing (`GR-03`).
 */

import { ApiClient } from '@platform/client';
import type { Benchmark, FacilityKind, SignalReading } from '@platform/domain';

import { API_BASE } from '@/lib/admin';

export interface KindCapacity {
  readonly kind: string;
  readonly total: number;
  readonly free: number;
  readonly asOf: string | null;
}

export interface DistrictCapacity {
  readonly division: string;
  readonly district: string;
  readonly facilities: number;
  readonly bedTotal: number;
  readonly bedFree: number;
  readonly icuTotal: number | null;
  readonly icuFree: number | null;
  readonly burnUnitsOpen: number;
  readonly erActive: number;
  readonly bedsAsOf: string | null;
  readonly capabilityAsOf: string | null;
  readonly byKind: readonly KindCapacity[];
}

export interface Capacity {
  readonly districts: readonly DistrictCapacity[];
  readonly totals: Omit<DistrictCapacity, 'division' | 'district' | 'capabilityAsOf'>;
  readonly unrecorded: readonly ('ventilators' | 'blood')[];
}

export interface ErDistrict {
  readonly division: string;
  readonly district: string;
  readonly open: number;
  readonly onTheWay: number;
  readonly red: number;
  readonly asOf: string | null;
  readonly hourly: readonly { readonly cases: number; readonly red: number }[];
}

export interface ErLoad {
  readonly windowHours: number;
  readonly hours: readonly string[];
  readonly districts: readonly ErDistrict[];
  readonly totals: { readonly open: number; readonly onTheWay: number; readonly red: number };
  readonly peak: number;
}

export interface Signals {
  readonly today: string;
  readonly rule: {
    readonly windowDays: number;
    readonly baselineDays: number;
    readonly minCases: number;
    readonly ratio: number;
  };
  readonly readings: readonly SignalReading[];
  readonly asOf: string | null;
}

export interface Benchmarks {
  readonly windowDays: number;
  readonly minSample: number;
  readonly facilities: number;
  readonly measures: readonly Benchmark[];
  readonly asOf: string;
}

export type { Benchmark, FacilityKind, SignalReading };

function client(token: string): ApiClient {
  return new ApiClient({ baseUrl: API_BASE, getToken: () => token });
}

export const govApi = {
  async capacity(token: string): Promise<Capacity> {
    return await client(token).get<Capacity>('/gov/capacity');
  },
  async erLoad(token: string): Promise<ErLoad> {
    return await client(token).get<ErLoad>('/gov/er-load');
  },
  async signals(token: string): Promise<Signals> {
    return await client(token).get<Signals>('/gov/signals');
  },
  async benchmarks(token: string): Promise<Benchmarks> {
    return await client(token).get<Benchmarks>('/gov/benchmarks');
  },
};

/**
 * How a cell of the heat map is shaded, from nothing to the busiest hour.
 *
 * Five steps on the brand ramp (`FRONTEND.md` §1: a single hue plus neutral),
 * scaled to the day's own peak so a quiet district's busiest hour still reads
 * as its busiest. Zero is its own step: an hour nobody arrived is not the
 * palest shade of busy.
 */
export function heatLevel(cases: number, peak: number): 0 | 1 | 2 | 3 | 4 {
  if (cases <= 0 || peak <= 0) return 0;
  const level = Math.ceil((cases / peak) * 4);
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4;
}
