/**
 * The ER cases the emergency consoles open on (`FR-EMG-03`, `FR-EMG-04`).
 *
 * **This file is the declared demo set for emergency cases**, the way
 * `beds.ts` is for wards (CLAUDE.md §8). Every case is demonstration data.
 *
 * ## Which facilities have cases
 *
 * The four whose staff roster includes an emergency coordinator
 * (`people.ts`): Shapla, Padma, Karnaphuli and Jamuna. The diagnostic centre
 * and the clinic run no ER console, so a case there would sit on a screen
 * nobody has — and emergency search does not list them for the same reason.
 *
 * ## What is and is not written
 *
 * A case here is what an ER console knows about somebody before a name is
 * taken: the problem type (`FR-PAT-42`'s list), a triage colour once somebody
 * has assessed them, an age and sex as stated, and sometimes a phone number.
 * There are **no clinical notes**. A diagnosis in a demo case would be
 * clinical content nobody declared (CLAUDE.md §8), and `notes` is left null.
 *
 * ## The load each ER opens on
 *
 * Jamuna, a government medical college, is the busiest — eight open cases and
 * one family already on the way. The private hospitals carry two to four.
 * That load is `FR-EMG-04`'s counter and one of `FR-PAT-43`'s ranking keys, so
 * it is part of the emergency scenario (`PRD.md` §24 step 7): from Farmgate,
 * Jamuna is the nearest burn unit and also the most crowded and the most out
 * of date, and Padma is further but fresh.
 *
 * Two cases are already handed to the ward (`BTN-B07-ADMIT`) so that the ward
 * board's pending list opens with its ER half as well as its app half
 * (`FR-BED-07`).
 *
 * ## The cases a referral names
 *
 * `data/referrals.ts` refers some of these on (`FR-EMG-07..09`), by `key`.
 * Two cases exist *because* of a referral that finished earlier today: a burn
 * that walked into Shapla, which has no burn unit, left for Padma (`referred`),
 * and Padma opened a case for the same person on arrival and has since put
 * them in its burn ward (`admitted`). Neither counts towards a load now.
 */

import type { BedKind, EmergencyProblem, TriageColor } from '@platform/domain';

export interface DemoEmergencyCase {
  /** Facility slug from `hospitals.ts`. */
  readonly facility: string;
  /** How `data/referrals.ts` names this case. Only cases a referral names have one. */
  readonly key?: string;
  readonly problem: EmergencyProblem;
  /**
   * `arrived`: in the ER now. `discharged`: seen and sent home earlier today.
   * `acknowledged`: on the way, and the ER has said it is ready. `referred`:
   * left for the ER that took the referral. `admitted`: placed by the ward
   * (needs `handoff`). The last three close after `stayedMinutes`.
   */
  readonly state: 'arrived' | 'discharged' | 'acknowledged' | 'referred' | 'admitted';
  /** Null means nobody has triaged them yet — which is not green. */
  readonly triage: TriageColor | null;
  readonly ageYears: number | null;
  readonly sex: 'male' | 'female' | null;
  /** Whether somebody left a number the ER can call. */
  readonly phone: boolean;
  /** Arrival, or for an inbound case the alert, this long before the reset. */
  readonly minutesAgo: number;
  /** For a closed case: how long they were in the ER before it closed. */
  readonly stayedMinutes?: number;
  /** For an inbound case: the ETA the family's phone estimated. */
  readonly etaMinutes?: number;
  /** Handed to the ward for this kind of bed, this long before the reset. */
  readonly handoff?: { readonly kind: BedKind; readonly minutesAgo: number };
}

const entry = (value: DemoEmergencyCase): DemoEmergencyCase => value;

