/**
 * The ancillary demo set: ambulances, blood donors and pharmacy shelves
 * (`FR-DEM-05`, migration 0011).
 *
 * Declared here rather than generated, for the reason `data/beds.ts` gives:
 * a demo somebody will stand in front of has to be the same every reset, and
 * a number a hospital director reads has to have been chosen by a person.
 *
 * Everything here is labelled (`FR-DEM-07`) and every phone comes from the
 * synthetic block (`lib/demo.ts`), so no row can be mistaken for a real
 * operator, a real donor or a real shelf (`FR-SEC-08`).
 *
 * ## What "fifty pharmacy items" counts
 *
 * `FR-DEM-05` asks for fifty. An *item* is one medicine on one pharmacy's
 * shelf — a `pharmacy_stock` row — not a fiftieth entry in the formulary:
 * the formulary is clinical content and stands at the ten `DEMO_FORMULARY`
 * declares (`seed_00`), and inventing forty more medicines to reach a count
 * would be exactly what CLAUDE.md §8 forbids. Five facilities keeping a shelf
 * of those ten is fifty rows, which is the figure `FR-DEM-05` names.
 *
 * ## Why some shelves are out of stock, and some are old
 *
 * `FR-PHR-02` is a feature about *honesty*, so the demo has to contain the
 * cases that make it visible: a medicine flagged out of stock, and a flag
 * nobody has renewed for long enough that the patient app stops repeating it
 * (`STOCK_STALE_THRESHOLD_MINUTES`, twelve hours). A shelf where every row
 * says "in stock, confirmed a minute ago" would demonstrate nothing.
 */

/** One vehicle (`ambulances`, `FR-PAT-74`). */
export interface DemoAmbulance {
  /** The facility it is based at, or null for a private operator. */
  readonly facilitySlug: string | null;
  readonly operator: string;
  readonly kind: 'basic' | 'als' | 'freezer';
  readonly plate: string;
  readonly driver: string;
  /** Taka; the seed converts to poisha. */
  readonly baseFare: number;
  readonly perKm: number;
  readonly available: boolean;
}

/**
 * Eight ambulances (`FR-DEM-05`).
 *
 * Three hospital-owned and five private, which is the proportion a family in
 * Dhaka actually meets. Two ICU-capable, one freezer van, the rest basic —
 * and two unavailable, because a list where everything is free teaches a
 * demo audience nothing about what the screen does when it is not.
 */
export const DEMO_AMBULANCES: readonly DemoAmbulance[] = [
  {
    facilitySlug: 'shapla-general',
    operator: 'শাপলা জেনারেল অ্যাম্বুলেন্স',
    kind: 'basic',
    plate: 'DHAKA METRO-GA-11-2841',
    driver: 'মোঃ রফিকুল ইসলাম',
    baseFare: 1200,
    perKm: 45,
    available: true,
  },
  {
    facilitySlug: 'shapla-general',
    operator: 'শাপলা জেনারেল অ্যাম্বুলেন্স',
    kind: 'als',
    plate: 'DHAKA METRO-GA-11-2842',
    driver: 'আব্দুল করিম',
    baseFare: 3500,
    perKm: 90,
    available: false,
  },
  {
    facilitySlug: 'padma-specialised',
    operator: 'পদ্মা স্পেশালাইজড ট্রান্সপোর্ট',
    kind: 'als',
    plate: 'DHAKA METRO-GA-13-5519',
    driver: 'শাহ আলম',
    baseFare: 4000,
    perKm: 95,
    available: true,
  },
  {
    facilitySlug: null,
    operator: 'নিরাপদ অ্যাম্বুলেন্স সার্ভিস',
    kind: 'basic',
    plate: 'DHAKA METRO-GA-15-7703',
    driver: 'জসিম উদ্দিন',
    baseFare: 1000,
    perKm: 40,
    available: true,
  },
  {
    facilitySlug: null,
    operator: 'নিরাপদ অ্যাম্বুলেন্স সার্ভিস',
    kind: 'freezer',
    plate: 'DHAKA METRO-GA-15-7704',
    driver: 'নূর হোসেন',
    baseFare: 2500,
    perKm: 60,
    available: true,
  },
  {
    facilitySlug: null,
    operator: 'ঢাকা কেয়ার অ্যাম্বুলেন্স',
    kind: 'basic',
    plate: 'DHAKA METRO-GA-17-1126',
    driver: 'মোঃ সেলিম মিয়া',
    baseFare: 1100,
    perKm: 42,
    available: false,
  },
  {
    facilitySlug: null,
    operator: 'ঢাকা কেয়ার অ্যাম্বুলেন্স',
    kind: 'basic',
    plate: 'DHAKA METRO-GA-17-1127',
    driver: 'ইমরান হোসেন',
    baseFare: 1100,
    perKm: 42,
    available: true,
  },
  {
    facilitySlug: 'karnaphuli-general',
    operator: 'কর্ণফুলী অ্যাম্বুলেন্স',
    kind: 'basic',
    plate: 'CHATTA METRO-GA-11-4408',
    driver: 'আবু তাহের',
    baseFare: 900,
    perKm: 38,
    available: true,
  },
];

