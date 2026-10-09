/**
 * A patient's own old papers, named (`PRD.md` `FR-PAT-62`; plan R3).
 *
 * One place for the four kinds and for the label every screen puts on a
 * paper the patient gave, so the patient app and a consenting doctor's
 * console call them the same thing.
 */

import type { Locale } from './messages.js';

export const PAPER_KIND_NAMES = {
  prescription: { bn: 'প্রেসক্রিপশন', en: 'Prescription' },
  report: { bn: 'টেস্টের রিপোর্ট', en: 'Test report' },
  discharge: { bn: 'ছাড়পত্র', en: 'Discharge paper' },
  other: { bn: 'অন্যান্য', en: 'Other' },
} as const;

export type PaperKindName = keyof typeof PAPER_KIND_NAMES;

/** Wherever a paper is shown: it is the patient's, never a hospital's record. */
export const PATIENT_PROVIDED = { bn: 'রোগীর দেওয়া কাগজ', en: 'Provided by the patient' } as const;

export function paperKindName(kind: string | null, locale: Locale): string {
  const found = kind === null ? undefined : PAPER_KIND_NAMES[kind as PaperKindName];
  return (found ?? PAPER_KIND_NAMES.other)[locale];
}

/** A paper's own date (`YYYY-MM-DD`) in words, in the screen's language. */
export function paperDate(date: string, locale: Locale): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return date;
  return new Intl.DateTimeFormat(locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
