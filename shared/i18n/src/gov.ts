/**
 * What the national layer names things (`S-B-13`, `CHIP-B05-SIGNAL`).
 *
 * Places, the three symptom categories `FR-GOV-03` counts, and the kinds of
 * facility an anonymised benchmark is allowed to say (`FR-GOV-04`). One
 * definition for the government screen and the doctor's chip, for the reason
 * `emergency.ts` gives: the word a doctor tapped should be the word the
 * district reads.
 *
 * ## Places
 *
 * `hospitals.division` and `.district` are stored in English, as the schema
 * and the seeds' `DEMO_DISTRICTS` have them, and shown in Bangla here. The
 * eight divisions are all listed; the districts are the ones the demo set
 * declares, and a district not in the list is shown as stored rather than
 * dropped — a national map with a row missing reads as a district with
 * nothing in it. Adding a district to the seeds means adding its name here.
 */

import type { Locale, Message } from './messages.js';

/** The eight administrative divisions of Bangladesh. */
export const DIVISION_NAMES = {
  Dhaka: { bn: 'ঢাকা', en: 'Dhaka' },
  Chattogram: { bn: 'চট্টগ্রাম', en: 'Chattogram' },
  Khulna: { bn: 'খুলনা', en: 'Khulna' },
  Rajshahi: { bn: 'রাজশাহী', en: 'Rajshahi' },
  Sylhet: { bn: 'সিলেট', en: 'Sylhet' },
  Barishal: { bn: 'বরিশাল', en: 'Barishal' },
  Rangpur: { bn: 'রংপুর', en: 'Rangpur' },
  Mymensingh: { bn: 'ময়মনসিংহ', en: 'Mymensingh' },
} as const satisfies Record<string, Message>;

/** The districts the demo set declares (`database/seeds/data/reference.ts`). */
export const DISTRICT_NAMES = {
  Dhaka: { bn: 'ঢাকা', en: 'Dhaka' },
  Narayanganj: { bn: 'নারায়ণগঞ্জ', en: 'Narayanganj' },
  Gazipur: { bn: 'গাজীপুর', en: 'Gazipur' },
  Chattogram: { bn: 'চট্টগ্রাম', en: 'Chattogram' },
} as const satisfies Record<string, Message>;

export function divisionName(division: string, locale: Locale): string {
  return (DIVISION_NAMES as Record<string, Message | undefined>)[division]?.[locale] ?? division;
}

export function districtName(district: string, locale: Locale): string {
  return (DISTRICT_NAMES as Record<string, Message | undefined>)[district]?.[locale] ?? district;
}

/** `symptom_signal` (0025): the three categories `FR-GOV-03` names. */
export const SYMPTOM_SIGNAL_NAMES = {
  dengue: { bn: 'ডেঙ্গু', en: 'Dengue' },
  diarrhoeal: { bn: 'ডায়রিয়া', en: 'Diarrhoeal' },
  fever: { bn: 'জ্বর', en: 'Fever' },
} as const satisfies Record<string, Message>;

export type SymptomSignalName = keyof typeof SYMPTOM_SIGNAL_NAMES;

export function symptomSignalName(signal: SymptomSignalName, locale: Locale): string {
  return SYMPTOM_SIGNAL_NAMES[signal][locale];
}

/**
 * `facility_kind` — the only thing an anonymised benchmark says about a
 * facility (`FR-GOV-04`, `v_gov_benchmark`).
 */
export const FACILITY_KIND_NAMES = {
  hospital: { bn: 'বেসরকারি হাসপাতাল', en: 'Private hospital' },
  clinic: { bn: 'ক্লিনিক', en: 'Clinic' },
  diagnostic: { bn: 'ডায়াগনস্টিক সেন্টার', en: 'Diagnostic centre' },
  government: { bn: 'সরকারি হাসপাতাল', en: 'Government hospital' },
} as const satisfies Record<string, Message>;

export type FacilityKindName = keyof typeof FACILITY_KIND_NAMES;

export function facilityKindName(kind: FacilityKindName, locale: Locale): string {
  return FACILITY_KIND_NAMES[kind][locale];
}