export const DEMO_EMERGENCY_CASES: readonly DemoEmergencyCase[] = [
  // --- Shapla General, Dhanmondi ---------------------------------------------
  entry({
    facility: 'shapla-general',
    problem: 'accident',
    state: 'discharged',
    triage: 'green',
    ageYears: 34,
    sex: 'male',
    phone: true,
    minutesAgo: 300,
    stayedMinutes: 95,
  }),
  entry({
    facility: 'shapla-general',
    problem: 'breathing',
    state: 'discharged',
    triage: 'yellow',
    ageYears: 61,
    sex: 'female',
    phone: true,
    minutesAgo: 240,
    stayedMinutes: 110,
  }),
  // Walked in with burns; Shapla has no burn unit. Referred to Padma, and
  // left when Padma recorded the arrival (`data/referrals.ts`).
  entry({
    facility: 'shapla-general',
    key: 'shapla-burn',
    problem: 'burn',
    state: 'referred',
    triage: 'red',
    ageYears: 24,
    sex: 'male',
    phone: true,
    minutesAgo: 170,
    stayedMinutes: 60,
  }),
  entry({
    facility: 'shapla-general',
    problem: 'cardiac',
    state: 'arrived',
    triage: 'red',
    ageYears: 58,
    sex: 'male',
    phone: true,
    minutesAgo: 45,
    handoff: { kind: 'ccu', minutesAgo: 10 },
  }),
  entry({
    facility: 'shapla-general',
    problem: 'accident',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 27,
    sex: 'male',
    phone: false,
    minutesAgo: 30,
  }),
  entry({
    facility: 'shapla-general',
    problem: 'child',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 6,
    sex: 'female',
    phone: true,
    minutesAgo: 20,
  }),
  entry({
    facility: 'shapla-general',
    problem: 'other',
    state: 'arrived',
    triage: null,
    ageYears: 44,
    sex: 'female',
    phone: false,
    minutesAgo: 4,
  }),

  // --- Padma Specialised, Uttara ---------------------------------------------
  entry({
    facility: 'padma-specialised',
    problem: 'other',
    state: 'discharged',
    triage: 'green',
    ageYears: 22,
    sex: 'female',
    phone: true,
    minutesAgo: 180,
    stayedMinutes: 60,
  }),
  // The same person as `shapla-burn`, as Padma opened the case on arrival;
  // placed in Padma's burn ward since.
  entry({
    facility: 'padma-specialised',
    key: 'padma-burn-from-shapla',
    problem: 'burn',
    state: 'admitted',
    triage: 'red',
    ageYears: 24,
    sex: 'male',
    phone: false,
    minutesAgo: 110,
    stayedMinutes: 20,
    handoff: { kind: 'burn', minutesAgo: 100 },
  }),
  // Needs a cath lab, which Padma does not have. Shapla declined; Padma's
  // coordinator has the case, and the decline, on the triage list.
  entry({
    facility: 'padma-specialised',
    key: 'padma-cardiac',
    problem: 'cardiac',
    state: 'arrived',
    triage: 'red',
    ageYears: 55,
    sex: 'male',
    phone: true,
    minutesAgo: 40,
  }),
  entry({
    facility: 'padma-specialised',
    problem: 'stroke',
    state: 'arrived',
    triage: 'red',
    ageYears: 67,
    sex: 'male',
    phone: true,
    minutesAgo: 25,
  }),
  entry({
    facility: 'padma-specialised',
    problem: 'obstetric',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 29,
    sex: 'female',
    phone: true,
    minutesAgo: 15,
  }),
  entry({
    facility: 'padma-specialised',
    problem: 'accident',
    state: 'arrived',
    triage: 'green',
    ageYears: 19,
    sex: 'male',
    phone: false,
    minutesAgo: 10,
  }),

  // --- Karnaphuli General, Chattogram ----------------------------------------
  entry({
    facility: 'karnaphuli-general',
    problem: 'cardiac',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 52,
    sex: 'male',
    phone: true,
    minutesAgo: 35,
  }),
  entry({
    facility: 'karnaphuli-general',
    problem: 'breathing',
    state: 'arrived',
    triage: 'green',
    ageYears: 8,
    sex: 'male',
    phone: true,
    minutesAgo: 12,
  }),

  // --- Jamuna Medical College, Mohakhali — the busiest ER --------------------
  entry({
    facility: 'jamuna-medical-college',
    problem: 'accident',
    state: 'discharged',
    triage: 'green',
    ageYears: 31,
    sex: 'male',
    phone: false,
    minutesAgo: 360,
    stayedMinutes: 60,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'child',
    state: 'discharged',
    triage: 'green',
    ageYears: 4,
    sex: 'male',
    phone: true,
    minutesAgo: 280,
    stayedMinutes: 70,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'other',
    state: 'discharged',
    triage: 'green',
    ageYears: 45,
    sex: 'female',
    phone: false,
    minutesAgo: 200,
    stayedMinutes: 70,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'burn',
    state: 'arrived',
    triage: 'red',
    ageYears: 36,
    sex: 'male',
    phone: true,
    minutesAgo: 50,
    handoff: { kind: 'burn', minutesAgo: 15 },
  }),
  // Jamuna's HDU is full; Shapla has accepted, and the person is on the way.
  entry({
    facility: 'jamuna-medical-college',
    key: 'jamuna-accident',
    problem: 'accident',
    state: 'arrived',
    triage: 'red',
    ageYears: 23,
    sex: 'male',
    phone: false,
    minutesAgo: 40,
  }),
  // Jamuna has no ICU; Shapla has seen the referral and not yet answered.
  entry({
    facility: 'jamuna-medical-college',
    key: 'jamuna-breathing',
    problem: 'breathing',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 70,
    sex: 'female',
    phone: true,
    minutesAgo: 38,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'cardiac',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 63,
    sex: 'male',
    phone: true,
    minutesAgo: 28,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'accident',
    state: 'arrived',
    triage: 'yellow',
    ageYears: 17,
    sex: 'male',
    phone: false,
    minutesAgo: 22,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'other',
    state: 'arrived',
    triage: 'green',
    ageYears: 50,
    sex: 'female',
    phone: false,
    minutesAgo: 14,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'child',
    state: 'arrived',
    triage: null,
    ageYears: 3,
    sex: 'female',
    phone: true,
    minutesAgo: 3,
  }),
  entry({
    facility: 'jamuna-medical-college',
    problem: 'accident',
    state: 'acknowledged',
    triage: null,
    ageYears: 40,
    sex: 'male',
    phone: true,
    minutesAgo: 6,
    etaMinutes: 18,
  }),
];
