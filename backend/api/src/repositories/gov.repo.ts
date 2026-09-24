/**
 * Every query behind `S-B-13` (`FR-GOV-01`..`FR-GOV-06`, BACKEND.md §7.7).
 *
 * SQL only, no decisions (BACKEND.md §3). The aggregation is in the six
 * `v_gov_*` views (migration 0026); this file reads them and nothing else.
 *
 * ## Every read runs as `gov_reader`
 *
 * `DATABASE.md` §5: "`gov_viewer` may read only the aggregate views, never
 * base tables." Each function here opens a read-only transaction and switches
 * to `gov_reader` for its length (`SET LOCAL ROLE`), a role with SELECT on
 * those six views and no other table in the database. So the rule is not held
 * by this file being careful — a query here that named `patients`, `bookings`
 * or `visits` would be refused by PostgreSQL with "permission denied", and the
 * test that proves it is in `gov.routes.test.ts`. The role reverts when the
 * transaction ends, so the connection goes back to the pool as it came.
 *
 * ## No identifier crosses this file
 *
 * The views carry none (0026). The rows below are districts, hours, days and
 * facility kinds; there is no id of any sort to select, and the service checks
 * the assembled payload again before it leaves (`findIdentifiers`).
 */

import { sql } from 'kysely';

import { SYMPTOM_SIGNALS, type FacilityKind, type SymptomSignal } from '@platform/domain';

import { db } from '../config/db.js';

import type { Tx } from './transaction.js';

/** Runs `body` read-only, as `gov_reader`, and switches back afterwards. */
async function asGovReader<T>(body: (tx: Tx) => Promise<T>): Promise<T> {
  return await db.transaction().execute(async (tx) => {
    await sql`SET TRANSACTION READ ONLY`.execute(tx);
    await sql`SET LOCAL ROLE gov_reader`.execute(tx);
    return await body(tx);
  });
}

// ---------------------------------------------------------------------------
// Capacity (FR-GOV-01)
// ---------------------------------------------------------------------------

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

export async function capacityByDistrict(): Promise<DistrictCapacity[]> {
  return await asGovReader(async (tx) => {
    const result = await sql<{
      division: string;
      district: string;
      facilities: number;
      bed_total: number;
      bed_free: number;
      icu_total: number | null;
      icu_free: number | null;
      burn_units_open: number;
      er_active: number;
      beds_as_of: Date | null;
      capability_as_of: Date | null;
      by_kind: { kind: string; total: number; free: number; asOf: string | null }[];
    }>`
      SELECT division, district, facilities, bed_total, bed_free, icu_total,
             icu_free, burn_units_open, er_active, beds_as_of, capability_as_of,
             by_kind
        FROM v_gov_capacity
       ORDER BY division, district
    `.execute(tx);

    return result.rows.map((row) => ({
      division: row.division,
      district: row.district,
      facilities: row.facilities,
      bedTotal: row.bed_total,
      bedFree: row.bed_free,
      icuTotal: row.icu_total,
      icuFree: row.icu_free,
      burnUnitsOpen: row.burn_units_open,
      erActive: row.er_active,
      bedsAsOf: row.beds_as_of?.toISOString() ?? null,
      capabilityAsOf: row.capability_as_of?.toISOString() ?? null,
      byKind: row.by_kind.map((entry) => ({
        kind: entry.kind,
        total: entry.total,
        free: entry.free,
        // jsonb carries the stamp as PostgreSQL's text form; normalised so
        // every timestamp this API sends is the same ISO shape.
        asOf: entry.asOf === null ? null : new Date(entry.asOf).toISOString(),
      })),
    }));
  });
}

// ---------------------------------------------------------------------------
// Emergency load (FR-GOV-02)
// ---------------------------------------------------------------------------

export interface DistrictErNow {
  readonly division: string;
  readonly district: string;
  readonly open: number;
  readonly onTheWay: number;
  readonly red: number;
  readonly asOf: string | null;
}

export interface ErHour {
  readonly district: string;
  /** The hour's start, ISO. */
  readonly hour: string;
  readonly cases: number;
  readonly red: number;
}

