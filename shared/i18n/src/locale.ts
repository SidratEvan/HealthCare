/**
 * The two locales, and what follows from choosing one (`I18N-01`, `FR-LOC-01`).
 *
 * Bangla is the default, English is the toggle (`GR-06`). Choosing a locale
 * decides three things at once — which half of every message is read, which
 * digits a number is written in, and which of a facility's two names is shown
 * — and each of those used to be a separate constant at the top of every
 * screen. Deriving the other two from the locale here is what lets a single
 * switch change all of them together.
 */

import type { Locale } from './messages.js';
import type { NumeralStyle } from './numerals.js';

/** Both locales, Bangla first because it is the default (`I18N-01`). */
export const LOCALES = ['bn', 'en'] as const satisfies readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'bn';

/**
 * Each language named in itself.
 *
 * Not translated: a person looking for their own language scans for its own
 * script, so "বাংলা" stays বাংলা on the English screen and "English" stays
 * English on the Bangla one. No flags — a flag names a country, and neither
 * language belongs to only one.
 */
export const LANGUAGE_NAMES = {
  bn: 'বাংলা',
  en: 'English',
} as const satisfies Record<Locale, string>;

export function isLocale(value: unknown): value is Locale {
  return value === 'bn' || value === 'en';
}

/**
 * The digits a locale reads in (`TYP-04`, `I18N-04`).
 *
 * Bengali on every Bangla surface, console included since the owner's ruling
 * of 2026-09-24; Latin in English, where a Bengali digit would be the same
 * mixed-script tell §0.2 bans, in reverse.
 */
export function numeralsFor(locale: Locale): NumeralStyle {
  return locale === 'bn' ? 'bengali' : 'latin';
}

/**
 * A name held in both languages, in the one being read.
 *
 * Falls back to Bangla when the English is missing or blank — a facility
 * named in the wrong language is still findable, and an empty heading is not.
 * The Bangla is the name as the facility writes it (`DATABASE.md` §3), so it
 * is the one that can always be relied on to exist.
 */
export function localName(locale: Locale, bn: string, en: string | null | undefined): string {
  if (locale === 'en' && en !== null && en !== undefined && en.trim() !== '') return en;
  return bn;
}
