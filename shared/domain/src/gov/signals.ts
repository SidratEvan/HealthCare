/**
 * Symptom-category spike detection by area (`FR-GOV-03`).
 *
 * "Symptom-category spike detection by area (dengue, diarrhoeal, fever) as an
 * early signal." This file is the arithmetic; `gov.repo` supplies the daily
 * counts from `v_gov_symptom_daily` and `S-B-13` renders what it concludes.
 *
 * No I/O.
 *
 * ## What a spike is, here
 *
 * **This week is at least double the district's usual week, and at least five
 * cases.** "This week" is the seven Dhaka days ending today; "usual" is the
 * average week over up to fourteen days before that. Both halves matter:
 *
 *   - Doubling alone would call one case a spike in a district that usually
 *     has none. Five is the floor below which a count is chance, not a signal.
 *   - A floor alone would call every busy district's ordinary week a spike.
 *
 * It is deliberately the plainest rule that can be explained on the screen in
 * one sentence — "last week 11, usually 3" — because the person reading it is
 * deciding whether to phone a district health office, and a statistic they
 * cannot restate is one they cannot act on. `EARS`-style control charts would
 * need more history than a pitch database has and would dress a guess up as a
 * method. The thresholds are exported and named so they can be tuned in one
 * place; no document fixes them (STATUS, open decisions).
 *
 * ## A baseline needs somebody to have been counting
 *
 * Zero dengue cases last fortnight is a baseline only if the district's
 * facilities were recording visits last fortnight. A district that began
 * reporting on Tuesday has no weeks before this one, and doubling nothing is
 * not a signal — so the answer there is `too_little_history`, never "spike"
 * and never "normal" (`PRD.md` §3.2). At least one full week of reporting
 * before this week is required; with less, the district says so.
 *
 * Every district that reports appears with every category, zero included. A
 * row missing because nothing happened reads, on a surveillance screen, the
 * same as a row missing because nobody looked.
 */

import { SYMPTOM_SIGNALS, type SymptomSignal } from '../types/enums.js';

/** The window a spike is measured over: the last seven Dhaka days. */
export const SIGNAL_WINDOW_DAYS = 7;

/** The longest baseline the rule looks back over, before the window. */
export const BASELINE_MAX_DAYS = 14;

/** The shortest baseline it will compare against: one full week. */
export const BASELINE_MIN_DAYS = 7;

/** Fewest cases in the window that can be called a spike. */
export const SPIKE_MIN_CASES = 5;

/** How many times the usual week the window must reach. */
export const SPIKE_RATIO = 2;

/** One row of `v_gov_symptom_daily`. */
export interface SignalDay {
  readonly division: string;
  readonly district: string;
  readonly signal: SymptomSignal;
  /** Dhaka calendar date, `YYYY-MM-DD`. */
  readonly day: string;
  readonly cases: number;
}

/** One row of `v_gov_reporting`: since when a district has been counted. */
export interface DistrictReporting {
  readonly division: string;
  readonly district: string;
  /** The first Dhaka day any visit in the district was signed. */
  readonly firstDay: string;
}

export type SignalStatus = 'spike' | 'normal' | 'too_little_history';

export interface SignalReading {
  readonly division: string;
  readonly district: string;
  readonly signal: SymptomSignal;
  /** Cases in the last seven days, today included. */
  readonly thisWeek: number;
  /** The district's average week before that, or null with too little history. */
  readonly usualWeek: number | null;
  /** How many days the usual week was averaged over (7–14), or 0. */
  readonly baselineDays: number;
  readonly status: SignalStatus;
  /**
   * Every day of the window and its baseline, oldest first, zeros included —
   * what the screen draws, so a spike is seen against the days before it.
   */
  readonly daily: readonly { readonly day: string; readonly cases: number }[];
}

/**
 * Reads every reporting district's three signals as of `today`.
 *
 * Ordered spikes first, then by district and category, so the screen opens on
 * what somebody may need to act on.
 */
export function readSignals(
  days: readonly SignalDay[],
  reporting: readonly DistrictReporting[],
  today: string,
): SignalReading[] {
  const windowStart = addDays(today, -(SIGNAL_WINDOW_DAYS - 1));
  const earliest = addDays(windowStart, -BASELINE_MAX_DAYS);

  const counts = new Map<string, number>();
  for (const row of days) {
    const key = keyOf(row.district, row.signal, row.day);
    counts.set(key, (counts.get(key) ?? 0) + row.cases);
  }

  const readings: SignalReading[] = [];

  for (const district of reporting) {
    // The baseline starts at whichever is later: the fortnight's first day, or
    // the first day this district was counted at all.
    const baselineStart = district.firstDay > earliest ? district.firstDay : earliest;
    const baselineDays = Math.max(0, daysBetween(baselineStart, windowStart));

    for (const signal of SYMPTOM_SIGNALS) {
      const daily = everyDay(earliest, today).map((day) => ({
        day,
        cases: counts.get(keyOf(district.district, signal, day)) ?? 0,
      }));

      const thisWeek = sum(daily.filter((point) => point.day >= windowStart));
      const baselineCases = sum(
        daily.filter((point) => point.day >= baselineStart && point.day < windowStart),
      );

      const enough = baselineDays >= BASELINE_MIN_DAYS;
      const usualWeek = enough ? (baselineCases * SIGNAL_WINDOW_DAYS) / baselineDays : null;

      readings.push({
        division: district.division,
        district: district.district,
        signal,
        thisWeek,
        usualWeek: usualWeek === null ? null : round1(usualWeek),
        baselineDays: enough ? baselineDays : 0,
        status: usualWeek === null ? 'too_little_history' : statusOf(thisWeek, usualWeek),
        daily,
      });
    }
  }

  return readings.sort(
    (a, b) =>
      rank(a.status) - rank(b.status) ||
      a.district.localeCompare(b.district) ||
      SYMPTOM_SIGNALS.indexOf(a.signal) - SYMPTOM_SIGNALS.indexOf(b.signal),
  );
}

/** The rule, on its own, so a test can state it without building a district. */
export function statusOf(thisWeek: number, usualWeek: number): Exclude<SignalStatus, 'too_little_history'> {
  return thisWeek >= SPIKE_MIN_CASES && thisWeek >= SPIKE_RATIO * usualWeek ? 'spike' : 'normal';
}

function rank(status: SignalStatus): number {
  if (status === 'spike') return 0;
  if (status === 'normal') return 1;
  return 2;
}

function keyOf(district: string, signal: SymptomSignal, day: string): string {
  return `${district}|${signal}|${day}`;
}

function sum(points: readonly { readonly cases: number }[]): number {
  return points.reduce((total, point) => total + point.cases, 0);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** `YYYY-MM-DD` plus whole days. Calendar arithmetic, so UTC is exact. */
function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Whole days from `from` up to, not including, `to`. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

function everyDay(from: string, to: string): string[] {
  const dates: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) dates.push(day);
  return dates;
}
