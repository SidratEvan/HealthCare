/**
 * The referrals the ER consoles open on (`FR-EMG-07..09`).
 *
 * **This file is the declared demo set for referrals**, the way
 * `emergency.ts` is for cases (CLAUDE.md §8). Every referral is demonstration
 * data, between the three Dhaka ERs — Karnaphuli, two hundred kilometres away
 * in Chattogram, has no other ER within the refer-out search's reach, and its
 * console honestly says so.
 *
 * ## Each one is sent for something the sender lacks
 *
 * A referral that asked a hospital for what the sender already has would
 * teach the wrong thing in a demo. So each follows a gap the declared beds and
 * capabilities (`beds.ts`, `hospitals.ts`) really have:
 *
 *   - Shapla has no burn unit → a burn went to Padma, earlier today. The whole
 *     timeline, sent to arrived, and the person has since been admitted there.
 *   - Padma has no cath lab → asked Shapla; Shapla's was busy and it declined,
 *     with its reason. The case is still Padma's, to try Jamuna.
 *   - Jamuna has no ICU → asked Shapla, which has one free ICU bed; seen, not
 *     yet answered. Shapla opens on it in `LIST-B07-IN`.
 *   - Jamuna's HDU is full → Shapla, with one free HDU bed, accepted; the
 *     person is on the way, and still Jamuna's until Shapla records the
 *     arrival (the owner's ruling, 2026-09-22).
 *
 * ## What is not written
 *
 * No note. A note is a clinical summary in a coordinator's words, and a demo
 * note would be clinical content nobody declared (CLAUDE.md §8). The summary's
 * problem, colour, age and sex are read from the case, as the API does.
 */

import type { BedKind, CapabilityKind } from '@platform/domain';

export interface DemoReferral {
  /** Facility slugs from `hospitals.ts`. */
  readonly from: string;
  readonly to: string;
  /** The sending ER's case, by its `key` in `emergency.ts`. */
  readonly caseKey: string;
  readonly capability: CapabilityKind | null;
  readonly bedKind: BedKind | null;
  readonly state: 'seen' | 'accepted' | 'declined' | 'arrived';
  /** Each step of the timeline, this long before the reset. */
  readonly sentMinutesAgo: number;
  readonly seenMinutesAgo: number;
  readonly respondedMinutesAgo?: number;
  readonly arrivedMinutesAgo?: number;
  readonly declineReason?: string;
  /** For an arrival: the case the receiving ER opened, by its `key`. */
  readonly arrivedCaseKey?: string;
}

const referral = (value: DemoReferral): DemoReferral => value;

export const DEMO_REFERRALS: readonly DemoReferral[] = [
  referral({
    from: 'shapla-general',
    to: 'padma-specialised',
    caseKey: 'shapla-burn',
    capability: 'burn_unit',
    bedKind: 'burn',
    state: 'arrived',
    sentMinutesAgo: 160,
    seenMinutesAgo: 158,
    respondedMinutesAgo: 155,
    arrivedMinutesAgo: 110,
    arrivedCaseKey: 'padma-burn-from-shapla',
  }),
  referral({
    from: 'padma-specialised',
    to: 'shapla-general',
    caseKey: 'padma-cardiac',
    capability: 'cath_lab',
    bedKind: null,
    state: 'declined',
    sentMinutesAgo: 32,
    seenMinutesAgo: 31,
    respondedMinutesAgo: 28,
    declineReason: 'ক্যাথ ল্যাবে এখন অন্য রোগী',
  }),
  referral({
    from: 'jamuna-medical-college',
    to: 'shapla-general',
    caseKey: 'jamuna-accident',
    capability: null,
    bedKind: 'hdu',
    state: 'accepted',
    sentMinutesAgo: 20,
    seenMinutesAgo: 18,
    respondedMinutesAgo: 15,
  }),
  referral({
    from: 'jamuna-medical-college',
    to: 'shapla-general',
    caseKey: 'jamuna-breathing',
    capability: null,
    bedKind: 'icu',
    state: 'seen',
    sentMinutesAgo: 9,
    seenMinutesAgo: 6,
  }),
];
