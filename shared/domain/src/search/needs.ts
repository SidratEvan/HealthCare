/**
 * What a patient can ask the network for (`FR-PAT-16`–`18`, `S-A-07s`).
 *
 * A *need* is one of the three things hospitals publish live and a person
 * searches by: a specialty (who is sitting, how many serials are open), a bed
 * kind (how many are free), or an emergency capability (whether it is there,
 * and when that was last confirmed). Nothing else is offered, because nothing
 * else is in the data: a need this file does not name is a need no hospital
 * can be shown to meet (`FR-PAT-18`).
 *
 * ## Why words are matched here and not in SQL
 *
 * Somebody types "ICU", "আইসিইউ" or "burn". None of those is a hospital's
 * name or a doctor's; they are names for a need. The list of other names is
 * small, known and bilingual, so it is a table in the one package both sides
 * import: the API uses it to read a query, and the patient app uses the same
 * table to offer a need while the person is still typing.
 *
 * Matching is deterministic on purpose (`FR-PAT-18`). The text as typed,
 * folded for case and spacing, against a fixed list. No distance metric and no
 * guessing: a wrong guess here sends a family to the wrong hospital.
 */

import { BED_KINDS, CAPABILITY_KINDS, type BedKind, type CapabilityKind } from '../types/enums.js';
import { SPECIALTIES, isSpecialtyCode, type SpecialtyCode } from '../types/specialties.js';

export type SearchNeed =
  | { readonly kind: 'specialty'; readonly code: SpecialtyCode }
  | { readonly kind: 'bed'; readonly bedKind: BedKind }
  | { readonly kind: 'capability'; readonly capability: CapabilityKind };

/**
 * The capabilities a patient searches by.
 *
 * Not `blood_bank` and not `ambulance`: a hospital still lists both among
 * what it has, but a search for either reads as the blood and ambulance
 * services, which are outside V1 (`PRD.md` §7.8). `nicu` is offered as a bed
 * kind instead, where the answer is a number of free cots rather than a yes.
 */
export const SEARCH_CAPABILITIES = [
  'burn_unit',
  'cardiac',
  'cath_lab',
  'stroke',
  'dialysis',
  'trauma_ot',
  'isolation',
] as const satisfies readonly CapabilityKind[];

/** The bed kinds a patient searches by, most asked for first. */
export const SEARCH_BED_KINDS = [
  'icu',
  'ccu',
  'nicu',
  'hdu',
  'cabin',
  'general',
  'burn',
] as const satisfies readonly BedKind[];

/** A need as one string, for a URL and for a key: `specialty:CARD`, `bed:icu`. */
export function needKey(need: SearchNeed): string {
  switch (need.kind) {
    case 'specialty':
      return `specialty:${need.code}`;
    case 'bed':
      return `bed:${need.bedKind}`;
    case 'capability':
      return `capability:${need.capability}`;
  }
}

/** The reverse of `needKey`. Null for anything that is not a need we hold. */
export function parseNeed(key: string): SearchNeed | null {
  const at = key.indexOf(':');
  if (at === -1) return null;
  const kind = key.slice(0, at);
  const value = key.slice(at + 1);

  if (kind === 'specialty') {
    return isSpecialtyCode(value) ? { kind: 'specialty', code: value } : null;
  }
  if (kind === 'bed') {
    return (BED_KINDS as readonly string[]).includes(value)
      ? { kind: 'bed', bedKind: value as BedKind }
      : null;
  }
  if (kind === 'capability') {
    return (CAPABILITY_KINDS as readonly string[]).includes(value)
      ? { kind: 'capability', capability: value as CapabilityKind }
      : null;
  }
  return null;
}

/**
 * Other names for each need, in both languages, already folded.
 *
 * The specialty's own names (`SPECIALTIES`) are added below, so this lists
 * only what a person says instead: "heart" for cardiology, "হাড়" for
 * orthopaedics. Keep an entry only if it can mean one need and nothing else.
 */
