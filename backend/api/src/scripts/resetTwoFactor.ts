/**
 * `pnpm staff:reset-2fa` — turns off one account's second factor
 * (pilot step 28, `FR-SEC-10`).
 *
 * For the case `S-B-11` cannot cover: a facility's only administrator has
 * lost the phone and the recovery codes, so there is no other administrator to
 * reset it for them. Platform staff run this on the server once they have
 * confirmed who is asking — the same trust as `pnpm staff:create`. The next
 * sign-in sets a new one up. Every session the account holds ends, and the
 * reset is written to the audit log with no actor.
 *
 *   pnpm staff:reset-2fa --email admin@marks.example [--hospital-code MARKS]
 *
 * The hospital code is needed only when the email has accounts at more than
 * one facility on this server. Reads DATABASE_URL like the API.
 */

import { parseArgs } from 'node:util';

import { hospitalCode } from '@platform/domain';

import { db } from '../config/db.js';
import { resetTwoFactorFromServer } from '../services/staffAuth.service.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, 'hospital-code': { type: 'string' } },
    strict: true,
  });
  const email = values.email?.trim();
  if (email === undefined || email === '') throw new Error('--email is required.');
  const code = values['hospital-code'];

  const reset = await resetTwoFactorFromServer({
    email,
    hospitalCode: code === undefined ? null : hospitalCode.parse(code),
  });
  if (reset === null) throw new Error(`No account has the email ${email}.`);
  console.log(
    `The second factor of ${reset.fullName}${reset.hospitalCode === null ? '' : ` (${reset.hospitalCode})`} is off, ` +
      'and every session of the account has ended. The next sign-in sets up a new one.',
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
