/**
 * What emergencies, capabilities and triage colours are called
 * (`CHIP-A10-<type>`, `SW-B07-<capability>`, `BTN-B07-TRIAGE-<c>`).
 *
 * One definition for the patient app and the ER console, for the reason
 * `beds.ts` gives: a family who tapped দগ্ধ should see the ER console's alert
 * say দগ্ধ, not a synonym a coordinator has to translate in a hurry.
 *
 * The problem names are `APP_FLOW.md` A6's list word for word. Capabilities
 * use the words painted on a hospital's own signs — বার্ন ইউনিট, ক্যাথ ল্যাব —
 * rather than translated phrases nobody at a desk would say.
 */

import type { Locale, Message } from './messages.js';

/** `FR-PAT-42`, in the order `CHIP-A10-<type>` lists them. */
export const EMERGENCY_PROBLEM_NAMES = {
  burn: { bn: 'দগ্ধ', en: 'Burn' },
  accident: { bn: 'দুর্ঘটনা', en: 'Accident' },
  cardiac: { bn: 'হৃদরোগ', en: 'Heart' },
  stroke: { bn: 'স্ট্রোক', en: 'Stroke' },
  breathing: { bn: 'শ্বাসকষ্ট', en: 'Breathing' },
  child: { bn: 'শিশু', en: 'Child' },
  obstetric: { bn: 'প্রসূতি', en: 'Pregnancy' },
  other: { bn: 'অন্যান্য', en: 'Other' },
} as const satisfies Record<string, Message>;

export type EmergencyProblemName = keyof typeof EMERGENCY_PROBLEM_NAMES;

export function problemName(problem: EmergencyProblemName, locale: Locale): string {
  return EMERGENCY_PROBLEM_NAMES[problem][locale];
}

/** `capability_kind` (DATABASE.md §1), as a coordinator and a family read it. */
export const CAPABILITY_NAMES = {
  burn_unit: { bn: 'বার্ন ইউনিট', en: 'Burn unit' },
  cardiac: { bn: 'হৃদরোগ চিকিৎসা', en: 'Cardiac care' },
  cath_lab: { bn: 'ক্যাথ ল্যাব', en: 'Cath lab' },
  stroke: { bn: 'স্ট্রোক চিকিৎসা', en: 'Stroke care' },
  dialysis: { bn: 'ডায়ালাইসিস', en: 'Dialysis' },
  nicu: { bn: 'এনআইসিইউ', en: 'NICU' },
  trauma_ot: { bn: 'ট্রমা ওটি', en: 'Trauma OT' },
  blood_bank: { bn: 'ব্লাড ব্যাংক', en: 'Blood bank' },
  ambulance: { bn: 'অ্যাম্বুলেন্স', en: 'Ambulance' },
  isolation: { bn: 'আইসোলেশন', en: 'Isolation' },
} as const satisfies Record<string, Message>;

export type CapabilityName = keyof typeof CAPABILITY_NAMES;

export function capabilityName(kind: CapabilityName, locale: Locale): string {
  return CAPABILITY_NAMES[kind][locale];
}

/**
 * `triage_color`. Always shown as a word inside its colour, never as colour
 * alone (FRONTEND.md §6.5's rule for bed tiles, applied here for the same
 * reason: a colour-blind coordinator triages too).
 */
export const TRIAGE_NAMES = {
  red: { bn: 'লাল', en: 'Red' },
  yellow: { bn: 'হলুদ', en: 'Yellow' },
  green: { bn: 'সবুজ', en: 'Green' },
} as const satisfies Record<string, Message>;

export type TriageName = keyof typeof TRIAGE_NAMES;

export function triageName(colour: TriageName, locale: Locale): string {
  return TRIAGE_NAMES[colour][locale];
}
