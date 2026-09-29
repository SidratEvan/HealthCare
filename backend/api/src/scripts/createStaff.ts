/**
 * `pnpm staff:create` — a facility's first administrator (pilot step 21).
 *
 * Nobody can create an account from a screen until one administrator exists,
 * so a fresh deployment starts here. With a new hospital code it creates the
 * facility too (not live, empty). It prints a temporary password once; the
 * first sign-in asks for the person's own before any console opens.
 *
 *   pnpm staff:create --hospital-code MARKS --email admin@example.org \
 *     --name "Full Name" \
 *     [--hospital-name-bn "…" --hospital-name-en "…" --kind hospital \
 *      --division Dhaka --district Dhaka]
 *
 * Reads DATABASE_URL like the API. Never run it against the demo database for
 * a real person (FR-SEC-08).
 */

import { parseArgs } from 'node:util';

import { hospitalCode } from '@platform/domain';

import { db } from '../config/db.js';
import { createFirstAdministrator } from '../services/staffAuth.service.js';

const KINDS = ['hospital', 'clinic', 'diagnostic', 'government'] as const;

function required(values: Record<string, string | undefined>, key: string): string {
  const value = values[key]?.trim();
  if (value === undefined || value === '') throw new Error(`--${key} is required.`);
  return value;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'hospital-code': { type: 'string' },
      email: { type: 'string' },
      name: { type: 'string' },
      'hospital-name-bn': { type: 'string' },
      'hospital-name-en': { type: 'string' },
      kind: { type: 'string' },
      division: { type: 'string' },
      district: { type: 'string' },
    },
    strict: true,
  });

  const code = hospitalCode.parse(required(values, 'hospital-code'));
  const email = required(values, 'email');
  if (!email.includes('@')) throw new Error('--email must be an email address.');
  const fullName = required(values, 'name');

  const wantsHospital =
    values['hospital-name-bn'] !== undefined || values['hospital-name-en'] !== undefined;
  let hospital;
  if (wantsHospital) {
    const kind = required(values, 'kind');
    if (!(KINDS as readonly string[]).includes(kind)) {
      throw new Error(`--kind must be one of ${KINDS.join(', ')}.`);
    }
    hospital = {
      nameBn: required(values, 'hospital-name-bn'),
      nameEn: required(values, 'hospital-name-en'),
      kind,
      division: required(values, 'division'),
      district: required(values, 'district'),
    };
  }

  const result = await createFirstAdministrator({
    hospitalCode: code,
    ...(hospital === undefined ? {} : { hospital }),
    email,
    fullName,
  });

  console.log(
    [
      result.createdHospital ? `Created facility ${code} (not live yet).` : `Facility ${code}.`,
      `Administrator: ${email}`,
      `Temporary password (shown once): ${result.temporaryPassword}`,
      'It must be changed at first sign-in.',
    ].join('\n'),
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