const OTHER_NAMES: Readonly<Record<string, readonly string[]>> = {
  'specialty:CARD': ['cardiologist', 'heart', 'heart doctor', 'কার্ডিওলজিস্ট', 'হৃদরোগ', 'হার্ট'],
  'specialty:MED': ['medicine doctor', 'physician', 'মেডিসিন ডাক্তার'],
  'specialty:GYN': ['gynae', 'gynecology', 'gynaecologist', 'gynecologist', 'গাইনি', 'স্ত্রীরোগ'],
  'specialty:ORTHO': [
    'ortho',
    'orthopedics',
    'orthopaedic',
    'orthopedic',
    'bone',
    'অর্থোপেডিক',
    'হাড়',
  ],
  'specialty:PAED': ['pediatrics', 'paediatrician', 'pediatrician', 'child doctor', 'শিশু ডাক্তার'],
  'specialty:NEURO': ['neuro', 'neurologist', 'নিউরো', 'স্নায়ু'],
  'specialty:ENT': ['ear nose throat', 'ইএনটি'],
  'specialty:DERM': ['derm', 'dermatologist', 'skin', 'চর্ম', 'ত্বক'],

  'bed:icu': ['icu', 'intensive care', 'আইসিইউ'],
  'bed:ccu': ['ccu', 'coronary care', 'সিসিইউ'],
  'bed:nicu': ['nicu', 'newborn icu', 'এনআইসিইউ'],
  'bed:hdu': ['hdu', 'high dependency', 'এইচডিইউ'],
  'bed:cabin': ['cabin', 'কেবিন'],
  'bed:general': ['bed', 'beds', 'ward', 'general bed', 'বেড', 'শয্যা', 'ওয়ার্ড', 'সাধারণ বেড'],
  'bed:burn': ['burn bed', 'বার্ন বেড'],

  'capability:burn_unit': ['burn', 'burn unit', 'burns', 'বার্ন', 'বার্ন ইউনিট', 'পোড়া'],
  'capability:cardiac': ['cardiac', 'cardiac emergency', 'heart attack', 'হার্ট অ্যাটাক'],
  'capability:cath_lab': ['cath lab', 'cathlab', 'angiogram', 'ক্যাথ ল্যাব', 'এনজিওগ্রাম'],
  'capability:stroke': ['stroke', 'stroke unit', 'স্ট্রোক'],
  'capability:dialysis': ['dialysis', 'ডায়ালাইসিস'],
  'capability:trauma_ot': ['trauma', 'trauma ot', 'ট্রমা'],
  'capability:isolation': ['isolation', 'আইসোলেশন'],
};

/**
 * Folds what somebody typed: one case, one kind of space, no edge punctuation.
 *
 * NFC first, because a Bangla letter with a vowel sign can arrive as one code
 * point or as two depending on the keyboard, and the two must compare equal.
 */
export function foldSearchText(raw: string): string {
  return raw
    .normalize('NFC')
    .toLowerCase()
    .replace(/[.,;:!?'"()[\]{}]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface NamedNeed {
  readonly need: SearchNeed;
  readonly names: readonly string[];
}

function buildNames(): readonly NamedNeed[] {
  const named: NamedNeed[] = [];

  for (const [key, others] of Object.entries(OTHER_NAMES)) {
    const need = parseNeed(key);
    if (need === null) throw new Error(`Unknown need in the search names: ${key}`);

    const own =
      need.kind === 'specialty'
        ? SPECIALTIES.filter((entry) => entry.code === need.code).flatMap((entry) => [
            entry.nameBn,
            entry.nameEn,
          ])
        : [];

    named.push({ need, names: [...own, ...others].map(foldSearchText) });
  }

  return named;
}

const NAMED: readonly NamedNeed[] = buildNames();

/** What a line of typed text is asking for. */
export interface SearchReading {
  /** The need the whole text names, if it names exactly one. */
  readonly need: SearchNeed | null;
  /** The text to match names against; null when nothing was typed. */
  readonly text: string | null;
}

/**
 * Reads typed text as a need when the whole of it is a name for one.
 *
 * Whole text, not a word inside it: "burn" is a need, "Dr Burnett" is a
 * person. The text is always kept as well, so a caller can still match it
 * against names — a hospital called "Heart Foundation" is found by "heart"
 * whether or not "heart" is also read as cardiology.
 */
export function readSearch(raw: string | null | undefined): SearchReading {
  const folded = foldSearchText(raw ?? '');
  if (folded === '') return { need: null, text: null };

  const matches = NAMED.filter((entry) => entry.names.includes(folded));
  const need = matches.length === 1 ? (matches[0]?.need ?? null) : null;

  return { need, text: (raw ?? '').normalize('NFC').trim() };
}

/**
 * Needs to offer while somebody is still typing (`S-A-07s`).
 *
 * A need is offered when one of its names starts with what has been typed, or
 * a word of one does: "card" offers cardiology, "unit" offers the burn unit.
 * Two characters at least, because one letter offers everything.
 */
export function suggestNeeds(raw: string, limit = 4): readonly SearchNeed[] {
  const folded = foldSearchText(raw);
  if (folded.length < 2) return [];

  const exact: SearchNeed[] = [];
  const starts: SearchNeed[] = [];
  const within: SearchNeed[] = [];

  for (const entry of NAMED) {
    if (entry.names.includes(folded)) exact.push(entry.need);
    else if (entry.names.some((name) => name.startsWith(folded))) starts.push(entry.need);
    else if (entry.names.some((name) => name.split(' ').some((word) => word.startsWith(folded)))) {
      within.push(entry.need);
    }
  }

  return [...exact, ...starts, ...within].slice(0, limit);
}