/** One donor (`blood_donors`, `FR-PAT-75`). */
export interface DemoDonor {
  readonly name: string;
  readonly group: 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-';
  readonly district: string;
  /** Days since the last donation, or null for somebody who never has. */
  readonly lastDonationDaysAgo: number | null;
  readonly available: boolean;
}

/**
 * Thirty donors (`FR-DEM-05`).
 *
 * Grouped roughly as Bangladesh's population is — B+ and O+ commonest, the
 * negative groups rare — because the point of a donor list is that the rare
 * group is the hard search, and a uniform distribution would hide that.
 *
 * Some donated recently enough to be ineligible: `S-A-17`'s eligibility
 * countdown is computed from `last_donation_date`, and a list where everybody
 * is eligible would never show it.
 */
export const DEMO_DONORS: readonly DemoDonor[] = [
  {
    name: 'মোঃ আনিসুর রহমান',
    group: 'B+',
    district: 'Dhaka',
    lastDonationDaysAgo: 210,
    available: true,
  },
  {
    name: 'ফারহানা আক্তার',
    group: 'O+',
    district: 'Dhaka',
    lastDonationDaysAgo: 95,
    available: true,
  },
  {
    name: 'তানভীর হাসান',
    group: 'A+',
    district: 'Dhaka',
    lastDonationDaysAgo: 30,
    available: false,
  },
  {
    name: 'শারমিন সুলতানা',
    group: 'B+',
    district: 'Dhaka',
    lastDonationDaysAgo: null,
    available: true,
  },
  {
    name: 'মোঃ সাইফুল ইসলাম',
    group: 'O+',
    district: 'Dhaka',
    lastDonationDaysAgo: 160,
    available: true,
  },
  {
    name: 'নুসরাত জাহান',
    group: 'AB+',
    district: 'Dhaka',
    lastDonationDaysAgo: 400,
    available: true,
  },
  {
    name: 'রাকিবুল হাসান',
    group: 'A+',
    district: 'Dhaka',
    lastDonationDaysAgo: 75,
    available: true,
  },
  {
    name: 'সাদিয়া ইসলাম',
    group: 'O-',
    district: 'Dhaka',
    lastDonationDaysAgo: 320,
    available: true,
  },
  {
    name: 'মোঃ জাহিদ হোসেন',
    group: 'B+',
    district: 'Dhaka',
    lastDonationDaysAgo: 20,
    available: false,
  },
  {
    name: 'ইশরাত জাহান',
    group: 'A-',
    district: 'Dhaka',
    lastDonationDaysAgo: null,
    available: true,
  },
  {
    name: 'মোঃ মাসুদ রানা',
    group: 'O+',
    district: 'Dhaka',
    lastDonationDaysAgo: 140,
    available: true,
  },
  { name: 'তাসনিম আরা', group: 'B-', district: 'Dhaka', lastDonationDaysAgo: 500, available: true },
  {
    name: 'আরিফুল ইসলাম',
    group: 'A+',
    district: 'Dhaka',
    lastDonationDaysAgo: 110,
    available: true,
  },
  {
    name: 'মেহজাবিন চৌধুরী',
    group: 'O+',
    district: 'Dhaka',
    lastDonationDaysAgo: 45,
    available: false,
  },
  {
    name: 'মোঃ শাহরিয়ার কবির',
    group: 'B+',
    district: 'Dhaka',
    lastDonationDaysAgo: 185,
    available: true,
  },
  {
    name: 'রুবাইয়া হক',
    group: 'AB-',
    district: 'Dhaka',
    lastDonationDaysAgo: null,
    available: true,
  },
  {
    name: 'মোঃ নাজমুল হুদা',
    group: 'O+',
    district: 'Gazipur',
    lastDonationDaysAgo: 260,
    available: true,
  },
  {
    name: 'সাবরিনা আফরোজ',
    group: 'A+',
    district: 'Gazipur',
    lastDonationDaysAgo: 88,
    available: true,
  },
  {
    name: 'মোঃ তৌহিদুল ইসলাম',
    group: 'B+',
    district: 'Gazipur',
    lastDonationDaysAgo: 55,
    available: true,
  },
  {
    name: 'জান্নাতুল ফেরদৌস',
    group: 'O+',
    district: 'Narayanganj',
    lastDonationDaysAgo: 175,
    available: true,
  },
  {
    name: 'মোঃ ফয়সাল আহমেদ',
    group: 'A+',
    district: 'Narayanganj',
    lastDonationDaysAgo: 25,
    available: false,
  },
  {
    name: 'নাফিসা তাবাসসুম',
    group: 'B+',
    district: 'Narayanganj',
    lastDonationDaysAgo: 290,
    available: true,
  },
  {
    name: 'মোঃ রাশেদুল করিম',
    group: 'O-',
    district: 'Chattogram',
    lastDonationDaysAgo: 365,
    available: true,
  },
  {
    name: 'সুমাইয়া আক্তার',
    group: 'B+',
    district: 'Chattogram',
    lastDonationDaysAgo: 130,
    available: true,
  },
  {
    name: 'মোঃ ইমতিয়াজ উদ্দিন',
    group: 'A+',
    district: 'Chattogram',
    lastDonationDaysAgo: null,
    available: true,
  },
  {
    name: 'তাহমিনা বেগম',
    group: 'O+',
    district: 'Chattogram',
    lastDonationDaysAgo: 70,
    available: true,
  },
  {
    name: 'মোঃ সোহেল রানা',
    group: 'AB+',
    district: 'Chattogram',
    lastDonationDaysAgo: 220,
    available: true,
  },
  {
    name: 'রিফাত আরা জেরিন',
    group: 'B+',
    district: 'Chattogram',
    lastDonationDaysAgo: 15,
    available: false,
  },
  {
    name: 'মোঃ কামরুল হাসান',
    group: 'O+',
    district: 'Dhaka',
    lastDonationDaysAgo: 195,
    available: true,
  },
  {
    name: 'আফসানা মিমি',
    group: 'A-',
    district: 'Dhaka',
    lastDonationDaysAgo: 340,
    available: true,
  },
];

