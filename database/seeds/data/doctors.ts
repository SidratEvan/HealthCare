/**
 * The forty declared demo doctors (`FR-DEM-02`).
 *
 * **This file is the declared demo set**, and CLAUDE.md §8 forbids inventing a
 * practitioner outside it. Every person here is fictional: each carries the
 * `FR-DEM-07` label in the name the console and the patient app display, and a
 * `DEMO-…` BMDC number that is not of the form a real registration takes. No
 * row corresponds to a real doctor, and none is a claim about anyone's
 * qualifications.
 *
 * `FR-DEM-02` asks for roughly forty across cardiology, medicine, gynaecology,
 * orthopaedics, paediatrics, neurology, ENT and dermatology, with evening
 * chamber hours and fees between 500 and 2,000 BDT. The distribution below is
 * not even across the eight — medicine has eight doctors and neurology three,
 * because that is the shape of a real outpatient department list, and every
 * (facility, department) pair has at least one doctor so no department screen
 * is ever empty (CLAUDE.md §5.3).
 *
 * Fees are held in taka here and converted to poisha at the point of write
 * (`DB-P5`); this is the one file where a human reads them, and 1500 is easier
 * to check against the requirement than 150000.
 */

import type { SpecialtyCode } from './reference.js';

/** One chamber: a doctor sitting at a facility, in a department, for a fee. */
export interface DemoChamber {
  readonly hospitalSlug: string;
  readonly departmentCode: SpecialtyCode;
  /** 500–2,000 BDT per `FR-DEM-02`. Converted to poisha on write. */
  readonly feeTaka: number;
  readonly room: string;
}

export interface DemoDoctor {
  /** Stable key for the other seeds and the tests. Never displayed. */
  readonly slug: string;
  /** Without the demo label; the label is appended when the row is written. */
  readonly nameBn: string;
  readonly nameEn: string;
  readonly degrees: string;
  /** `doctors.specialties`, which is a text[] — the primary one comes first. */
  readonly specialties: readonly string[];
  /**
   * Seeds the rolling consultation rate before this doctor has any history
   * (`FR-QUE-10`). The rate then moves with measured consultations
   * (`FR-QUE-12`), so this is a starting point, not a promise.
   */
  readonly consultMinutes: number;
  /** The primary chamber first; a second chamber is a real consultant pattern. */
  readonly chambers: readonly DemoChamber[];
}

