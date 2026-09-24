/**
 * `e2e/support/digits.ts` — reading and writing the digits every Bangla
 * surface shows (`TYP-04`).
 *
 * The consoles have shown Bengali digits since the owner's ruling of
 * 2026-09-24, as the patient app always has. A spec asserting on a figure
 * writes the number it expects through `bengali()`, and one reading a figure
 * back into arithmetic runs it through `latin()` first: JavaScript's `\d`
 * matches ASCII digits only, so `/\D/g` would strip a Bengali figure to nothing.
 *
 * A local converter rather than `@platform/i18n`'s: the e2e package does not
 * depend on the workspace's source packages.
 */

const BENGALI = '০১২৩৪৫৬৭৮৯';

/** A number as a Bangla screen writes it. */
export function bengali(value: number): string {
  return String(value).replace(/\d/g, (digit) => BENGALI[Number(digit)] ?? digit);
}

/** Text with any Bengali digits turned back into ASCII ones. */
export function latin(text: string): string {
  return text.replace(/[০-৯]/g, (digit) => String(BENGALI.indexOf(digit)));
}

/** Matches text holding at least one digit, in either script. */
export const ANY_DIGIT = /[0-9০-৯]/;
