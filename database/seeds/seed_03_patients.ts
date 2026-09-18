/**
 * `FR-DEM-03` (first half) — two hundred patient profiles, owned by a hundred
 * registered accounts and seventy guest identities.
 *
 * ## Why `phone_verified_at` is null on every row
 *
 * Both `users.phone_verified_at` and `guest_identities.phone_verified_at`
 * record that an OTP was answered. No OTP flow exists in this version
 * (CLAUDE.md §4.1 — authentication is Supabase Auth's job later), so a
 * timestamp there would assert a verification that never happened. The columns
 * stay null, which is exactly what they mean: not verified. Under
 * `DEMO_MODE=true` nothing checks them.
 *
 * ## Why these are not two hundred people
 *
 * A given name is drawn from a pool and joined to a surname by the seeded
 * generator, so no row was ever intended to be a person (`FR-SEC-08`). Every
 * profile carries the `FR-DEM-07` label and a phone number from the synthetic
 * demo block. `national_id` is null on every row — DATABASE.md §2.1 has the
 * application encrypt it before it reaches the column, and there is nothing to
 * encrypt.
 *
 * ## Owner split
 *
 * `patients_one_owner` allows a profile to belong to an account **or** to a
 * guest identity, never both. A hundred accounts hold their own profile and
 * thirty of them hold a dependant as well — a mother, a child — because
 * `FR-PAT-03` attaches records to the patient rather than to whoever did the
 * booking, and a demo with only self-profiles never shows that.
 */

import { BLOOD_GROUPS, composeName, DEPENDENT_RELATIONSHIPS, type Sex } from './data/people.js';
import { demoPhone, labelBn } from './lib/demo.js';
import { insertRows } from './lib/insert.js';

import type { Rng } from './lib/random.js';
import type { SeedContext, SeedModule, SeedSummary } from './lib/runner.js';

/** Registered accounts (`FR-PAT-01`, not implemented — see the module note). */
export const ACCOUNT_COUNT = 100;

/** Guest identities: booked without registering (`FR-GST-04`). */
export const GUEST_COUNT = 70;

/** Accounts that also hold a dependant's profile (`FR-PAT-03`). */
export const DEPENDENT_COUNT = 30;

/** 100 + 30 + 70 — the `FR-DEM-03` figure, exactly. */
export const PATIENT_COUNT = ACCOUNT_COUNT + DEPENDENT_COUNT + GUEST_COUNT;

export const seed03Patients: SeedModule = {
  name: 'seed_03_patients',
  title: 'two hundred profiles across a hundred accounts and seventy guests',
  requirements: ['FR-DEM-03', 'FR-DEM-07', 'FR-PAT-03', 'FR-GST-04'],
  writes: ['users', 'guest_identities', 'patients'],

  async run({ client, rng, log }: SeedContext): Promise<SeedSummary> {
    const people = rng.stream('patients');

    // --- users -------------------------------------------------------------
    const userRows = Array.from({ length: ACCOUNT_COUNT }, (_, index) => [
      demoPhone('patient', index + 1),
      // I18N-01: Bangla is the default, and most of this country's patients
      // never change it. A minority on `en` is what proves the switch works.
      people.chance(0.15) ? 'en' : 'bn',
    ]);

    const users = await insertRows<{ id: string }>(
      client,
      'users',
      { columns: ['phone', 'locale'] },
      userRows,
    );

    // --- guest_identities --------------------------------------------------
    //
    // `booking_count` and `no_show_count` stay at zero here. They are counters
    // over rows that do not exist yet; `seed_07_demo_live` recomputes both from
    // the bookings it writes, so the counter behind the prepayment rule
    // (`FR-GST-14`) agrees with the log it is counting.
    const guestRows = Array.from({ length: GUEST_COUNT }, (_, index) => [
      demoPhone('guest', index + 1),
      labelBn(composeName(people, index % 2 === 0 ? 'male' : 'female')),
    ]);

    const guests = await insertRows<{ id: string }>(
      client,
      'guest_identities',
      { columns: ['phone', 'display_name'] },
      guestRows,
    );

    // --- patients ----------------------------------------------------------
    const patientRows: unknown[][] = [];

    for (const [index, user] of users.entries()) {
      const sex: Sex = people.chance(0.52) ? 'female' : 'male';
      const age = people.int(18, 78);
      patientRows.push([
        user.id,
        null,
        labelBn(composeName(people, sex)),
        ...ageColumns(people, age),
        sex,
        people.pick(BLOOD_GROUPS),
        demoPhone('patient', index + 1),
        'self',
        true,
      ]);
    }

    // Dependants, on the first `DEPENDENT_COUNT` accounts.
    for (const user of users.slice(0, DEPENDENT_COUNT)) {
      const relationship = people.pick(DEPENDENT_RELATIONSHIPS);
      const sex: Sex =
        relationship === 'mother'
          ? 'female'
          : relationship === 'father'
            ? 'male'
            : people.chance(0.5)
              ? 'female'
              : 'male';
      const age =
        relationship === 'child'
          ? people.int(1, 14)
          : relationship === 'spouse'
            ? people.int(22, 60)
            : people.int(55, 88);

      patientRows.push([
        user.id,
        null,
        labelBn(composeName(people, sex)),
        ...ageColumns(people, age),
        sex,
        people.pick(BLOOD_GROUPS),
        // A dependant is reached through the account holder's phone, which is
        // why `patients.phone` is nullable and separate from the owner's.
        null,
        relationship,
        false,
      ]);
    }

    for (const [index, guest] of guests.entries()) {
      const sex: Sex = index % 2 === 0 ? 'male' : 'female';
      const age = people.int(18, 72);
      patientRows.push([
        null,
        guest.id,
        labelBn(composeName(people, sex)),
        ...ageColumns(people, age),
        sex,
        people.pick(BLOOD_GROUPS),
        demoPhone('guest', index + 1),
        'self',
        true,
      ]);
    }

    await insertRows(
      client,
      'patients',
      {
        columns: [
          'owner_user_id',
          'owner_guest_id',
          'full_name',
          'date_of_birth',
          'age_years',
          'sex',
          'blood_group',
          'phone',
          'relationship',
          'is_primary',
        ],
      },
      patientRows,
      '',
    );

    if (patientRows.length !== PATIENT_COUNT) {
      throw new Error(
        `Expected ${String(PATIENT_COUNT)} patients, built ${String(patientRows.length)}.`,
      );
    }

    log(`      ${String(users.length)} accounts, ${String(guests.length)} guest identities`);

    return {
      users: userRows.length,
      guest_identities: guestRows.length,
      patients: patientRows.length,
    };
  },
};

/**
 * `date_of_birth` and `age_years`, satisfying `patients_age_known`.
 *
 * Roughly a third of profiles carry a date of birth as well as an age, because
 * that is what a real register looks like: a card with a date, or a person who
 * says "about sixty". Both are written when both are known, and they agree —
 * an age that contradicts its own date of birth is worse than a missing one.
 */
function ageColumns(rng: Rng, age: number): [string | null, number] {
  if (!rng.chance(0.35)) return [null, age];

  // A birthday somewhere in the year, so the pair is consistent without
  // claiming a precision the demo does not have.
  const year = new Date().getUTCFullYear() - age;
  const month = rng.int(1, 12);
  const day = rng.int(1, 28);
  return [`${String(year)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, age];
}