export const DEMO_DOCTORS: readonly DemoDoctor[] = [
  // --- Cardiology (5) ------------------------------------------------------
  {
    slug: 'ayesha-siddika',
    nameBn: 'আয়েশা সিদ্দিকা',
    nameEn: 'Ayesha Siddika',
    degrees: 'MBBS, D-Card, FCPS (Cardiology)',
    specialties: ['cardiology'],
    consultMinutes: 12,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'CARD', feeTaka: 1500, room: '304' },
    ],
  },
  {
    slug: 'mahbubur-rahman',
    nameBn: 'মাহবুবুর রহমান',
    nameEn: 'Mahbubur Rahman',
    degrees: 'MBBS, MD (Cardiology)',
    specialties: ['cardiology'],
    consultMinutes: 14,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'CARD', feeTaka: 1500, room: '305' },
    ],
  },
  {
    slug: 'tanvir-ahmed',
    nameBn: 'তানভীর আহমেদ',
    nameEn: 'Tanvir Ahmed',
    degrees: 'MBBS, MD (Cardiology), FACC',
    specialties: ['cardiology', 'interventional'],
    consultMinutes: 15,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'CARD', feeTaka: 2000, room: 'B-210' },
    ],
  },
  {
    slug: 'shamsul-alam',
    nameBn: 'শামসুল আলম',
    nameEn: 'Shamsul Alam',
    degrees: 'MBBS, D-Card',
    specialties: ['cardiology'],
    consultMinutes: 12,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'CARD', feeTaka: 1000, room: '2-A' },
    ],
  },
  {
    slug: 'nusrat-jahan',
    nameBn: 'নুসরাত জাহান',
    nameEn: 'Nusrat Jahan',
    degrees: 'MBBS, FCPS (Cardiology)',
    specialties: ['cardiology'],
    consultMinutes: 10,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'CARD',
        feeTaka: 500,
        room: 'OPD-11',
      },
    ],
  },

  // --- Medicine (8) --------------------------------------------------------
  {
    slug: 'kamrul-hasan',
    nameBn: 'কামরুল হাসান',
    nameEn: 'Kamrul Hasan',
    degrees: 'MBBS, FCPS (Medicine)',
    specialties: ['medicine', 'diabetology'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'MED', feeTaka: 1200, room: '201' },
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'MED', feeTaka: 800, room: 'C-1' },
    ],
  },
  {
    slug: 'farhana-islam',
    nameBn: 'ফারহানা ইসলাম',
    nameEn: 'Farhana Islam',
    degrees: 'MBBS, MD (Internal Medicine)',
    specialties: ['medicine'],
    consultMinutes: 11,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'MED', feeTaka: 1200, room: 'B-104' },
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'MED', feeTaka: 600, room: '3' },
    ],
  },
  {
    slug: 'abdul-momin',
    nameBn: 'আব্দুল মমিন',
    nameEn: 'Abdul Momin',
    degrees: 'MBBS, FCPS (Medicine)',
    specialties: ['medicine'],
    consultMinutes: 9,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'MED', feeTaka: 1200, room: 'B-105' },
    ],
  },
  {
    slug: 'sanjida-akter',
    nameBn: 'সানজিদা আক্তার',
    nameEn: 'Sanjida Akter',
    degrees: 'MBBS, MD (Internal Medicine)',
    specialties: ['medicine'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'MED', feeTaka: 1000, room: '1-C' },
    ],
  },
  {
    slug: 'rafiqul-islam',
    nameBn: 'রফিকুল ইসলাম',
    nameEn: 'Rafiqul Islam',
    degrees: 'MBBS, FCPS (Medicine)',
    specialties: ['medicine'],
    consultMinutes: 8,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'MED',
        feeTaka: 500,
        room: 'OPD-04',
      },
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'MED', feeTaka: 600, room: '4' },
    ],
  },
  {
    slug: 'bipul-chandra-das',
    nameBn: 'বিপুল চন্দ্র দাস',
    nameEn: 'Bipul Chandra Das',
    degrees: 'MBBS, MD (Internal Medicine)',
    specialties: ['medicine', 'nephrology'],
    consultMinutes: 12,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'MED',
        feeTaka: 500,
        room: 'OPD-05',
      },
    ],
  },
  {
    slug: 'shahana-begum',
    nameBn: 'শাহানা বেগম',
    nameEn: 'Shahana Begum',
    degrees: 'MBBS, FCPS (Medicine)',
    specialties: ['medicine'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'MED', feeTaka: 800, room: 'C-2' },
    ],
  },
  {
    slug: 'jahangir-alam',
    nameBn: 'জাহাঙ্গীর আলম',
    nameEn: 'Jahangir Alam',
    degrees: 'MBBS',
    specialties: ['medicine', 'general_practice'],
    consultMinutes: 8,
    chambers: [
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'MED', feeTaka: 500, room: '1' },
    ],
  },

  // --- Gynaecology (7) -----------------------------------------------------
  {
    slug: 'rokeya-sultana',
    nameBn: 'রোকেয়া সুলতানা',
    nameEn: 'Rokeya Sultana',
    degrees: 'MBBS, FCPS (Obs & Gynae)',
    specialties: ['gynaecology', 'obstetrics'],
    consultMinutes: 15,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'GYN', feeTaka: 1200, room: '402' },
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'GYN', feeTaka: 800, room: 'C-3' },
    ],
  },
  {
    slug: 'nasrin-akhter',
    nameBn: 'নাসরিন আখতার',
    nameEn: 'Nasrin Akhter',
    degrees: 'MBBS, MS (Obs & Gynae)',
    specialties: ['gynaecology', 'obstetrics'],
    consultMinutes: 14,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'GYN', feeTaka: 1500, room: 'B-302' },
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'GYN', feeTaka: 600, room: '2' },
    ],
  },
  {
    slug: 'papia-rani-saha',
    nameBn: 'পাপিয়া রানী সাহা',
    nameEn: 'Papia Rani Saha',
    degrees: 'MBBS, FCPS (Obs & Gynae)',
    specialties: ['gynaecology'],
    consultMinutes: 13,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'GYN', feeTaka: 1000, room: '3-B' },
    ],
  },
  {
    slug: 'momtaz-parvin',
    nameBn: 'মমতাজ পারভীন',
    nameEn: 'Momtaz Parvin',
    degrees: 'MBBS, DGO',
    specialties: ['gynaecology'],
    consultMinutes: 12,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'GYN', feeTaka: 800, room: '3-C' },
    ],
  },
  {
    slug: 'sultana-razia',
    nameBn: 'সুলতানা রাজিয়া',
    nameEn: 'Sultana Razia',
    degrees: 'MBBS, FCPS (Obs & Gynae)',
    specialties: ['gynaecology', 'obstetrics'],
    consultMinutes: 11,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'GYN',
        feeTaka: 500,
        room: 'OPD-21',
      },
    ],
  },
  {
    slug: 'dilruba-yeasmin',
    nameBn: 'দিলরুবা ইয়াসমিন',
    nameEn: 'Dilruba Yeasmin',
    degrees: 'MBBS, DGO',
    specialties: ['gynaecology'],
    consultMinutes: 12,
    chambers: [
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'GYN', feeTaka: 800, room: 'C-4' },
    ],
  },
  {
    slug: 'anwara-khatun',
    nameBn: 'আনোয়ারা খাতুন',
    nameEn: 'Anwara Khatun',
    degrees: 'MBBS, DGO',
    specialties: ['gynaecology'],
    consultMinutes: 13,
    chambers: [
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'GYN', feeTaka: 600, room: '5' },
    ],
  },

  // --- Orthopaedics (4) ----------------------------------------------------
  {
    slug: 'saiful-islam',
    nameBn: 'সাইফুল ইসলাম',
    nameEn: 'Saiful Islam',
    degrees: 'MBBS, MS (Orthopaedics)',
    specialties: ['orthopaedics', 'trauma'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'ORTHO', feeTaka: 1200, room: '108' },
      {
        hospitalSlug: 'karnaphuli-general',
        departmentCode: 'ORTHO',
        feeTaka: 1000,
        room: '4-A',
      },
    ],
  },
  {
    slug: 'delwar-hossain',
    nameBn: 'দেলোয়ার হোসেন',
    nameEn: 'Delwar Hossain',
    degrees: 'MBBS, MS (Orthopaedics)',
    specialties: ['orthopaedics'],
    consultMinutes: 11,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'ORTHO', feeTaka: 1500, room: 'B-108' },
    ],
  },
  {
    slug: 'mizanur-rahman',
    nameBn: 'মিজানুর রহমান',
    nameEn: 'Mizanur Rahman',
    degrees: 'MBBS, D-Ortho',
    specialties: ['orthopaedics'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'ORTHO', feeTaka: 800, room: '4-B' },
    ],
  },
  {
    slug: 'ashraful-haque',
    nameBn: 'আশরাফুল হক',
    nameEn: 'Ashraful Haque',
    degrees: 'MBBS, MS (Orthopaedics)',
    specialties: ['orthopaedics', 'trauma'],
    consultMinutes: 9,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'ORTHO',
        feeTaka: 500,
        room: 'OPD-31',
      },
    ],
  },

  // --- Paediatrics (5) -----------------------------------------------------
  {
    slug: 'shirin-sultana',
    nameBn: 'শিরিন সুলতানা',
    nameEn: 'Shirin Sultana',
    degrees: 'MBBS, FCPS (Paediatrics)',
    specialties: ['paediatrics'],
    consultMinutes: 9,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'PAED', feeTaka: 1200, room: '112' },
    ],
  },
  {
    slug: 'nazmul-huda',
    nameBn: 'নাজমুল হুদা',
    nameEn: 'Nazmul Huda',
    degrees: 'MBBS, DCH, FCPS (Paediatrics)',
    specialties: ['paediatrics', 'neonatology'],
    consultMinutes: 10,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'PAED', feeTaka: 1200, room: 'B-112' },
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'PAED', feeTaka: 600, room: '6' },
    ],
  },
  {
    slug: 'ruhul-amin',
    nameBn: 'রুহুল আমিন',
    nameEn: 'Ruhul Amin',
    degrees: 'MBBS, DCH',
    specialties: ['paediatrics'],
    consultMinutes: 8,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'PAED', feeTaka: 800, room: '5-A' },
    ],
  },
  {
    slug: 'tahmina-begum',
    nameBn: 'তাহমিনা বেগম',
    nameEn: 'Tahmina Begum',
    degrees: 'MBBS, FCPS (Paediatrics)',
    specialties: ['paediatrics'],
    consultMinutes: 8,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'PAED',
        feeTaka: 500,
        room: 'OPD-41',
      },
    ],
  },
  {
    slug: 'sabbir-ahmed',
    nameBn: 'সাব্বির আহমেদ',
    nameEn: 'Sabbir Ahmed',
    degrees: 'MBBS, DCH',
    specialties: ['paediatrics'],
    consultMinutes: 9,
    chambers: [
      { hospitalSlug: 'buriganga-clinic', departmentCode: 'PAED', feeTaka: 500, room: '7' },
    ],
  },

  // --- Neurology (3) -------------------------------------------------------
  {
    slug: 'golam-kibria',
    nameBn: 'গোলাম কিবরিয়া',
    nameEn: 'Golam Kibria',
    degrees: 'MBBS, MD (Neurology)',
    specialties: ['neurology'],
    consultMinutes: 16,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'NEURO', feeTaka: 1500, room: '506' },
    ],
  },
  {
    slug: 'aminul-islam',
    nameBn: 'আমিনুল ইসলাম',
    nameEn: 'Aminul Islam',
    degrees: 'MBBS, MD (Neurology)',
    specialties: ['neurology', 'stroke'],
    consultMinutes: 18,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'NEURO', feeTaka: 1800, room: 'B-506' },
    ],
  },
  {
    slug: 'pradip-kumar-roy',
    nameBn: 'প্রদীপ কুমার রায়',
    nameEn: 'Pradip Kumar Roy',
    degrees: 'MBBS, MD (Neurology)',
    specialties: ['neurology'],
    consultMinutes: 14,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'NEURO',
        feeTaka: 600,
        room: 'OPD-51',
      },
    ],
  },

  // --- ENT (4) -------------------------------------------------------------
  {
    slug: 'monirul-haque',
    nameBn: 'মনিরুল হক',
    nameEn: 'Monirul Haque',
    degrees: 'MBBS, DLO',
    specialties: ['ent'],
    consultMinutes: 8,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'ENT', feeTaka: 1000, room: '210' },
    ],
  },
  {
    slug: 'shafiqul-bari',
    nameBn: 'শফিকুল বারী',
    nameEn: 'Shafiqul Bari',
    degrees: 'MBBS, MS (ENT)',
    specialties: ['ent'],
    consultMinutes: 9,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'ENT', feeTaka: 1200, room: 'B-210' },
    ],
  },
  {
    slug: 'habibur-rahman',
    nameBn: 'হাবিবুর রহমান',
    nameEn: 'Habibur Rahman',
    degrees: 'MBBS, DLO',
    specialties: ['ent'],
    consultMinutes: 8,
    chambers: [
      { hospitalSlug: 'karnaphuli-general', departmentCode: 'ENT', feeTaka: 800, room: '6-A' },
    ],
  },
  {
    slug: 'kazi-anisur-hossain',
    nameBn: 'কাজী আনিসুর হোসেন',
    nameEn: 'Kazi Anisur Hossain',
    degrees: 'MBBS, MS (ENT)',
    specialties: ['ent'],
    consultMinutes: 7,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'ENT',
        feeTaka: 500,
        room: 'OPD-61',
      },
    ],
  },

  // --- Dermatology (4) -----------------------------------------------------
  {
    slug: 'sharmin-nahar',
    nameBn: 'শারমিন নাহার',
    nameEn: 'Sharmin Nahar',
    degrees: 'MBBS, DDV',
    specialties: ['dermatology'],
    consultMinutes: 7,
    chambers: [
      { hospitalSlug: 'shapla-general', departmentCode: 'DERM', feeTaka: 1000, room: '115' },
    ],
  },
  {
    slug: 'asif-iqbal',
    nameBn: 'আসিফ ইকবাল',
    nameEn: 'Asif Iqbal',
    degrees: 'MBBS, MD (Dermatology)',
    specialties: ['dermatology'],
    consultMinutes: 8,
    chambers: [
      { hospitalSlug: 'padma-specialised', departmentCode: 'DERM', feeTaka: 1200, room: 'B-115' },
    ],
  },
  {
    slug: 'subrata-barua',
    nameBn: 'সুব্রত বড়ুয়া',
    nameEn: 'Subrata Barua',
    degrees: 'MBBS, DDV',
    specialties: ['dermatology'],
    consultMinutes: 7,
    chambers: [
      {
        hospitalSlug: 'jamuna-medical-college',
        departmentCode: 'DERM',
        feeTaka: 500,
        room: 'OPD-71',
      },
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'DERM', feeTaka: 800, room: 'C-5' },
    ],
  },
  {
    slug: 'rehana-parvin',
    nameBn: 'রেহানা পারভীন',
    nameEn: 'Rehana Parvin',
    degrees: 'MBBS, DDV',
    specialties: ['dermatology'],
    consultMinutes: 7,
    chambers: [
      { hospitalSlug: 'meghna-diagnostic', departmentCode: 'DERM', feeTaka: 700, room: 'C-6' },
    ],
  },
];

/** A declared doctor, by slug. Throws rather than returning a silent nothing. */
export function doctor(slug: string): DemoDoctor {
  const found = DEMO_DOCTORS.find((entry) => entry.slug === slug);
  if (found === undefined) {
    throw new Error(`"${slug}" is not in the declared demo doctor set (CLAUDE.md §8).`);
  }
  return found;
}

/** Every chamber across every doctor — one row per `doctor_hospitals`. */
export function allChambers(): readonly { doctor: DemoDoctor; chamber: DemoChamber }[] {
  return DEMO_DOCTORS.flatMap((entry) =>
    entry.chambers.map((chamber) => ({ doctor: entry, chamber })),
  );
}
