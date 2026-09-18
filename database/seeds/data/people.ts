/**
 * Name pools the demo's people are composed from, and the staff roster each
 * facility runs.
 *
 * Patients are **composed** from these pools rather than listed one by one,
 * which is deliberate. Two hundred hand-written names read as a directory of
 * people; a given name drawn from a pool and joined to a surname by a seeded
 * generator is visibly synthetic, and `FR-SEC-08` — no real patient data, ever
 * — is easier to hold to when no row was ever meant to be a person. Every
 * patient row also carries the `FR-DEM-07` label and a phone number from the
 * demo block, which no SMS is ever sent to (`SMS_PROVIDER=log`).
 *
 * ## Why the pools are partitioned rather than mixed
 *
 * `FR-DEM-02` asks for realistic Bangladeshi names, and a uniform draw from
 * one given-name list and one surname list does not produce them. It produces
 * *রতন খাতুন* — a man's given name with a woman's surname — and *আব্দুল রায়*,
 * which crosses two naming traditions that do not mix. Either one on a
 * reception console tells a hospital director, in the first minute, that the
 * data is fake in a way the `(ডেমো)` label was already saying more honestly.
 *
 * So a name is drawn from one **community** and one **sex**, and the surname
 * comes from the pool that belongs with both: Muslim surnames are gendered
 * (খাতুন and বেগম are women's, উদ্দিন and মিয়া men's), while the Hindu and
 * Buddhist surnames here are not, so one list serves both.
 *
 * The weighting — roughly nine in ten from the first pool — is the ordinary
 * composition of a Bangladeshi patient register. Names are stored in Bangla
 * script because Bangla is the default language of this product, not a
 * translation of it (CLAUDE.md §11.5).
 */

import type { Rng } from '../lib/random.js';

export type Sex = 'male' | 'female';

/** Muslim given names, men. */
const MUSLIM_MALE_GIVEN = [
  'আব্দুল',
  'মোহাম্মদ',
  'রফিকুল',
  'কামাল',
  'জসিম',
  'সোহেল',
  'নাসির',
  'ইমরান',
  'রুবেল',
  'শাহীন',
  'আরিফ',
  'বেলাল',
  'হারুন',
  'সেলিম',
  'তারেক',
  'মিজান',
  'বাবুল',
  'শামীম',
  'জাকির',
  'মিলন',
  'সুমন',
  'আলমগীর',
] as const;

/** Muslim given names, women. */
const MUSLIM_FEMALE_GIVEN = [
  'রহিমা',
  'ফাতেমা',
  'আমেনা',
  'সালমা',
  'নাসিমা',
  'রোজিনা',
  'শিরিনা',
  'মর্জিনা',
  'হালিমা',
  'সুফিয়া',
  'জরিনা',
  'রাশিদা',
  'মাহমুদা',
  'নূরজাহান',
  'কুলসুম',
  'বিলকিস',
  'পারুল',
  'শাহিদা',
  'আনোয়ারা',
  'মমতাজ',
] as const;

/** Muslim surnames used by men. */
const MUSLIM_MALE_SURNAMES = [
  'ইসলাম',
  'হোসেন',
  'রহমান',
  'আলী',
  'মিয়া',
  'উদ্দিন',
  'হক',
  'চৌধুরী',
  'শেখ',
  'আহমেদ',
  'সরকার',
  'তালুকদার',
] as const;

/** Muslim surnames used by women. */
const MUSLIM_FEMALE_SURNAMES = [
  'খাতুন',
  'বেগম',
  'আক্তার',
  'পারভীন',
  'সুলতানা',
  'নাহার',
  'ইয়াসমিন',
  'বিবি',
] as const;

/** Hindu and Buddhist given names, men. */
const OTHER_MALE_GIVEN = [
  'অনুপ',
  'দীপক',
  'রতন',
  'বিকাশ',
  'প্রদীপ',
  'সুব্রত',
  'বিপুল',
  'তপন',
  'নির্মল',
  'গোপাল',
] as const;

