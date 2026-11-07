/**
 * The phones a demonstration accepts (`FR-DEM-08`, owner, 12 October 2026).
 *
 * A demonstration is shown to people who may type their own number into it,
 * and what they type would sit in the demo's database. So under `DEMO_MODE`
 * the API takes a person's phone only when it is one of the demonstration's
 * own, listed one by one below. No range is trusted: any `+8801…` block may
 * belong to somebody, the seed's included.
 *
 * The rule itself is the API's: it reads the deployment's settings
 * (`DEMO_PHONES`) and installs it with `setPersonPhoneAdmission`. Until it
 * does — in the apps' own forms, in the seeds — every valid number passes, so
 * a schema shared with a browser checks the shape there and nothing more.
 */

import { normaliseBdMobile } from './phone.js';

/** What a refusal is tagged with, so validation can answer it as its own error. */
export const DEMO_PHONE_NOT_ALLOWED = 'DEMO_PHONE_NOT_ALLOWED';

/**
 * The demonstration's own identities, when the deployment names none.
 *
 * The first five seeded patients (`database/seeds/lib/demo.ts`, the
 * `+8801310…` block), so signing in reaches records; ten numbers for whoever
 * is presenting, in a block the seed does not use; and every number in the
 * import samples (`database/seeds/samples`), so the import walk of
 * `docs/DEMO_GUIDE.md` still runs. A test holds the samples to this list.
 */
export const DEMO_PERSON_PHONES: readonly string[] = [
  '+8801310000001',
  '+8801310000002',
  '+8801310000003',
  '+8801310000004',
  '+8801310000005',
  '+8801380000001',
  '+8801380000002',
  '+8801380000003',
  '+8801380000004',
  '+8801380000005',
  '+8801380000006',
  '+8801380000007',
  '+8801380000008',
  '+8801380000009',
  '+8801380000010',
  '+8801312000106',
  '+8801312000206',
  '+8801512000105',
  '+8801512000205',
  '+8801612000104',
  '+8801612000204',
  '+8801612000304',
  '+8801712000101',
  '+8801712000107',
  '+8801712000201',
  '+8801712000301',
  '+8801812000102',
  '+8801812000108',
  '+8801812000202',
  '+8801812000302',
  '+8801912000103',
  '+8801912000203',
  '+8801912000303',
];

let admission: ((normalised: string) => boolean) | null = null;

/** Installs (or, with null, removes) the rule a person's phone is held to. */
export function setPersonPhoneAdmission(rule: ((normalised: string) => boolean) | null): void {
  admission = rule;
}

/**
 * Where a parse refused a phone under the rule, as `a.b.c` paths.
 *
 * Walks the branches of a union too: a guest booking is one branch of
 * `createBookingBody`, and a union that matched no branch reports one issue
 * with each branch's issues inside it (`errors`), the refusal among them.
 */
export function refusedPhonePaths(
  issues: readonly unknown[],
  prefix: readonly string[] = [],
): string[] {
  const paths: string[] = [];
  for (const issue of issues) {
    if (typeof issue !== 'object' || issue === null) continue;
    const { message, path, errors } = issue as {
      readonly message?: unknown;
      readonly path?: readonly PropertyKey[];
      readonly errors?: unknown;
    };
    const at = [...prefix, ...(path ?? []).map(String)];
    if (message === DEMO_PHONE_NOT_ALLOWED) paths.push(at.join('.'));
    if (Array.isArray(errors)) {
      for (const branch of errors) {
        if (Array.isArray(branch)) paths.push(...refusedPhonePaths(branch, at));
      }
    }
  }
  return paths;
}

/**
 * Whether a person's phone, as typed or as stored, may be taken.
 *
 * A value that is not a Bangladeshi mobile at all passes here: its shape is
 * the format check's to refuse, with its own message.
 */
export function personPhoneAdmitted(phone: string): boolean {
  if (admission === null) return true;
  const normalised = normaliseBdMobile(phone);
  return normalised === null || admission(normalised);
}
