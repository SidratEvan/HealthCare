/**
 * What makes a row demonstration data, and how to tell (`FR-DEM-07`).
 *
 * ## Where the label lives
 *
 * Migrations 0001–0006 carry no `is_demo` column and DATABASE.md §2 defines
 * none, so the label rides in the columns a human actually reads:
 *
 *   - every hospital, doctor and patient **name** ends in `(ডেমো)` / `(Demo)`
 *   - every BMDC number is `DEMO-…`, which is not the shape a registration takes
 *   - every jsonb column carries `demo: true`
 *   - every email is at `demo.invalid`, a reserved TLD that cannot resolve
 *   - every phone number comes from one synthetic block (see below)
 *
 * A row with no human-readable field of its own — `hospital_settings`,
 * `capabilities`, `queue_state` — is labelled by the facility it belongs to,
 * because that is the only place the label could be read from.
 *
 * A banner in the UI is *not* sufficient on its own: `FR-DEM-07` has to hold
 * in Supabase's table editor, in a CSV export and in a screenshot of a query
 * result, none of which render a banner.
 *
 * ## Phone numbers
 *
 * Bangladesh has no reserved test range, so there is no number that is
 * guaranteed to belong to nobody. What is available is a single structurally
 * valid block with obviously synthetic digits, allocated by kind:
 *
 *   +8801310xxxxxx  patients        +8801340xxxxxx  blood donors
 *   +8801320xxxxxx  guest bookings  +8801350xxxxxx  standby list
 *   +8801330xxxxxx  staff           +8801390xxxxxx  schema-test fixtures
 *
 * The `0` after the two kind digits is what makes the block synthetic — an
 * allocated Bangladeshi mobile number does not have it there. Combined with
 * `SMS_PROVIDER=log`, which writes to the console and the notifications table
 * instead of a network (CLAUDE.md §1.1), nothing is ever sent to any of them.
 */

/** Appended to every Bangla name a human reads. */
export const DEMO_LABEL_BN = '(ডেমো)';

/** Appended to every English name a human reads. */
export const DEMO_LABEL_EN = '(Demo)';

/** Carried by every jsonb column the seeds write, so a query can find them. */
export const DEMO_MARKER = { demo: true } as const;

export function labelBn(name: string): string {
  return `${name} ${DEMO_LABEL_BN}`;
}

export function labelEn(name: string): string {
  return `${name} ${DEMO_LABEL_EN}`;
}

/** True when a value carries the demo label — what the seed test asserts on. */
export function isLabelled(value: string): boolean {
  return value.includes(DEMO_LABEL_BN) || value.includes(DEMO_LABEL_EN);
}

/** The kinds of person the demo phone block is divided between. */
export type PhoneKind = 'patient' | 'guest' | 'staff' | 'donor' | 'standby' | 'fixture';

const PHONE_PREFIX: Record<PhoneKind, string> = {
  patient: '31',
  guest: '32',
  // `staff_users` carries an email rather than a phone, so this block is
  // unused until a staff member needs an SMS of their own; it is reserved so
  // that adding one later cannot collide with a patient's number.
  staff: '33',
  donor: '34',
  standby: '35',
  // The minimal graph the schema tests build (`database/seeds/graph.ts`). Its own
  // block, so a fixture row and a seeded row can never share a number even
  // when both exist in one database.
  fixture: '39',
};

/**
 * A normalised demo phone number (`DB-P6`), unique within its kind.
 *
 * @param index 1-based, at most 999999 — beyond that the block would overflow
 *   into the next kind and two people would share a number.
 */
export function demoPhone(kind: PhoneKind, index: number): string {
  if (!Number.isInteger(index) || index < 1 || index > 999999) {
    throw new Error(`demoPhone index must be 1…999999, got ${String(index)}.`);
  }
  const prefix = PHONE_PREFIX[kind];
  return `+8801${prefix}0${String(index).padStart(6, '0')}`;
}

/** An unroutable staff email, on the reserved `.invalid` TLD (RFC 2606). */
export function demoEmail(local: string, facilitySlug: string): string {
  return `${local}@${facilitySlug}.demo.invalid`;
}

/**
 * The value written to `staff_users.password_hash`.
 *
 * Authentication is deferred to Supabase Auth (CLAUDE.md §4.1), so there is no
 * argon2id dependency and nothing that could verify a password. The column is
 * NOT NULL, so it gets a value that is deliberately **not a hash of anything**
 * — no verifier can match it, and it cannot be mistaken for a credential in a
 * screenshot. The leading `!` is the long-standing Unix convention for an
 * account with no usable password.
 */
export const DISABLED_PASSWORD = '!disabled:supabase-auth-issues-tokens';

/** A BMDC number that no real registration takes (`doctors.bmdc_number`). */
export function demoBmdc(index: number): string {
  return `DEMO-${String(index).padStart(5, '0')}`;
}

/** BDT to poisha (`DB-P5`). Integer in, integer out, never a float. */
export function taka(amount: number): number {
  if (!Number.isInteger(amount)) {
    throw new Error(`A demo fee is written in whole taka; got ${String(amount)}.`);
  }
  return amount * 100;
}
