/**
 * Clock times, the way this country says them (`I18N-05`, `FR-LOC-03`).
 *
 * "Dates and times: 12-hour with Bangla period words (সকাল, দুপুর, বিকাল,
 * সন্ধ্যা, রাত), never 'AM/PM' in Bangla copy."
 *
 * `Intl.DateTimeFormat('bn-BD', { hour, minute })` produces `২:৫৫ PM`: Bengali
 * digits with a Latin day period stuck on the end. That is precisely the
 * half-translated output FRONTEND.md §0.2 is about — it reads as an English
 * interface wearing Bangla numerals, which is worse than either alone.
 *
 * So the period word is chosen here and the digits are formatted here, and no
 * screen does either for itself (`I18N-04`: never hand-convert in a
 * component).
 *
 * ## Why the boundaries are where they are
 *
 * These are the divisions a Bangla speaker actually uses, not a translation of
 * AM and PM. Five o'clock is বিকাল and seven is সন্ধ্যা, and saying বিকাল ৭টা
 * to somebody in Dhaka is as wrong as saying "seven in the morning" for 19:00.
 * §I18N-05 names exactly these five, so there are exactly these five — ভোর is
 * a real word and a real part of the day, and it is deliberately not here.
 */

import { toBengaliDigits, type NumeralStyle } from './numerals.js';

/** Every hospital in this product is in one timezone. */
export const DHAKA = 'Asia/Dhaka';

/** The Bangla parts of the day, by the hour they begin (`I18N-05`). */
export const DAY_PERIODS = [
  { from: 6, to: 12, bn: 'সকাল', en: 'morning' },
  { from: 12, to: 15, bn: 'দুপুর', en: 'midday' },
  { from: 15, to: 18, bn: 'বিকাল', en: 'afternoon' },
  { from: 18, to: 20, bn: 'সন্ধ্যা', en: 'evening' },
] as const;

/** Anything outside the four above: 20:00 through 05:59. */
const NIGHT = { bn: 'রাত', en: 'night' } as const;

/** The Bangla word for the part of the day a 24-hour hour falls in. */
export function dayPeriod(hour24: number): string {
  const found = DAY_PERIODS.find((period) => hour24 >= period.from && hour24 < period.to);
  return found?.bn ?? NIGHT.bn;
}

/**
 * A wall-clock time in Dhaka, as a Bangla sentence says it.
 *
 * `বিকাল ৫:১২` on every Bangla surface (`TYP-04`); `5:12 PM` for the `latin`
 * style, where a period word beside Latin digits would be the same mismatch
 * in reverse.
 *
 * Timestamps are UTC in the database (`DB-P4`); converting for display is a
 * client concern, and this is where it happens.
 */
export function formatClock(iso: string, style: NumeralStyle, timeZone: string = DHAKA): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);

  const hour24 = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';

  if (style === 'latin') {
    const suffix = hour24 < 12 ? 'AM' : 'PM';
    return `${String(to12(hour24))}:${minute} ${suffix}`;
  }

  // Period first, then the time: that is the order the sentence runs in.
  return `${dayPeriod(hour24)} ${toBengaliDigits(`${String(to12(hour24))}:${minute}`)}`;
}

/**
 * A date and a time together, for a booking that is not today.
 *
 * The day and month lead, because the thing a person is checking is *which
 * day* — the time only matters once the date is right.
 */
export function formatDateTime(iso: string, style: NumeralStyle, timeZone: string = DHAKA): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const date = new Intl.DateTimeFormat(style === 'bengali' ? 'bn-BD' : 'en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
  }).format(at);

  return `${date}, ${formatClock(iso, style, timeZone)}`;
}

function to12(hour24: number): number {
  const hour = hour24 % 12;
  return hour === 0 ? 12 : hour;
}
