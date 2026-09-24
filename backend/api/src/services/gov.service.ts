/**
 * The national layer (`S-B-13`, `FR-GOV-01`..`FR-GOV-06`).
 *
 * Four reads, one per section of the screen `APP_FLOW.md` B8 describes: the
 * district capacity map, the emergency load heat map, the symptom signals and
 * the anonymised benchmark. The rows are `gov.repo` (as `gov_reader`, which
 * can open nothing but the aggregate views); the arithmetic is
 * `shared/domain/gov`; what is here is assembly, and the last check.
 *
 * ## The last check
 *
 * Every payload is walked by `findIdentifiers` before it is returned, and one
 * that carries an id, a name, a phone or anything shaped like either is not
 * sent at all. `FR-GOV-06` says "under any configuration", and the database
 * role already makes the base tables unreachable — so this exists for the day
 * somebody adds a column to a view without thinking about who reads it. The
 * failure is a 500 and a log line naming the path, never a response.
 *
 * ## What is unrecorded is said to be
 *
 * `FR-GOV-01` names ventilators and blood availability, and nothing in this
 * product records either (0026). They are listed as `unrecorded` so the
 * screen can say so, rather than left out — an absent row on a capacity map
 * reads as "none", and "none" is a claim nobody here can make.
 */

import {
  benchmark,
  findIdentifiers,
  readSignals,
  time,
  BASELINE_MAX_DAYS,
  MIN_BENCHMARK_SAMPLE,
  SIGNAL_WINDOW_DAYS,
  SPIKE_MIN_CASES,
  SPIKE_RATIO,
  type Benchmark,
  type SignalReading,
} from '@platform/domain';

import { logger } from '../config/logger.js';
import { AppError } from '../errors/AppError.js';
import * as govRepo from '../repositories/gov.repo.js';

/** How many hours the heat map covers, ending with the current one. */
export const ER_WINDOW_HOURS = 24;

/** How far back the benchmark reads (`v_gov_benchmark`). */
export const BENCHMARK_WINDOW_DAYS = 30;

/** What `FR-GOV-01` asks for and nothing records (0026). */
export const UNRECORDED_CAPACITY = ['ventilators', 'blood'] as const;

// ---------------------------------------------------------------------------
// Capacity (FR-GOV-01)
// ---------------------------------------------------------------------------

export interface CapacityTotals {
  readonly facilities: number;
  readonly bedTotal: number;
  readonly bedFree: number;
  readonly icuTotal: number | null;
  readonly icuFree: number | null;
  readonly burnUnitsOpen: number;
  readonly erActive: number;
  readonly bedsAsOf: string | null;
  readonly byKind: readonly govRepo.KindCapacity[];
}

export interface Capacity {
  readonly districts: readonly govRepo.DistrictCapacity[];
  readonly totals: CapacityTotals;
  readonly unrecorded: readonly (typeof UNRECORDED_CAPACITY)[number][];
}

/** `GET /gov/capacity` — the district and national capacity map. */
export async function capacity(): Promise<Capacity> {
  const districts = await govRepo.capacityByDistrict();

  return aggregateOnly('capacity', {
    districts,
    totals: totalsOf(districts),
    unrecorded: UNRECORDED_CAPACITY,
  });
}

/**
 * The national row: every district summed.
 *
 * Its age is the oldest district's, by the rule each district's own age
 * follows (`PRD.md` §3.2) — and null when any district with beds has never
 * confirmed them, because a national total that includes an unconfirmed ward
 * has no honest age.
 */
export function totalsOf(districts: readonly govRepo.DistrictCapacity[]): CapacityTotals {
  const withBeds = districts.filter((district) => district.bedTotal > 0);
  const icu = districts.filter((district) => district.icuTotal !== null);

  const kinds = new Map<string, { total: number; free: number; asOf: string | null; unknown: boolean }>();
  for (const district of districts) {
    for (const entry of district.byKind) {
      const current = kinds.get(entry.kind) ?? { total: 0, free: 0, asOf: null, unknown: false };
      kinds.set(entry.kind, {
        total: current.total + entry.total,
        free: current.free + entry.free,
        asOf: oldest(current.asOf, entry.asOf),
        unknown: current.unknown || entry.asOf === null,
      });
    }
  }

  return {
    facilities: sum(districts.map((district) => district.facilities)),
    bedTotal: sum(districts.map((district) => district.bedTotal)),
    bedFree: sum(districts.map((district) => district.bedFree)),
    icuTotal: icu.length === 0 ? null : sum(icu.map((district) => district.icuTotal ?? 0)),
    icuFree: icu.length === 0 ? null : sum(icu.map((district) => district.icuFree ?? 0)),
    burnUnitsOpen: sum(districts.map((district) => district.burnUnitsOpen)),
    erActive: sum(districts.map((district) => district.erActive)),
    bedsAsOf: withBeds.some((district) => district.bedsAsOf === null)
      ? null
      : withBeds.reduce<string | null>((age, district) => oldest(age, district.bedsAsOf), null),
    byKind: [...kinds.entries()].map(([kind, entry]) => ({
      kind,
      total: entry.total,
      free: entry.free,
      asOf: entry.unknown ? null : entry.asOf,
    })),
  };
}