export async function erLoad(since: Date): Promise<{
  readonly now: DistrictErNow[];
  readonly hours: ErHour[];
}> {
  return await asGovReader(async (tx) => {
    const now = await sql<{
      division: string;
      district: string;
      open: number;
      on_the_way: number;
      red: number;
      as_of: Date | null;
    }>`
      SELECT division, district, open, on_the_way, red, as_of
        FROM v_gov_er_now
       ORDER BY division, district
    `.execute(tx);

    const hours = await sql<{ district: string; hour: Date; cases: number; red: number }>`
      SELECT district, hour, cases, red
        FROM v_gov_er_hourly
       WHERE hour >= ${since}
       ORDER BY district, hour
    `.execute(tx);

    return {
      now: now.rows.map((row) => ({
        division: row.division,
        district: row.district,
        open: row.open,
        onTheWay: row.on_the_way,
        red: row.red,
        asOf: row.as_of?.toISOString() ?? null,
      })),
      hours: hours.rows.map((row) => ({
        district: row.district,
        hour: row.hour.toISOString(),
        cases: row.cases,
        red: row.red,
      })),
    };
  });
}

// ---------------------------------------------------------------------------
// Symptom signals (FR-GOV-03)
// ---------------------------------------------------------------------------

export interface SymptomDay {
  readonly division: string;
  readonly district: string;
  readonly signal: SymptomSignal;
  readonly day: string;
  readonly cases: number;
}

export interface Reporting {
  readonly division: string;
  readonly district: string;
  readonly firstDay: string;
  readonly lastSignedAt: string | null;
}

export async function symptomSignals(fromDay: string): Promise<{
  readonly days: SymptomDay[];
  readonly reporting: Reporting[];
}> {
  return await asGovReader(async (tx) => {
    const days = await sql<{
      division: string;
      district: string;
      signal: string;
      day: string;
      cases: number;
    }>`
      SELECT division, district, signal, day::text AS day, cases
        FROM v_gov_symptom_daily
       WHERE day >= ${fromDay}::date
       ORDER BY district, signal, day
    `.execute(tx);

    const reporting = await sql<{
      division: string;
      district: string;
      first_day: string;
      last_signed_at: Date | null;
    }>`
      SELECT division, district, first_day::text AS first_day, last_signed_at
        FROM v_gov_reporting
       ORDER BY division, district
    `.execute(tx);

    return {
      days: days.rows.filter(isKnownSignal).map((row) => ({
        division: row.division,
        district: row.district,
        signal: row.signal,
        day: row.day,
        cases: row.cases,
      })),
      reporting: reporting.rows.map((row) => ({
        division: row.division,
        district: row.district,
        firstDay: row.first_day,
        lastSignedAt: row.last_signed_at?.toISOString() ?? null,
      })),
    };
  });
}

/** The enum is the contract (`db:verify`); this only narrows the type. */
function isKnownSignal<T extends { signal: string }>(row: T): row is T & { signal: SymptomSignal } {
  return (SYMPTOM_SIGNALS as readonly string[]).includes(row.signal);
}

// ---------------------------------------------------------------------------
// Benchmarking (FR-GOV-04)
// ---------------------------------------------------------------------------

export interface BenchmarkRow {
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

export async function benchmarkRows(): Promise<BenchmarkRow[]> {
  return await asGovReader(async (tx) => {
    const result = await sql<{
      kind: FacilityKind;
      avg_wait_minutes: number | null;
      waits_measured: number;
      median_turnaround_hours: number | null;
      turnarounds_measured: number;
      wait_score: number | null;
      doctor_score: number | null;
      cleanliness_score: number | null;
      billing_score: number | null;
      responses: number;
    }>`
      SELECT kind, avg_wait_minutes, waits_measured, median_turnaround_hours,
             turnarounds_measured, wait_score, doctor_score, cleanliness_score,
             billing_score, responses
        FROM v_gov_benchmark
    `.execute(tx);

    return result.rows.map((row) => ({
      kind: row.kind,
      avgWaitMinutes: row.avg_wait_minutes,
      waitsMeasured: row.waits_measured,
      medianTurnaroundHours: row.median_turnaround_hours,
      turnaroundsMeasured: row.turnarounds_measured,
      waitScore: row.wait_score,
      doctorScore: row.doctor_score,
      cleanlinessScore: row.cleanliness_score,
      billingScore: row.billing_score,
      responses: row.responses,
    }));
  });
}
