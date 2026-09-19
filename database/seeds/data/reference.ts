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

// ---------------------------------------------------------------------------
// Clinical demo content (`FR-DEM-03`, `FR-DEM-07`, CLAUDE.md §8)
// ---------------------------------------------------------------------------
//
// CLAUDE.md §8: "Never invent clinical content… outside the seed file's declared
// demo set." Everything below is that declared set — ordinary outpatient
// findings and advice, paired with the complaint they follow from so that a
// record a hospital director opens reads coherently rather than pairing chest
// pain with knee advice. None of it belongs to a real person, none of it is a
// statistic, and every row written from it also carries `demo: true`
// (`FR-DEM-07`).
//
// It is deliberately conservative: nothing here names a drug dose, because this
// version has no prescription (`FR-DOC-04` was dropped) and a demo should not
// display dosing it cannot stand behind.

/** What a doctor concluded, and what they advised, for one declared complaint. */
export const DEMO_ASSESSMENTS: readonly {
  /** Matches `DEMO_COMPLAINTS.en`, which is what pairs the two. */
  readonly complaintEn: string;
  readonly diagnosisBn: string;
  readonly adviceBn: string;
}[] = [
  {
    complaintEn: 'Chest pain',
    diagnosisBn: 'বুকে ব্যথা — হৃদরোগ বাদ দেওয়ার জন্য পরীক্ষা প্রয়োজন',
    adviceBn:
      'ইসিজি ও রক্তের পরীক্ষা করান। ব্যথা বাড়লে বা শ্বাসকষ্ট হলে সঙ্গে সঙ্গে জরুরি বিভাগে আসুন।',
  },
  {
    complaintEn: 'Hypertension follow-up',
    diagnosisBn: 'উচ্চ রক্তচাপ — নিয়ন্ত্রণে আছে',
    adviceBn:
      'লবণ কমান, প্রতিদিন হাঁটুন, বাড়িতে রক্তচাপ মেপে লিখে রাখুন। তিন মাস পর আবার দেখাবেন।',
  },
  {
    complaintEn: 'Fever and cough',
    diagnosisBn: 'শ্বাসনালীর সংক্রমণ',
    adviceBn: 'বিশ্রাম নিন, প্রচুর পানি পান করুন। তিন দিনে জ্বর না কমলে আবার দেখাবেন।',
  },
  {
    complaintEn: 'Diabetes follow-up',
    diagnosisBn: 'টাইপ-২ ডায়াবেটিস — ফলো-আপ',
    adviceBn: 'খাবারের নিয়ম মেনে চলুন, প্রতিদিন হাঁটুন। তিন মাস পর HbA1c পরীক্ষা করে দেখাবেন।',
  },
  {
    complaintEn: 'Weakness',
    diagnosisBn: 'রক্তশূন্যতার সম্ভাবনা',
    adviceBn: 'রক্তের পরীক্ষা করান। আয়রনযুক্ত খাবার খান।',
  },
  {
    complaintEn: 'Antenatal check-up',
    diagnosisBn: 'গর্ভাবস্থা — স্বাভাবিক',
    adviceBn: 'নিয়মিত পরীক্ষা চালিয়ে যান। রক্তচাপ ও ওজন মেপে রাখুন। এক মাস পর আবার দেখাবেন।',
  },
  {
    complaintEn: 'Lower abdominal pain',
    diagnosisBn: 'তলপেটে ব্যথা — আল্ট্রাসনোগ্রাম প্রয়োজন',
    adviceBn: 'আল্ট্রাসনোগ্রাম করে রিপোর্ট নিয়ে দেখাবেন।',
  },
  {
    complaintEn: 'Knee pain',
    diagnosisBn: 'হাঁটুর ক্ষয়জনিত ব্যথা',
    adviceBn: 'ভারী কাজ ও সিঁড়ি এড়িয়ে চলুন। হাঁটুর ব্যায়াম নিয়মিত করুন।',
  },
  {
    complaintEn: 'Back pain',
    diagnosisBn: 'কোমরের পেশির ব্যথা',
    adviceBn: 'ভারী ওজন তুলবেন না, শক্ত বিছানায় শোবেন। ব্যায়াম নিয়মিত করুন।',
  },
  {
    complaintEn: "Child's fever",
    diagnosisBn: 'শিশুর ভাইরাসজনিত জ্বর',
    adviceBn: 'তরল খাবার বেশি দিন। জ্বর ১০২° ছাড়ালে বা খিঁচুনি হলে সঙ্গে সঙ্গে আসুন।',
  },
  {
    complaintEn: 'Vaccination advice',
    diagnosisBn: 'টিকার সময়সূচি পরামর্শ',
    adviceBn: 'ইপিআই কার্ড অনুযায়ী পরের টিকা নিন। কার্ড সঙ্গে রাখবেন।',
  },
  {
    complaintEn: 'Headache',
    diagnosisBn: 'টেনশন হেডেক',
    adviceBn: 'ঘুম নিয়মিত করুন, পর্দার সময় কমান। ব্যথা বাড়লে বা বমি হলে আবার দেখাবেন।',
  },
  {
    complaintEn: 'Dizziness',
    diagnosisBn: 'মাথা ঘোরা — কানের ভারসাম্যজনিত',
    adviceBn: 'হঠাৎ উঠে দাঁড়াবেন না। উপসর্গ থাকলে দুই সপ্তাহ পর দেখাবেন।',
  },
  {
    complaintEn: 'Sore throat',
    diagnosisBn: 'গলার সংক্রমণ',
    adviceBn: 'কুসুম গরম পানিতে লবণ দিয়ে কুলকুচি করুন। ঠান্ডা খাবার এড়িয়ে চলুন।',
  },
  {
    complaintEn: 'Reduced hearing',
    diagnosisBn: 'কানে কম শোনা — শ্রবণ পরীক্ষা প্রয়োজন',
    adviceBn: 'অডিওমেট্রি পরীক্ষা করে রিপোর্ট নিয়ে দেখাবেন। কানে কিছু দেবেন না।',
  },
  {
    complaintEn: 'Skin complaint',
    diagnosisBn: 'অ্যালার্জিজনিত চর্মরোগ',
    adviceBn: 'সাবান বদলে মৃদু সাবান ব্যবহার করুন। রোদ এড়িয়ে চলুন।',
  },
  {
    complaintEn: 'Hair loss',
    diagnosisBn: 'চুল পড়া — পুষ্টিজনিত সম্ভাবনা',
    adviceBn: 'রক্তের পরীক্ষা করান। সুষম খাবার খান।',
  },
];

