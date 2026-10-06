/**
 * `pnpm doctor:verify` — marks a doctor's BMDC registration checked
 * (`FR-SUP-02`, pilot step 22).
 *
 * An unverified doctor is never published: discovery shows only doctors whose
 * `bmdc_verified_at` is set. A facility adds its doctors from `S-B-11`, but
 * it cannot vouch for its own doctors' registrations — platform staff check
 * the number against the BMDC register and then run this.
 *
 *   pnpm doctor:verify --bmdc A-12345
 *
 * Reads DATABASE_URL like the API.
 */

import { parseArgs } from 'node:util';

import { bmdcNumber } from '@platform/domain';

import { db } from '../config/db.js';
import { verifyDoctor } from '../services/hospitalSettings.service.js';

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { bmdc: { type: 'string' } }, strict: true });
  const raw = values.bmdc?.trim();
  if (raw === undefined || raw === '') throw new Error('--bmdc is required.');

  const number = bmdcNumber.parse(raw);
  const name = await verifyDoctor(number);
  if (name === null) throw new Error(`No doctor has the BMDC number ${number}.`);
  console.log(
    `Verified ${number} (${name}). The doctor now appears wherever their facility is live.`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await db.destroy();
}
