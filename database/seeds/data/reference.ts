/**
 * Reference data the demo set is built from — the `districts` half of
 * `seed_00_reference.sql` (DATABASE.md §7).
 *
 * It lives in TypeScript rather than in that SQL file because the schema has
 * no `districts` table and DATABASE.md §2 defines none: `hospitals.division`
 * and `hospitals.district` are text, and `blood_donors.district` (0011) will be
 * too. So the canonical list is a list, consumed where a row is written, and
 * a division/district pair that is not in it is a typo rather than a new place.
 *
 * Nothing here is clinical content or a statistic. Divisions, districts and
 * coordinates are public geography (CLAUDE.md §8).
 */

/** The eight administrative divisions of Bangladesh. */
export const DIVISIONS = [
  'Dhaka',
  'Chattogram',
  'Khulna',
  'Rajshahi',
  'Sylhet',
  'Barishal',
  'Rangpur',
  'Mymensingh',
] as const;

export type Division = (typeof DIVISIONS)[number];

/**
 * The districts the demo set places a row in.
 *
 * Deliberately not all sixty-four: a district appears here when a demo
 * facility, session or donor is in it, so the list and the data cannot drift
 * apart. Add a district when something is seeded there.
 */
export const DEMO_DISTRICTS: readonly { readonly division: Division; readonly district: string }[] =
  [
    { division: 'Dhaka', district: 'Dhaka' },
    { division: 'Dhaka', district: 'Narayanganj' },
    { division: 'Dhaka', district: 'Gazipur' },
    { division: 'Chattogram', district: 'Chattogram' },
  ];

/** True when this division/district pair is one the demo set declares. */
export function isDeclaredDistrict(division: string, district: string): boolean {
  return DEMO_DISTRICTS.some((entry) => entry.division === division && entry.district === district);
}

/**
 * The eight specialties `FR-DEM-02` names.
 *
 * Re-exported from `@platform/domain` rather than listed again here. The code
 * is what `departments.code` carries, what a discovery query filters on, and
 * what a patient app puts in a URL — so a specialty the seeds knew about and
 * the API did not would be a department nobody could search for.
 */
export {
  SPECIALTIES,
  specialtyOf as specialty,
  type Specialty,
  type SpecialtyCode,
} from '@platform/domain';

// Re-exporting a type does not bring it into this module's own scope, and the
// complaint table below is keyed by it.
import type { SpecialtyCode } from '@platform/domain';

/**
 * Chief complaints written into `bookings.intake` and `bookings.reason_text`.
 *
 * This is the whole declared set — the doctor's screen is populated from a
 * pre-visit answer (`FR-DOC-03`), so the field cannot be empty, and CLAUDE.md
 * §8 forbids inventing clinical content beyond what the seed declares. They
 * are ordinary outpatient reasons for attending, tied to no real person, and
 * every row carrying one also carries `demo: true`.
 */
export const DEMO_COMPLAINTS: readonly {
  readonly specialty: SpecialtyCode;
  readonly bn: string;
  readonly en: string;
}[] = [
  { specialty: 'CARD', bn: 'বুকে ব্যথা', en: 'Chest pain' },
  { specialty: 'CARD', bn: 'উচ্চ রক্তচাপ ফলো-আপ', en: 'Hypertension follow-up' },
  { specialty: 'MED', bn: 'জ্বর ও কাশি', en: 'Fever and cough' },
  { specialty: 'MED', bn: 'ডায়াবেটিস ফলো-আপ', en: 'Diabetes follow-up' },
  { specialty: 'MED', bn: 'দুর্বলতা', en: 'Weakness' },
  { specialty: 'GYN', bn: 'গর্ভকালীন পরীক্ষা', en: 'Antenatal check-up' },
  { specialty: 'GYN', bn: 'তলপেটে ব্যথা', en: 'Lower abdominal pain' },
  { specialty: 'ORTHO', bn: 'হাঁটুর ব্যথা', en: 'Knee pain' },
  { specialty: 'ORTHO', bn: 'কোমরে ব্যথা', en: 'Back pain' },
  { specialty: 'PAED', bn: 'শিশুর জ্বর', en: "Child's fever" },
  { specialty: 'PAED', bn: 'টিকা পরামর্শ', en: 'Vaccination advice' },
  { specialty: 'NEURO', bn: 'মাথা ব্যথা', en: 'Headache' },
  { specialty: 'NEURO', bn: 'মাথা ঘোরা', en: 'Dizziness' },
  { specialty: 'ENT', bn: 'গলা ব্যথা', en: 'Sore throat' },
  { specialty: 'ENT', bn: 'কানে কম শোনা', en: 'Reduced hearing' },
  { specialty: 'DERM', bn: 'চর্মরোগ', en: 'Skin complaint' },
  { specialty: 'DERM', bn: 'চুল পড়া', en: 'Hair loss' },
];

/** Complaints belonging to one specialty, never empty for a declared code. */
export function complaintsFor(code: SpecialtyCode): readonly { bn: string; en: string }[] {
  const matching = DEMO_COMPLAINTS.filter((entry) => entry.specialty === code);
  if (matching.length === 0) throw new Error(`No declared complaint for specialty ${code}`);
  return matching;
}

/**
 * Which session the pitch is run on (`FR-DEM-06`, `PRD.md` §24 step 1).
 *
 * The script opens with a patient booking a cardiology serial and being given
 * **serial 18**, so the demo session holds exactly seventeen bookings before
 * anyone touches it. `seed_07_demo_live` owns that session end to end, and
 * `seed_02` leaves it alone.
 */
export const DEMO_LIVE = {
  hospitalSlug: 'shapla-general',
  departmentCode: 'CARD',
  /** Index into that hospital's cardiology doctors. */
  doctorSlug: 'ayesha-siddika',
  /** Serials 1…17 exist; the first serial the pitch allocates is 18. */
  bookingsBefore: 17,
  /** Serials 1…5 have been seen, serial 6 is in the chamber. */
  doneThrough: 5,
  /** The patient who has declared lateness (`FR-QUE-21`). */
  lateSerial: 9,
  /**
   * Set explicitly rather than by `seed_02`'s formula, so the presenter has
   * headroom to book several serials during the pitch without hitting
   * `hasCapacity` (`FR-QUE-14`).
   */
  capacity: 30,
} as const;
