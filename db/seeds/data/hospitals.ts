/**
 * The six declared demo facilities (`FR-DEM-01`).
 *
 * **This file is the declared demo set.** CLAUDE.md §8 forbids inventing a
 * hospital name outside it, so a facility that is not here does not exist in
 * this product's demo — adding one is an edit to this file, reviewed like any
 * other.
 *
 * Every name is fictional and carries the `FR-DEM-07` label. The names are
 * rivers and a water lily, which is why none of them reads as a real
 * institution: `শাপলা` (shapla, the national flower), `পদ্মা`, `কর্ণফুলী`,
 * `যমুনা`, `মেঘনা`, `বুড়িগঙ্গা`.
 *
 * Coordinates are real neighbourhood centroids rather than invented points.
 * That matters: the emergency search ranks by travel time (`FR-PAT-43`), and a
 * fabricated coordinate produces a confident wrong answer, which
 * `hospitals_lat_in_bangladesh` exists to prevent and `PRD.md` §3.2 forbids.
 * A coordinate is public geography, not clinical content.
 */

import type { Division, SpecialtyCode } from './reference.js';

export type FacilityKind = 'hospital' | 'clinic' | 'diagnostic' | 'government';

/** Capability kinds, mirroring `capability_kind` (DATABASE.md §1). */
export type CapabilityKind =
  | 'burn_unit'
  | 'cardiac'
  | 'cath_lab'
  | 'stroke'
  | 'dialysis'
  | 'nicu'
  | 'trauma_ot'
  | 'blood_bank'
  | 'ambulance'
  | 'isolation';

export interface DemoFacility {
  /** Stable key used by the other seeds and by the tests. Never displayed. */
  readonly slug: string;
  /** Without the demo label; the label is appended when the row is written. */
  readonly nameBn: string;
  readonly nameEn: string;
  readonly kind: FacilityKind;
  readonly division: Division;
  readonly district: string;
  readonly thana: string;
  readonly addressBn: string;
  readonly addressEn: string;
  readonly lat: number;
  readonly lng: number;
  /** Landline form; `hospitals_phone_normalised` allows `+880` + 8–11 digits. */
  readonly phone: string;
  readonly emergencyPhone: string | null;
  /** Departments this facility runs, by specialty code. */
  readonly departments: readonly SpecialtyCode[];
  /** Published to the emergency network (`FR-EMG-05`). */
  readonly capabilities: readonly CapabilityKind[];
  /**
   * ICU wards this facility will hold once `wards`/`beds` exist (migration
   * 0008). Recorded here so `FR-DEM-04` — two burn units, three with ICU — is
   * one description rather than two, and `seed_05_beds` reads it when it can.
   */
  readonly hasIcu: boolean;
  /** Roughly how large, which is what sets bed counts and session capacity. */
  readonly size: 'large' | 'mid' | 'small';
  /** Console default; `hospital_settings.numeral_style` (TYP-04). */
  readonly numeralStyle: 'latin' | 'bengali';
}

/**
 * Two large private in Dhaka, one mid-size private in Chattogram, one
 * government medical college, one diagnostic centre, one clinic — exactly the
 * mix `FR-DEM-01` names, in that order.
 */