/**
 * The assessment that follows from a complaint.
 *
 * Throws rather than falling back: a complaint with no declared assessment means
 * the two tables have drifted, and a visit record with an empty diagnosis is
 * exactly the empty screen CLAUDE.md §5.3 forbids.
 */
export function assessmentFor(complaintEn: string): { diagnosisBn: string; adviceBn: string } {
  const found = DEMO_ASSESSMENTS.find((entry) => entry.complaintEn === complaintEn);
  if (found === undefined) {
    throw new Error(`No declared assessment for complaint "${complaintEn}".`);
  }
  return { diagnosisBn: found.diagnosisBn, adviceBn: found.adviceBn };
}

/**
 * Pre-visit intake answers (`FR-DOC-03`, `MOD-A07-INTAKE`).
 *
 * `APP_FLOW.md` A4 lists the questions: duration, main symptom, chronic
 * conditions, current medicines, allergies. The main symptom is the complaint;
 * these are the other three, plus the duration.
 *
 * `MOD-A07-INTAKE` itself is not built — step 9 collects only a reason — so
 * today these reach the doctor's panel through the seeds alone. When the modal
 * lands it writes the same keys.
 */
export const DEMO_INTAKE = {
  durations: ['২ দিন', '১ সপ্তাহ', '২ সপ্তাহ', '১ মাস', '৬ মাস', '১ বছরের বেশি'],
  /** Long-term conditions a doctor needs to know before advising anything. */
  conditions: ['ডায়াবেটিস', 'উচ্চ রক্তচাপ', 'হাঁপানি', 'থাইরয়েড', 'হৃদরোগ', 'কিডনির সমস্যা'],
  /** Generic names only — no doses, for the reason given at the top of this block. */
  medicines: ['মেটফরমিন', 'অ্যামলোডিপিন', 'লেভোথাইরক্সিন', 'সালবিউটামল ইনহেলার', 'ওমিপ্রাজল'],
  allergies: ['পেনিসিলিন', 'সালফা', 'অ্যাসপিরিন', 'ধুলা', 'চিংড়ি'],
} as const;

/**
 * A sample formulary for the `medicines` table (`seed_00_reference.sql`'s
 * "medicine formulary sample", DATABASE.md §7).
 *
 * Generic name, a common brand, and the strengths a pharmacy in Bangladesh
 * actually stocks. It exists so `FR-DOC-05`'s autocomplete has something to
 * search when that feature is built; nothing reads it in this version, because
 * e-prescriptions were dropped. Manufacturers carry `(Demo)` for the same reason
 * every facility name does (`FR-DEM-07`).
 */
export const DEMO_FORMULARY: readonly {
  readonly generic: string;
  readonly brand: string;
  readonly manufacturer: string;
  readonly strengths: readonly string[];
  readonly form: string;
}[] = [
  {
    generic: 'Paracetamol',
    brand: 'Napa',
    manufacturer: 'Beximco (Demo)',
    strengths: ['500 mg', '665 mg'],
    form: 'tablet',
  },
  {
    generic: 'Omeprazole',
    brand: 'Losectil',
    manufacturer: 'Square (Demo)',
    strengths: ['20 mg', '40 mg'],
    form: 'capsule',
  },
  {
    generic: 'Metformin',
    brand: 'Comet',
    manufacturer: 'Square (Demo)',
    strengths: ['500 mg', '850 mg'],
    form: 'tablet',
  },
  {
    generic: 'Amlodipine',
    brand: 'Amdocal',
    manufacturer: 'Square (Demo)',
    strengths: ['5 mg', '10 mg'],
    form: 'tablet',
  },
  {
    generic: 'Salbutamol',
    brand: 'Sultolin',
    manufacturer: 'Square (Demo)',
    strengths: ['100 mcg'],
    form: 'inhaler',
  },
  {
    generic: 'Cetirizine',
    brand: 'Alatrol',
    manufacturer: 'Square (Demo)',
    strengths: ['5 mg', '10 mg'],
    form: 'tablet',
  },
  {
    generic: 'Amoxicillin',
    brand: 'Moxacil',
    manufacturer: 'Square (Demo)',
    strengths: ['250 mg', '500 mg'],
    form: 'capsule',
  },
  {
    generic: 'Levothyroxine',
    brand: 'Thyrox',
    manufacturer: 'Beximco (Demo)',
    strengths: ['50 mcg', '100 mcg'],
    form: 'tablet',
  },
  {
    generic: 'Esomeprazole',
    brand: 'Nexum',
    manufacturer: 'Beximco (Demo)',
    strengths: ['20 mg', '40 mg'],
    form: 'capsule',
  },
  {
    generic: 'Ibuprofen',
    brand: 'Profen',
    manufacturer: 'Beximco (Demo)',
    strengths: ['400 mg'],
    form: 'tablet',
  },
];
