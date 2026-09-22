/**
 * The declared bed inventory (`FR-DEM-04`): "bed inventory across wards with
 * live occupancy; two facilities with burn units, three with ICU."
 *
 * **This file is the declared demo set for beds**, the way `hospitals.ts` is
 * for facilities (CLAUDE.md §8). Every ward, every count and every price below
 * is demonstration data, and every ward name carries the `FR-DEM-07` label when
 * it is written.
 *
 * ## Which facilities have beds
 *
 * Four of the six. The diagnostic centre and the clinic run no ward — their
 * staff rosters have no ward role (`people.ts`) — so they have no beds, and the
 * public app says "no inpatient beds" for them rather than "0 free". The ICU
 * wards are at the three facilities `hasIcu` marks, the burn units at the two
 * whose capabilities include `burn_unit`; `seeds.test.ts` holds this file to
 * both.
 *
 * ## Why the counts are written out rather than drawn at random
 *
 * `FR-DEM-06` asks for a known state, and the pitch leans on particular
 * facts: Padma's ICU is full, Padma has one free burn bed with fresh data, and
 * Jamuna has two free burn beds that nobody has confirmed for hours (`PRD.md`
 * §24 step 7, `FR-PAT-45`). A random draw could lose any of them. Which
 * *patient* is in which bed is still drawn from the seeded generator.
 *
 * ## Freshness
 *
 * `confirmedMinutesAgo` is when somebody on that ward last told the system
 * anything — the newest `bed_events` row for it, which is what the public
 * freshness stamp is read from. Most wards were updated minutes before the
 * reset. Jamuna's were not, deliberately: a government ward board that is
 * hours behind is the ordinary case the product exists to change, and it is
 * what makes the stale warning visible in the demo.
 *
 * With the default ten-minute threshold (`hospital_settings`), every ward
 * turns amber ten minutes after a reset unless somebody touches the board.
 * That is not a bug in the seed; it is the product being honest about an
 * untouched ward.
 */

import type { BedKind } from '@platform/domain';

export interface DemoWard {
  /** Facility slug from `hospitals.ts`. */
  readonly facility: string;
  /** Stable key for tests. Never displayed. */
  readonly key: string;
  /** Without the demo label; the label is appended when the row is written. */
  readonly nameBn: string;
  readonly nameEn: string;
  readonly floor: number;
  readonly kind: BedKind;
  /** Bed labels are this prefix plus a two-digit number: `3` → `301`, `ICU-` → `ICU-01`. */
  readonly labelPrefix: string;
  readonly beds: number;
  /** One price per ward; `FR-PAT-51` shows it per bed type. */
  readonly nightlyTaka: number;
  readonly occupied: number;
  readonly cleaning: number;
  readonly reserved: number;
  readonly outOfService: number;
  readonly confirmedMinutesAgo: number;
}

/** What a bed out of service says about itself (`BTN-B06-OOS`). */
export const OOS_REASONS: readonly string[] = [
  'অক্সিজেন লাইন মেরামত চলছে',
  'বেডের হাইড্রলিক নষ্ট, মিস্ত্রি ডাকা হয়েছে',
];

const ward = (entry: DemoWard): DemoWard => entry;

