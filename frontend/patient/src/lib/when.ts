/**
 * When a chamber sits, as a person checks it: which day first, then the hours.
 *
 * "আজ", "কাল", or the weekday and date; then "বিকাল ৫:০০ – রাত ৯:০০". All in
 * Dhaka's time (`DB-P4`: timestamps are UTC in the database, and converting is
 * the client's job), and in the screen's numerals (`TYP-04`).
 */

import { formatClock, numeralsFor, tp, type Locale } from '@platform/i18n';

const DHAKA = 'Asia/Dhaka';

/** The calendar day an instant falls on in Dhaka, as YYYY-MM-DD. */
function dhakaDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DHAKA }).format(at);
}

export function sessionDay(iso: string, locale: Locale, now: Date = new Date()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = dhakaDay(at);
  if (day === dhakaDay(now)) return tp('dayToday', locale);
  if (day === dhakaDay(new Date(now.getTime() + 86_400_000))) return tp('dayTomorrow', locale);
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: DHAKA,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(at);
}

export function sessionHours(startIso: string, endIso: string | null, locale: Locale): string {
  const numerals = numeralsFor(locale);
  const start = formatClock(startIso, numerals);
  return endIso === null ? start : `${start} – ${formatClock(endIso, numerals)}`;
}
