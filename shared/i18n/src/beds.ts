/**
 * What each kind of bed is called (`CHIP-A11-<type>`, `FR-PAT-50`).
 *
 * One definition shared by the patient app, the ward console and the SMS that
 * answers a bed request, because a family told by text that an "ICU" bed is
 * held for them should see the same word on the screen they open next.
 *
 * The Bangla is the transliteration `APP_FLOW.md` A7 lists — এইচডিইউ, not a
 * translated phrase for "high-dependency unit" — because that is what is
 * painted on the ward door and what a relative will be told at the desk.
 */

import type { Locale, Message } from './messages.js';

export const BED_KIND_NAMES = {
  general: { bn: 'সাধারণ', en: 'General' },
  cabin: { bn: 'কেবিন', en: 'Cabin' },
  hdu: { bn: 'এইচডিইউ', en: 'HDU' },
  icu: { bn: 'আইসিইউ', en: 'ICU' },
  ccu: { bn: 'সিসিইউ', en: 'CCU' },
  nicu: { bn: 'এনআইসিইউ', en: 'NICU' },
  isolation: { bn: 'আইসোলেশন', en: 'Isolation' },
  burn: { bn: 'বার্ন', en: 'Burn' },
} as const satisfies Record<string, Message>;

export type BedKindName = keyof typeof BED_KIND_NAMES;

export function bedKindName(kind: BedKindName, locale: Locale): string {
  return BED_KIND_NAMES[kind][locale];
}
