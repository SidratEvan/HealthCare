/**
 * A hospital applies by itself (`PRD.md` `FR-ONB-09`, `FR-ONB-10`; plan D1).
 *
 * A public form: the facility's name in both languages, its kind, division
 * and district, a phone number, its registration number, and its
 * administrator's name, email, mobile and password. What it makes is a
 * workspace that is **setting up** and nothing else: nothing public, no
 * figure in the network, and it goes live only the way every workspace does,
 * asked for by the hospital and approved by a person at the platform
 * (`FR-ONB-04`). Creating an account never publishes a hospital.
 *
 * ## The code is made here, not asked for
 *
 * Every hospital has a stable code (`FR-BRD-01`): it names the hospital in an
 * address and at sign-in. The form does not ask an applicant to invent one,
 * so one is made from the English name: its first word that says something
 * (`Teesta General Hospital` → `TEESTA`), and a number after it when that is
 * taken. A code opens nothing while the workspace is not live (`FR-NET-03`).
 */

import { z } from 'zod';

import { bdPhone } from '../schemas/booking.schema.js';
import { FACILITY_KINDS } from '../types/enums.js';

/** The shortest password an applicant may choose; the server's own rule (`config/password`). */
export const APPLICATION_PASSWORD_MIN = 10;

const name = z.string().trim().min(2).max(120);

/** A facility's phone: a landline as well as a mobile (`hospitals.phone`, 0004). */
const facilityPhone = z
  .string()
  .trim()
  .regex(/^\+880[0-9]{8,11}$/, 'must start +880, e.g. +8802912345678');

/** `POST /hospital-applications`. */
export const applicationBody = z.strictObject({
  nameBn: name,
  nameEn: name,
  kind: z.enum(FACILITY_KINDS),
  division: z.string().trim().min(2).max(40),
  district: z.string().trim().min(2).max(60),
  phone: facilityPhone,
  /** The licence or registration number, as the hospital gives it. */
  registrationNo: z.string().trim().min(2).max(60),
  adminName: name,
  adminEmail: z.string().trim().toLowerCase().email().max(254),
  adminMobile: bdPhone,
  password: z.string().min(APPLICATION_PASSWORD_MIN).max(200),
});
export type ApplicationBody = z.infer<typeof applicationBody>;

const BENGALI_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Digits and a leading plus, whatever script and spacing the number was typed in. */
function bare(text: string): string {
  return [...text.trim()]
    .map((char) => {
      const digit = BENGALI_DIGITS.indexOf(char);
      return digit === -1 ? char : String(digit);
    })
    .join('')
    .replace(/[\s().-]/g, '');
}

/**
 * A mobile number as somebody types it (`01712-345678`, `+880 1712 345678`,
 * `০১৭১২৩৪৫৬৭৮`), as the product keeps one: `+8801…`. Null when it is not a
 * Bangladeshi mobile number.
 */
export function mobileFrom(text: string): string | null {
  const digits = bare(text);
  const full = digits.startsWith('+880')
    ? digits
    : digits.startsWith('880')
      ? `+${digits}`
      : digits.startsWith('0')
        ? `+88${digits}`
        : digits;
  return /^\+8801[3-9]\d{8}$/.test(full) ? full : null;
}

/** A facility's phone the same way; a landline is one too (`02 9123456`). */
export function facilityPhoneFrom(text: string): string | null {
  const digits = bare(text);
  const full = digits.startsWith('+880')
    ? digits
    : digits.startsWith('880')
      ? `+${digits}`
      : digits.startsWith('0')
        ? `+88${digits}`
        : digits;
  return /^\+880[0-9]{8,11}$/.test(full) ? full : null;
}

/** Words a hospital's name has that say nothing about which hospital it is. */
const GENERIC = new Set([
  'THE',
  'AND',
  'OF',
  'HOSPITAL',
  'HOSPITALS',
  'CLINIC',
  'CLINICS',
  'DIAGNOSTIC',
  'DIAGNOSTICS',
  'CENTRE',
  'CENTER',
  'MEDICAL',
  'COLLEGE',
  'GENERAL',
  'SPECIALISED',
  'SPECIALIZED',
  'HEALTH',
  'HEALTHCARE',
  'CARE',
  'LTD',
  'LIMITED',
  'PVT',
  'PRIVATE',
  'DEMO',
]);

const CODE_MAX = 16;
/** Room left for `-99` after the word. */
const STEM_MAX = 12;

/** The word a code is made from: the first in the English name that is not generic. */
export function codeStem(nameEn: string): string {
  const words = nameEn
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((word) => word.length >= 2);
  const telling = words.find((word) => !GENERIC.has(word)) ?? words[0] ?? 'HOSPITAL';
  return telling.slice(0, STEM_MAX);
}

/**
 * A code nobody has: the stem, or the stem with the first number after it
 * that is free. Null when a hundred are taken, which is a name to look at by
 * hand and not one to keep counting past.
 */
export function codeFor(nameEn: string, taken: ReadonlySet<string>): string | null {
  const stem = codeStem(nameEn);
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 100; n += 1) {
    const candidate = `${stem}-${String(n)}`;
    if (candidate.length <= CODE_MAX && !taken.has(candidate)) return candidate;
  }
  return null;
}
