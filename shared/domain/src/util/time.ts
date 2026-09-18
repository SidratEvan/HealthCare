/**
 * Time helpers. UTC in, UTC out (DB-P4), with Asia/Dhaka conversion for
 * display and for "which day is it" questions.
 *
 * Bangladesh Standard Time is UTC+06:00 with no daylight saving. The country
 * tried DST once, in 2009, and abandoned it. So the offset is a constant here
 * rather than an `Intl.DateTimeFormat` lookup, for two reasons: the domain has
 * to be deterministic under replay (FR-QUE-05) and identical on a server, a
 * cheap Android browser and a CI container, and an ICU time-zone database is
 * none of those things — it varies by runtime build.
 *
 * If Bangladesh ever reintroduces DST, this constant is the one place to
 * change, and the tests below it will tell you what else moves.
 */

import type { DhakaDate, Timestamp } from '../types/ids.js';

/** Asia/Dhaka's fixed offset from UTC, in minutes. */
export const DHAKA_UTC_OFFSET_MINUTES = 360;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;

/** Parses a `Timestamp` into epoch milliseconds. Throws on a malformed value. */
export function toEpochMs(value: Timestamp): number {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new TypeError(`Not an ISO-8601 instant: ${String(value)}`);
  }
  return ms;
}

/** Formats epoch milliseconds as a UTC `Timestamp`. */
export function fromEpochMs(ms: number): Timestamp {
  if (!Number.isFinite(ms)) {
    throw new TypeError(`Not a finite epoch: ${String(ms)}`);
  }
  return new Date(ms).toISOString() as Timestamp;
}

/** A `Date` as a `Timestamp`. The one place a Date crosses into the domain. */
export function fromDate(date: Date): Timestamp {
  return fromEpochMs(date.getTime());
}

export function addSeconds(value: Timestamp, seconds: number): Timestamp {
  return fromEpochMs(toEpochMs(value) + Math.round(seconds) * MS_PER_SECOND);
}

export function addMinutes(value: Timestamp, minutes: number): Timestamp {
  return fromEpochMs(toEpochMs(value) + Math.round(minutes * MS_PER_MINUTE));
}

/** Seconds from `from` to `to`. Negative when `to` is earlier. */
export function differenceInSeconds(to: Timestamp, from: Timestamp): number {
  return Math.round((toEpochMs(to) - toEpochMs(from)) / MS_PER_SECOND);
}

/** Minutes from `from` to `to`, rounded to the nearest minute. */
export function differenceInMinutes(to: Timestamp, from: Timestamp): number {
  return Math.round((toEpochMs(to) - toEpochMs(from)) / MS_PER_MINUTE);
}

/**
 * Whole hours between two instants, truncated toward zero.
 *
 * Used by the offline sync rule that forces a full re-pull past a day away
 * (`SY-06`). Truncating rather than rounding matters there: a device 23.9
 * hours behind is still inside the window, and rounding up would push it into
 * a re-pull it does not need.
 */
export function differenceInHours(to: Timestamp, from: Timestamp): number {
  return Math.trunc(differenceInMinutes(to, from) / 60);
}

/** The later of two instants. */
export function maxTimestamp(a: Timestamp, b: Timestamp): Timestamp {
  return toEpochMs(a) >= toEpochMs(b) ? a : b;
}

/** The earlier of two instants. */
export function minTimestamp(a: Timestamp, b: Timestamp): Timestamp {
  return toEpochMs(a) <= toEpochMs(b) ? a : b;
}

export function isBefore(a: Timestamp, b: Timestamp): boolean {
  return toEpochMs(a) < toEpochMs(b);
}

export function isAfter(a: Timestamp, b: Timestamp): boolean {
  return toEpochMs(a) > toEpochMs(b);
}

/**
 * The calendar date in Asia/Dhaka that an instant falls on.
 *
 * This is the `session_date` a receptionist means by "today". An evening
 * chamber running past midnight UTC is still the same working day in Dhaka,
 * which is exactly why the column exists rather than being derived from
 * `planned_start` at query time.
 */
export function toDhakaDate(value: Timestamp): DhakaDate {
  const shifted = new Date(toEpochMs(value) + DHAKA_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return shifted.toISOString().slice(0, 10) as DhakaDate;
}

/** Wall-clock hour and minute in Asia/Dhaka, for display and for templates. */
export function toDhakaClock(value: Timestamp): { hour: number; minute: number } {
  const shifted = new Date(toEpochMs(value) + DHAKA_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  return { hour: shifted.getUTCHours(), minute: shifted.getUTCMinutes() };
}

/**
 * The UTC instant of a Dhaka wall-clock time on a Dhaka date.
 *
 * Used when materialising sessions from templates: a template says "17:00 on
 * Tuesdays" in the only clock a hospital thinks in, and this turns that into
 * the instant stored in the database.
 */
export function fromDhakaWallClock(date: DhakaDate, hour: number, minute: number): Timestamp {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new TypeError(`Not a YYYY-MM-DD date: ${String(date)}`);
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new RangeError(`Hour out of range: ${String(hour)}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new RangeError(`Minute out of range: ${String(minute)}`);
  }

  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  return fromEpochMs(midnightUtc + (hour * 60 + minute - DHAKA_UTC_OFFSET_MINUTES) * MS_PER_MINUTE);
}

/**
 * ISO-8601 weekday in Asia/Dhaka: 1 = Monday … 7 = Sunday.
 *
 * Matches `session_templates.weekday`, which is stored in ISO form rather than
 * PostgreSQL's 0-6 `dow` precisely so that this function and that column
 * cannot drift by one and publish a chamber on the wrong day.
 */
export function dhakaWeekday(value: Timestamp): number {
  const shifted = new Date(toEpochMs(value) + DHAKA_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
  const sundayZero = shifted.getUTCDay();
  return sundayZero === 0 ? 7 : sundayZero;
}

/**
 * Rounds an instant down to the nearest whole minute.
 *
 * ETAs are shown to the minute, and a value that jitters between 6:04:59 and
 * 6:05:01 on consecutive recalculations looks like the system changing its
 * mind (FR-QUE-13).
 */
export function floorToMinute(value: Timestamp): Timestamp {
  const ms = toEpochMs(value);
  return fromEpochMs(ms - (ms % MS_PER_MINUTE));
}