/**
 * A pharmacy's shelf: which facilities keep one, and what is on it.
 *
 * `generic` matches `DEMO_FORMULARY` in `data/reference.ts`. `outOfStock`
 * names what that pharmacy has run out of; `staleHours` is how long ago the
 * shelf was last confirmed, which is what the patient app's third answer
 * hangs on.
 *
 * Meghna is a diagnostic centre and Buriganga a clinic; neither keeps a
 * dispensary, so neither appears — a facility with no shelf is absent from
 * the availability search rather than answering "unknown" about everything.
 */
export interface DemoShelf {
  readonly facilitySlug: string;
  readonly outOfStock: readonly string[];
  /** How long since this shelf was last confirmed, in hours. */
  readonly confirmedHoursAgo: number;
}

export const DEMO_SHELVES: readonly DemoShelf[] = [
  // Confirmed this morning: everything it says is standing.
  { facilitySlug: 'shapla-general', outOfStock: ['Amoxicillin'], confirmedHoursAgo: 3 },
  // Two gaps, checked an hour ago — the shelf a demo points at.
  {
    facilitySlug: 'padma-specialised',
    outOfStock: ['Salbutamol', 'Amlodipine'],
    confirmedHoursAgo: 1,
  },
  { facilitySlug: 'jamuna-medical-college', outOfStock: ['Metformin'], confirmedHoursAgo: 6 },
  // **Deliberately stale.** Confirmed two days ago, so every in-stock flag
  // here has lapsed to "জানা নেই" in the patient app while the out-of-stock
  // one still stands. This is the row that demonstrates `FR-PHR-02`'s honesty.
  { facilitySlug: 'karnaphuli-general', outOfStock: ['Omeprazole'], confirmedHoursAgo: 50 },
  { facilitySlug: 'buriganga-clinic', outOfStock: [], confirmedHoursAgo: 9 },
];