// ---------------------------------------------------------------------------
// Emergency load (FR-GOV-02)
// ---------------------------------------------------------------------------

export interface ErDistrict extends govRepo.DistrictErNow {
  /** One cell per hour of `hours`, zeros included. */
  readonly hourly: readonly { readonly cases: number; readonly red: number }[];
}

export interface ErLoad {
  readonly windowHours: number;
  /** The start of each hour on the heat map's axis, oldest first, ISO. */
  readonly hours: readonly string[];
  readonly districts: readonly ErDistrict[];
  readonly totals: { readonly open: number; readonly onTheWay: number; readonly red: number };
  /** The busiest single cell, so the screen can scale its shading. */
  readonly peak: number;
}

/** `GET /gov/er-load` — load now, and the last day hour by hour. */
export async function erLoad(now: Date = new Date()): Promise<ErLoad> {
  // Dhaka is UTC+6 exactly, so a UTC hour boundary is a Dhaka one too.
  const current = new Date(now);
  current.setUTCMinutes(0, 0, 0);

  const hours = Array.from({ length: ER_WINDOW_HOURS }, (_unused, index) => {
    const at = new Date(current);
    at.setUTCHours(at.getUTCHours() - (ER_WINDOW_HOURS - 1 - index));
    return at.toISOString();
  });

  const first = hours[0] ?? current.toISOString();
  const rows = await govRepo.erLoad(new Date(first));

  const cells = new Map(rows.hours.map((row) => [`${row.district}|${row.hour}`, row]));

  const districts = rows.now.map((district) => ({
    ...district,
    hourly: hours.map((hour) => {
      const cell = cells.get(`${district.district}|${hour}`);
      return { cases: cell?.cases ?? 0, red: cell?.red ?? 0 };
    }),
  }));

  return aggregateOnly('er-load', {
    windowHours: ER_WINDOW_HOURS,
    hours,
    districts,
    totals: {
      open: sum(districts.map((district) => district.open)),
      onTheWay: sum(districts.map((district) => district.onTheWay)),
      red: sum(districts.map((district) => district.red)),
    },
    peak: Math.max(0, ...districts.flatMap((district) => district.hourly.map((cell) => cell.cases))),
  });
}

// ---------------------------------------------------------------------------
// Symptom signals (FR-GOV-03)
// ---------------------------------------------------------------------------

export interface Signals {
  /** The Dhaka day the window ends on. */
  readonly today: string;
  readonly rule: {
    readonly windowDays: number;
    readonly baselineDays: number;
    readonly minCases: number;
    readonly ratio: number;
  };
  readonly readings: readonly SignalReading[];
  /** The newest signed visit in any reporting district: the feed's age. */
  readonly asOf: string | null;
}

/** `GET /gov/signals` — this week against the usual week, per district. */
export async function signals(now: Date = new Date()): Promise<Signals> {
  const today = time.toDhakaDate(time.fromDate(now));
  const fromDay = shiftDay(today, -(SIGNAL_WINDOW_DAYS - 1 + BASELINE_MAX_DAYS));

  const { days, reporting } = await govRepo.symptomSignals(fromDay);

  return aggregateOnly('signals', {
    today,
    rule: {
      windowDays: SIGNAL_WINDOW_DAYS,
      baselineDays: BASELINE_MAX_DAYS,
      minCases: SPIKE_MIN_CASES,
      ratio: SPIKE_RATIO,
    },
    readings: readSignals(days, reporting, today),
    asOf: reporting.reduce<string | null>((age, row) => newest(age, row.lastSignedAt), null),
  });
}

// ---------------------------------------------------------------------------
// Benchmarking (FR-GOV-04)
// ---------------------------------------------------------------------------

export interface Benchmarks {
  readonly windowDays: number;
  readonly minSample: number;
  /** How many live facilities were considered, named or not. */
  readonly facilities: number;
  readonly measures: readonly Benchmark[];
  /** Computed at this read from live rows. */
  readonly asOf: string;
}

/** `GET /gov/benchmarks` — each measure ranked, no facility named. */
export async function benchmarks(now: Date = new Date()): Promise<Benchmarks> {
  const rows = await govRepo.benchmarkRows();

  return aggregateOnly('benchmarks', {
    windowDays: BENCHMARK_WINDOW_DAYS,
    minSample: MIN_BENCHMARK_SAMPLE,
    facilities: rows.length,
    measures: benchmark(rows),
    asOf: now.toISOString(),
  });
}

// ---------------------------------------------------------------------------
// The last check (FR-GOV-06)
// ---------------------------------------------------------------------------

/** Returns `payload` unchanged, or refuses to send it at all. */
export function aggregateOnly<T>(section: string, payload: T): T {
  const found = findIdentifiers(payload);
  if (found.length > 0) {
    // The paths, never the values: a value here is exactly what must not be
    // written anywhere, a log included.
    logger.error({ section, paths: found }, 'gov payload carried an identifier; refused');
    throw new AppError('INTERNAL', {
      message: 'This figure could not be shown without identifying somebody.',
      details: { reason: 'identifier_in_aggregate', section },
    });
  }
  return payload;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function oldest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function newest(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

function shiftDay(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}