export const DEMO_WARDS: readonly DemoWard[] = [
  // --- Shapla General, Dhanmondi — large private, updated minutes ago -------
  ward({
    facility: 'shapla-general',
    key: 'shapla-male-medicine',
    nameBn: 'পুরুষ মেডিসিন ওয়ার্ড',
    nameEn: 'Male Medicine Ward',
    floor: 3,
    kind: 'general',
    labelPrefix: '3',
    beds: 8,
    nightlyTaka: 1200,
    occupied: 6,
    cleaning: 1,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 4,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-female-medicine',
    nameBn: 'মহিলা মেডিসিন ওয়ার্ড',
    nameEn: 'Female Medicine Ward',
    floor: 4,
    kind: 'general',
    labelPrefix: '4',
    beds: 8,
    nightlyTaka: 1200,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 1,
    confirmedMinutesAgo: 6,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-cabins',
    nameBn: 'কেবিন ব্লক',
    nameEn: 'Cabin Block',
    floor: 6,
    kind: 'cabin',
    labelPrefix: 'C-6',
    beds: 8,
    nightlyTaka: 5500,
    occupied: 5,
    cleaning: 0,
    // Held for the seeded bed request, so the pending list opens on a hold
    // with its countdown already running (`LIST-B06-PENDING`).
    reserved: 1,
    outOfService: 0,
    confirmedMinutesAgo: 3,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-hdu',
    nameBn: 'এইচডিইউ',
    nameEn: 'HDU',
    floor: 5,
    kind: 'hdu',
    labelPrefix: 'HDU-',
    beds: 4,
    nightlyTaka: 9000,
    occupied: 3,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 7,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-icu',
    nameBn: 'আইসিইউ',
    nameEn: 'ICU',
    floor: 5,
    kind: 'icu',
    labelPrefix: 'ICU-',
    beds: 6,
    nightlyTaka: 22000,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 5,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-ccu',
    nameBn: 'সিসিইউ',
    nameEn: 'CCU',
    floor: 7,
    kind: 'ccu',
    labelPrefix: 'CCU-',
    beds: 4,
    nightlyTaka: 18000,
    occupied: 3,
    cleaning: 1,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 8,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-nicu',
    nameBn: 'এনআইসিইউ',
    nameEn: 'NICU',
    floor: 2,
    kind: 'nicu',
    labelPrefix: 'NICU-',
    beds: 4,
    nightlyTaka: 12000,
    occupied: 2,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 9,
  }),
  ward({
    facility: 'shapla-general',
    key: 'shapla-isolation',
    nameBn: 'আইসোলেশন ওয়ার্ড',
    nameEn: 'Isolation Ward',
    floor: 1,
    kind: 'isolation',
    labelPrefix: 'ISO-',
    beds: 2,
    nightlyTaka: 4000,
    occupied: 0,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 9,
  }),

  // --- Padma Specialised, Uttara — large private, one of two burn units -----
  ward({
    facility: 'padma-specialised',
    key: 'padma-male-general',
    nameBn: 'পুরুষ সাধারণ ওয়ার্ড',
    nameEn: 'Male General Ward',
    floor: 3,
    kind: 'general',
    labelPrefix: '3',
    beds: 8,
    nightlyTaka: 1300,
    occupied: 7,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 5,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-female-general',
    nameBn: 'মহিলা সাধারণ ওয়ার্ড',
    nameEn: 'Female General Ward',
    floor: 4,
    kind: 'general',
    labelPrefix: '4',
    beds: 6,
    nightlyTaka: 1300,
    occupied: 6,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 6,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-cabins',
    nameBn: 'কেবিন ব্লক',
    nameEn: 'Cabin Block',
    floor: 7,
    kind: 'cabin',
    labelPrefix: 'C-7',
    beds: 8,
    nightlyTaka: 6000,
    occupied: 6,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 4,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-hdu',
    nameBn: 'এইচডিইউ',
    nameEn: 'HDU',
    floor: 5,
    kind: 'hdu',
    labelPrefix: 'HDU-',
    beds: 4,
    nightlyTaka: 9500,
    occupied: 4,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 8,
  }),
  // Full, with one bed being cleaned: "ICU full" is a state the public app
  // has to say plainly, and this is where it says it.
  ward({
    facility: 'padma-specialised',
    key: 'padma-icu',
    nameBn: 'আইসিইউ',
    nameEn: 'ICU',
    floor: 5,
    kind: 'icu',
    labelPrefix: 'ICU-',
    beds: 8,
    nightlyTaka: 24000,
    occupied: 7,
    cleaning: 1,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 3,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-ccu',
    nameBn: 'সিসিইউ',
    nameEn: 'CCU',
    floor: 6,
    kind: 'ccu',
    labelPrefix: 'CCU-',
    beds: 4,
    nightlyTaka: 18000,
    occupied: 3,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 7,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-nicu',
    nameBn: 'এনআইসিইউ',
    nameEn: 'NICU',
    floor: 2,
    kind: 'nicu',
    labelPrefix: 'NICU-',
    beds: 4,
    nightlyTaka: 12500,
    occupied: 3,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 9,
  }),
  ward({
    facility: 'padma-specialised',
    key: 'padma-isolation',
    nameBn: 'আইসোলেশন ওয়ার্ড',
    nameEn: 'Isolation Ward',
    floor: 1,
    kind: 'isolation',
    labelPrefix: 'ISO-',
    beds: 2,
    nightlyTaka: 4000,
    occupied: 1,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 9,
  }),
  // One free burn bed, confirmed minutes ago — the fresh half of the
  // emergency scenario (`PRD.md` §24 step 7).
  ward({
    facility: 'padma-specialised',
    key: 'padma-burn',
    nameBn: 'বার্ন ইউনিট',
    nameEn: 'Burn Unit',
    floor: 4,
    kind: 'burn',
    labelPrefix: 'BU-',
    beds: 6,
    nightlyTaka: 15000,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 4,
  }),

  // --- Karnaphuli General, Chattogram — mid-size private --------------------
  ward({
    facility: 'karnaphuli-general',
    key: 'karnaphuli-general',
    nameBn: 'সাধারণ ওয়ার্ড',
    nameEn: 'General Ward',
    floor: 2,
    kind: 'general',
    labelPrefix: '2',
    beds: 8,
    nightlyTaka: 1000,
    occupied: 6,
    cleaning: 0,
    reserved: 0,
    outOfService: 1,
    confirmedMinutesAgo: 6,
  }),
  ward({
    facility: 'karnaphuli-general',
    key: 'karnaphuli-cabins',
    nameBn: 'কেবিন ব্লক',
    nameEn: 'Cabin Block',
    floor: 4,
    kind: 'cabin',
    labelPrefix: 'C-4',
    beds: 6,
    nightlyTaka: 4500,
    occupied: 4,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 6,
  }),
  ward({
    facility: 'karnaphuli-general',
    key: 'karnaphuli-icu',
    nameBn: 'আইসিইউ',
    nameEn: 'ICU',
    floor: 3,
    kind: 'icu',
    labelPrefix: 'ICU-',
    beds: 4,
    nightlyTaka: 18000,
    occupied: 3,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 5,
  }),
  ward({
    facility: 'karnaphuli-general',
    key: 'karnaphuli-ccu',
    nameBn: 'সিসিইউ',
    nameEn: 'CCU',
    floor: 3,
    kind: 'ccu',
    labelPrefix: 'CCU-',
    beds: 4,
    nightlyTaka: 15000,
    occupied: 4,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 7,
  }),

  // --- Jamuna Medical College, Mohakhali — government, board hours behind ---
  //
  // Government ward beds cost a fraction of a private one, and the prices say
  // so. Every ward here was last confirmed hours before the reset.
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-male-medicine',
    nameBn: 'পুরুষ মেডিসিন ওয়ার্ড',
    nameEn: 'Male Medicine Ward',
    floor: 2,
    kind: 'general',
    labelPrefix: '2',
    beds: 10,
    nightlyTaka: 200,
    occupied: 10,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 190,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-female-medicine',
    nameBn: 'মহিলা মেডিসিন ওয়ার্ড',
    nameEn: 'Female Medicine Ward',
    floor: 3,
    kind: 'general',
    labelPrefix: '3',
    beds: 10,
    nightlyTaka: 200,
    occupied: 9,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 210,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-paying-cabins',
    nameBn: 'পেয়িং কেবিন',
    nameEn: 'Paying Cabins',
    floor: 5,
    kind: 'cabin',
    labelPrefix: 'C-5',
    beds: 6,
    nightlyTaka: 900,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 240,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-hdu',
    nameBn: 'এইচডিইউ',
    nameEn: 'HDU',
    floor: 4,
    kind: 'hdu',
    labelPrefix: 'HDU-',
    beds: 4,
    nightlyTaka: 1000,
    occupied: 4,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 200,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-ccu',
    nameBn: 'সিসিইউ',
    nameEn: 'CCU',
    floor: 4,
    kind: 'ccu',
    labelPrefix: 'CCU-',
    beds: 6,
    nightlyTaka: 1500,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 220,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-nicu',
    nameBn: 'এনআইসিইউ',
    nameEn: 'NICU',
    floor: 1,
    kind: 'nicu',
    labelPrefix: 'NICU-',
    beds: 6,
    nightlyTaka: 500,
    occupied: 5,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 260,
  }),
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-isolation',
    nameBn: 'আইসোলেশন ওয়ার্ড',
    nameEn: 'Isolation Ward',
    floor: 1,
    kind: 'isolation',
    labelPrefix: 'ISO-',
    beds: 4,
    nightlyTaka: 200,
    occupied: 2,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 300,
  }),
  // Two free burn beds that nobody has confirmed for four hours — the stale
  // half of the emergency scenario. More beds than Padma, and ranked below it
  // anyway, because a free bed nobody has checked may not be free
  // (`FR-PAT-45`).
  ward({
    facility: 'jamuna-medical-college',
    key: 'jamuna-burn',
    nameBn: 'বার্ন ইউনিট',
    nameEn: 'Burn Unit',
    floor: 6,
    kind: 'burn',
    labelPrefix: 'BU-',
    beds: 8,
    nightlyTaka: 300,
    occupied: 6,
    cleaning: 0,
    reserved: 0,
    outOfService: 0,
    confirmedMinutesAgo: 250,
  }),
];

