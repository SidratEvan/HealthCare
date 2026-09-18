/**
 * Bengali numerals, and where they belong (`TYP-04`, `I18N-04`, `FR-LOC-03`).
 *
 * CLAUDE.md §11.5 lists this among the things most likely to be dropped under
 * pressure, and it is: Latin digits inside a Bangla sentence is the single
 * most common tell that a Bangla interface was translated rather than designed
 * (FRONTEND.md §0.2 bans it by name).
 *
 * ## The rule is not "always Bengali"
 *
 * `TYP-04`: patient surfaces use Bengali numerals; **console surfaces use
 * Latin**, configurable per hospital (`hospital_settings.numeral_style`). That
 * is not inconsistency — a receptionist types a serial number into a keyboard
 * forty times an hour and reads it back against a Latin keypad, and Bengali
 * digits there cost real seconds per patient. The patient reading their serial
 * in a corridor has the opposite need.
 *
 * So numerals take a `numeralStyle`, and the caller says which surface it is.
 * There is no default that silently guesses.
 *
 * ## What is never converted
 *
 * A phone number stays Latin everywhere (`+8801…` is an identifier a person
 * dials, not a quantity), and so does anything a person retypes into another
 * system: a BMDC number, an invoice reference, a payment reference. Converting
 * those makes them un-pasteable, which is worse than un-localised.
 */

/** `০১২৩৪৫৬৭৮৯`, indexed by the digit they replace. */
const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'] as const;

/** Which digits a surface uses (`hospital_settings.numeral_style`). */
export type NumeralStyle = 'bengali' | 'latin';

/** Patient surfaces are Bengali; console surfaces are Latin (`TYP-04`). */
export const NUMERAL_STYLE_BY_SURFACE = {
  patient: 'bengali',
  console: 'latin',
} as const satisfies Record<string, NumeralStyle>;

/**
 * Replaces every Latin digit in a string with its Bengali counterpart.
 *
 * Operates on digits only. Separators, currency symbols and any surrounding
 * text pass through untouched, which is what lets it be applied to an already
 * formatted string rather than needing its own formatter for every shape.
 */
export function toBengaliDigits(value: string): string {
  return value.replace(/[0-9]/g, (digit) => BENGALI_DIGITS[Number(digit)] ?? digit);
}

/** The inverse, for parsing what a person typed on a Bengali keypad. */
export function toLatinDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => {
    const index = BENGALI_DIGITS.indexOf(digit as (typeof BENGALI_DIGITS)[number]);
    return index === -1 ? digit : String(index);
  });
}

/** True when the string contains at least one Bengali digit. */
export function hasBengaliDigits(value: string): boolean {
  return /[০-৯]/.test(value);
}

/**
 * Formats a number for a surface.
 *
 * Grouping follows the locale: `bn-BD` groups in the South Asian pattern
 * (`১,২৩,৪৫৬` — thousand, then lakh, then crore), which is what a Bangladeshi
 * reader expects and what `Intl` already knows. Doing the digit substitution
 * ourselves rather than relying on the `-u-nu-beng` extension keeps the output
 * identical across the Node and browser ICU builds, which have disagreed about
 * that extension.
 */
export function formatNumber(
  value: number,
  style: NumeralStyle,
  options: Intl.NumberFormatOptions = {},
): string {
  const locale = style === 'bengali' ? 'bn-BD' : 'en-US';
  const formatted = new Intl.NumberFormat(locale, options).format(value);
  return style === 'bengali' ? toBengaliDigits(formatted) : toLatinDigits(formatted);
}

/**
 * A serial number, as a patient reads it aloud (`FR-PAT-30`).
 *
 * Never grouped: a serial is a label, not a quantity, and `১,০১৮` would be
 * read as a thousand rather than as serial 1018.
 */
export function formatSerial(serial: number, style: NumeralStyle): string {
  return style === 'bengali' ? toBengaliDigits(String(serial)) : String(serial);
}

/**
 * Money, from integer poisha (`DB-P5`).
 *
 * Poisha in, taka out. Fractional taka are dropped only when the amount is
 * whole, because `৳ ৫০০` reads better than `৳ ৫০০.০০` on a fee — and a fee
 * with paisa in it must still show them or the total will not add up.
 */
export function formatTaka(poisha: number, style: NumeralStyle): string {
  if (!Number.isInteger(poisha)) {
    throw new Error(`Money is integer poisha (DB-P5); got ${String(poisha)}.`);
  }

  const taka = poisha / 100;
  const whole = poisha % 100 === 0;
  const formatted = formatNumber(taka, style, {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  });

  // The taka sign is the same glyph in both scripts.
  return `৳${formatted}`;
}

/**
 * A duration a patient is waiting, in whole minutes.
 *
 * Deliberately coarse. An ETA is a projection from a rolling average
 * (`FR-QUE-11`), and rendering it to the second would claim a precision the
 * estimate does not have — which is the opposite of the honesty the freshness
 * line exists to signal (`PRD.md` §3.2).
 */
export function formatMinutes(minutes: number, style: NumeralStyle): string {
  return formatNumber(Math.max(0, Math.round(minutes)), style);
}

/**
 * A phone number, always Latin.
 *
 * `DB-P6` stores `+8801XXXXXXXXX`. Displayed grouped for readability but never
 * converted: a person dials these digits on a keypad and pastes them into
 * other systems.
 *
 * Grouped the way this country writes them — `01712-345678` nationally, so
 * `+880 1712-345678` with the country code. Four digits, dash, six.
 */
export function formatPhone(phone: string): string {
  const match = /^\+880(1[3-9]\d{2})(\d{6})$/.exec(phone);
  if (match === null) return phone;
  return `+880 ${match[1] ?? ''}-${match[2] ?? ''}`;
}