export const DEMO_FACILITIES: readonly DemoFacility[] = [
  {
    slug: 'shapla-general',
    nameBn: 'শাপলা জেনারেল হাসপাতাল',
    nameEn: 'Shapla General Hospital',
    kind: 'hospital',
    division: 'Dhaka',
    district: 'Dhaka',
    thana: 'Dhanmondi',
    addressBn: 'সড়ক ৭, ধানমন্ডি, ঢাকা ১২০৫',
    addressEn: 'Road 7, Dhanmondi, Dhaka 1205',
    lat: 23.7461,
    lng: 90.376,
    phone: '+880255010001',
    emergencyPhone: '+880255010999',
    departments: ['CARD', 'MED', 'GYN', 'ORTHO', 'PAED', 'NEURO', 'ENT', 'DERM'],
    capabilities: [
      'cardiac',
      'cath_lab',
      'stroke',
      'dialysis',
      'nicu',
      'trauma_ot',
      'blood_bank',
      'ambulance',
      'isolation',
    ],
    hasIcu: true,
    size: 'large',
    numeralStyle: 'latin',
  },
  {
    slug: 'padma-specialised',
    nameBn: 'পদ্মা স্পেশালাইজড হাসপাতাল',
    nameEn: 'Padma Specialised Hospital',
    kind: 'hospital',
    division: 'Dhaka',
    district: 'Dhaka',
    thana: 'Uttara',
    addressBn: 'সেক্টর ৪, উত্তরা, ঢাকা ১২৩০',
    addressEn: 'Sector 4, Uttara, Dhaka 1230',
    lat: 23.8703,
    lng: 90.3984,
    phone: '+880255020001',
    emergencyPhone: '+880255020999',
    departments: ['CARD', 'MED', 'GYN', 'ORTHO', 'PAED', 'NEURO', 'ENT', 'DERM'],
    // One of the two burn units (`FR-DEM-04`).
    capabilities: [
      'burn_unit',
      'cardiac',
      'stroke',
      'dialysis',
      'nicu',
      'trauma_ot',
      'blood_bank',
      'ambulance',
      'isolation',
    ],
    hasIcu: true,
    size: 'large',
    numeralStyle: 'latin',
  },
  {
    slug: 'karnaphuli-general',
    nameBn: 'কর্ণফুলী জেনারেল হাসপাতাল',
    nameEn: 'Karnaphuli General Hospital',
    kind: 'hospital',
    division: 'Chattogram',
    district: 'Chattogram',
    thana: 'Panchlaish',
    addressBn: 'পাঁচলাইশ, চট্টগ্রাম ৪২০৩',
    addressEn: 'Panchlaish, Chattogram 4203',
    lat: 22.3606,
    lng: 91.8206,
    phone: '+880316010001',
    emergencyPhone: '+880316010999',
    departments: ['CARD', 'MED', 'GYN', 'ORTHO', 'PAED', 'ENT'],
    capabilities: ['cardiac', 'dialysis', 'trauma_ot', 'blood_bank', 'ambulance'],
    hasIcu: true,
    size: 'mid',
    numeralStyle: 'latin',
  },
  {
    slug: 'jamuna-medical-college',
    nameBn: 'যমুনা মেডিকেল কলেজ হাসপাতাল',
    nameEn: 'Jamuna Medical College Hospital',
    kind: 'government',
    division: 'Dhaka',
    district: 'Dhaka',
    thana: 'Mohakhali',
    addressBn: 'মহাখালী, ঢাকা ১২১২',
    addressEn: 'Mohakhali, Dhaka 1212',
    lat: 23.7807,
    lng: 90.4043,
    phone: '+880255030001',
    emergencyPhone: '+880255030999',
    departments: ['CARD', 'MED', 'GYN', 'ORTHO', 'PAED', 'NEURO', 'ENT', 'DERM'],
    // The second burn unit, and the widest capability list — which is what
    // makes the emergency burn scenario (`PRD.md` §24 step 7) a real choice
    // between two facilities rather than a single answer.
    capabilities: [
      'burn_unit',
      'cardiac',
      'cath_lab',
      'stroke',
      'dialysis',
      'nicu',
      'trauma_ot',
      'blood_bank',
      'ambulance',
      'isolation',
    ],
    hasIcu: false,
    size: 'large',
    // A government outpatient counter reads serials aloud in Bengali.
    numeralStyle: 'bengali',
  },
  {
    slug: 'meghna-diagnostic',
    nameBn: 'মেঘনা ডায়াগনস্টিক সেন্টার',
    nameEn: 'Meghna Diagnostic Centre',
    kind: 'diagnostic',
    division: 'Dhaka',
    district: 'Dhaka',
    thana: 'Mirpur',
    addressBn: 'সেকশন ৬, মিরপুর, ঢাকা ১২১৬',
    addressEn: 'Section 6, Mirpur, Dhaka 1216',
    lat: 23.8069,
    lng: 90.3687,
    phone: '+880255040001',
    emergencyPhone: null,
    departments: ['MED', 'GYN', 'DERM'],
    capabilities: ['blood_bank'],
    hasIcu: false,
    size: 'small',
    numeralStyle: 'latin',
  },
  {
    slug: 'buriganga-clinic',
    nameBn: 'বুড়িগঙ্গা ক্লিনিক',
    nameEn: 'Buriganga Clinic',
    kind: 'clinic',
    division: 'Dhaka',
    district: 'Narayanganj',
    thana: 'Narayanganj Sadar',
    addressBn: 'চাষাঢ়া, নারায়ণগঞ্জ ১৪০০',
    addressEn: 'Chashara, Narayanganj 1400',
    lat: 23.6238,
    lng: 90.4993,
    phone: '+880267610001',
    emergencyPhone: '+880267610999',
    departments: ['MED', 'GYN', 'PAED'],
    capabilities: ['ambulance'],
    hasIcu: true,
    size: 'small',
    numeralStyle: 'bengali',
  },
];

/** The facility the pitch is run at, and the one the tests build a graph from. */
export function facility(slug: string): DemoFacility {
  const found = DEMO_FACILITIES.find((entry) => entry.slug === slug);
  if (found === undefined) {
    throw new Error(
      `"${slug}" is not in the declared demo set (CLAUDE.md §8). Add it to DEMO_FACILITIES or use one of: ${DEMO_FACILITIES.map((f) => f.slug).join(', ')}.`,
    );
  }
  return found;
}