/** A patient asking a hospital for a bed (`FR-PAT-52`, `LIST-B06-PENDING`). */
export interface DemoBedRequest {
  readonly facility: string;
  readonly kind: BedKind;
  /** `held` reserves the ward's reserved bed; everything else waits. */
  readonly state: 'requested' | 'held';
  readonly note: string | null;
  readonly arrivesInMinutes: number;
  readonly askedMinutesAgo: number;
}

/**
 * The pending list the ward board opens on.
 *
 * The notes are what a family types into `MOD-A11-REQUEST`: logistics, not
 * clinical claims (CLAUDE.md §8). A diagnosis in a request note would be
 * clinical content nobody declared.
 */
export const DEMO_BED_REQUESTS: readonly DemoBedRequest[] = [
  {
    facility: 'shapla-general',
    kind: 'cabin',
    state: 'held',
    note: 'অস্ত্রোপচারের আগের রাতে ভর্তি হতে চাই',
    arrivesInMinutes: 80,
    askedMinutesAgo: 35,
  },
  {
    facility: 'shapla-general',
    kind: 'icu',
    state: 'requested',
    note: 'বয়স্ক রোগী, ডাক্তার ভর্তির পরামর্শ দিয়েছেন',
    arrivesInMinutes: 60,
    askedMinutesAgo: 12,
  },
  {
    facility: 'padma-specialised',
    kind: 'burn',
    state: 'requested',
    note: 'অন্য একটি ক্লিনিক থেকে পাঠানো হয়েছে',
    arrivesInMinutes: 45,
    askedMinutesAgo: 8,
  },
  {
    facility: 'jamuna-medical-college',
    kind: 'general',
    state: 'requested',
    note: null,
    arrivesInMinutes: 120,
    askedMinutesAgo: 25,
  },
];

/** How long a seeded hold has left when the reset finishes. */
export const DEMO_HOLD_MINUTES = 90;
