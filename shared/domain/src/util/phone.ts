/**
 * Bangladeshi mobile numbers (`DB-P6`, BACKEND.md §2 `util/phone.ts`).
 *
 * The database stores `+8801XXXXXXXXX` and nothing else. People type a number
 * the way they say it — `01712-345678`, `01712 345 678`, `8801712345678` — and
 * a form that refuses all of those until the person guesses the stored shape
 * is a form that loses them. So the forms normalise what was typed, and refuse
 * only what cannot be a mobile number at all.
 *
 * Normalised, never corrected: a number with a digit missing is refused, not
 * padded, because an SMS to somebody else's phone is worse than no SMS.
 */

/** The stored shape (`DB-P6`): `+880`, then an operator digit 3–9, then eight digits. */
export const BD_MOBILE = /^\+8801[3-9]\d{8}$/;

/** `+8801XXXXXXXXX`, or null when the input cannot be a Bangladeshi mobile. */
export function normaliseBdMobile(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '');

  const candidate = digits.startsWith('+')
    ? digits
    : digits.startsWith('880')
      ? `+${digits}`
      : digits.startsWith('01')
        ? `+88${digits}`
        : digits;

  return BD_MOBILE.test(candidate) ? candidate : null;
}