/** Hindu and Buddhist given names, women. */
const OTHER_FEMALE_GIVEN = [
  'অঞ্জলি',
  'সন্ধ্যা',
  'রেখা',
  'শিউলি',
  'চম্পা',
  'মিতা',
  'কল্পনা',
  'সীমা',
  'বাসন্তী',
  'শিপ্রা',
] as const;

/**
 * Hindu and Buddhist surnames.
 *
 * One list for both sexes, because these are family names rather than gendered
 * honorifics — unlike খাতুন or মিয়া above.
 */
const OTHER_SURNAMES = [
  'দাস',
  'রায়',
  'সাহা',
  'বিশ্বাস',
  'ঘোষ',
  'মণ্ডল',
  'বড়ুয়া',
  'দে',
  'পাল',
  'চক্রবর্তী',
] as const;

/** Roughly the composition of a Bangladeshi patient register. */
const MUSLIM_SHARE = 0.88;

/**
 * A plausible full name: one community, one sex, and a surname that belongs
 * with both.
 */
export function composeName(rng: Rng, sex: Sex): string {
  if (rng.chance(MUSLIM_SHARE)) {
    const given = rng.pick(sex === 'male' ? MUSLIM_MALE_GIVEN : MUSLIM_FEMALE_GIVEN);
    const surname = rng.pick(sex === 'male' ? MUSLIM_MALE_SURNAMES : MUSLIM_FEMALE_SURNAMES);
    return `${given} ${surname}`;
  }

  const given = rng.pick(sex === 'male' ? OTHER_MALE_GIVEN : OTHER_FEMALE_GIVEN);
  return `${given} ${rng.pick(OTHER_SURNAMES)}`;
}

/** `blood_group` values, weighted the way a Bangladeshi register looks. */
export const BLOOD_GROUPS = [
  'B+',
  'B+',
  'O+',
  'O+',
  'A+',
  'A+',
  'AB+',
  'B-',
  'O-',
  'A-',
  'AB-',
  'unknown',
] as const;

/** `patients.relationship`, for a profile booked by someone else (`FR-PAT-03`). */
export const DEPENDENT_RELATIONSHIPS = ['mother', 'father', 'child', 'spouse'] as const;

export type StaffRoleName =
  'receptionist' | 'doctor' | 'ward' | 'emergency' | 'lab' | 'pharmacy' | 'hospital_admin';

/**
 * The staff a facility runs, by `staff_role`.
 *
 * A diagnostic centre has no ward and no emergency room, and a clinic has
 * neither plus one counter rather than two. Seeding all nine roles everywhere
 * would put an emergency console on a facility that has no emergency
 * department, which is the kind of demo detail a hospital director notices.
 *
 * `platform_admin` and `gov_viewer` are deliberately absent: `staff_users` and
 * `staff_roles` both make `hospital_id` NOT NULL, so a national role would
 * need a home facility invented for it. Flagged in `docs/STATUS.md` rather
 * than papered over; steps 19 and 20 need the answer.
 */
const STAFF_ROSTER: Record<string, readonly { role: StaffRoleName; count: number }[]> = {
  full: [
    { role: 'hospital_admin', count: 1 },
    { role: 'receptionist', count: 2 },
    { role: 'doctor', count: 1 },
    { role: 'ward', count: 1 },
    { role: 'emergency', count: 1 },
    { role: 'lab', count: 1 },
    { role: 'pharmacy', count: 1 },
  ],
  diagnostic: [
    { role: 'hospital_admin', count: 1 },
    { role: 'receptionist', count: 2 },
    { role: 'doctor', count: 1 },
    { role: 'lab', count: 1 },
  ],
  clinic: [
    { role: 'hospital_admin', count: 1 },
    { role: 'receptionist', count: 1 },
    { role: 'doctor', count: 1 },
    { role: 'pharmacy', count: 1 },
  ],
};

/** Which roster a facility runs, from its kind. */
export function rosterFor(kind: string): readonly { role: StaffRoleName; count: number }[] {
  const roster = kind === 'diagnostic' ? 'diagnostic' : kind === 'clinic' ? 'clinic' : 'full';
  const found = STAFF_ROSTER[roster];
  if (found === undefined) throw new Error(`No staff roster named "${roster}".`);
  return found;
}
