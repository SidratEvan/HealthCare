/**
 * Money, as an integer count of poisha (DB-P5). 1 BDT = 100 poisha.
 *
 * There are no floats in this file and no rounding of taka anywhere in the
 * product. A consultation fee of ৳800 is 80000, a platform fee of 5% of that
 * is 4000, and both are exact. The one place rounding is unavoidable — a
 * percentage that does not divide evenly — is confined to `percentage()`,
 * which states its rounding rule out loud.
 *
 * Formatting belongs to `@platform/i18n` (I18N-06: `৳ ১,২০০` in the patient
 * app, `৳ 1,200` in the console). This file does arithmetic only.
 */

import type { Poisha } from '../types/ids.js';

/** Poisha in one taka. */
export const POISHA_PER_TAKA = 100;

/**
 * The largest amount this system will handle: ৳100,000,000.
 *
 * A bound exists so that an overflow or a misplaced multiplication fails
 * immediately instead of reaching a receipt. Integer arithmetic below this
 * stays exact in a double.
 */
export const MAX_POISHA = 10_000_000_000;

/** Tags an integer number of poisha, rejecting anything that is not one. */
export function poisha(value: number): Poisha {
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `Money must be an integer count of poisha (DB-P5); got ${String(value)}. A fractional value means taka leaked in somewhere.`,
    );
  }
  if (value < 0) {
    throw new RangeError(`Money cannot be negative; got ${String(value)}.`);
  }
  if (value > MAX_POISHA) {
    throw new RangeError(`Money exceeds the maximum of ${String(MAX_POISHA)} poisha.`);
  }
  return value as Poisha;
}

/** Whole taka as poisha. `fromTaka(800)` is ৳800. */
export function fromTaka(taka: number): Poisha {
  if (!Number.isInteger(taka)) {
    throw new TypeError(
      `fromTaka takes whole taka; got ${String(taka)}. For ৳12.50 use poisha(1250).`,
    );
  }
  return poisha(taka * POISHA_PER_TAKA);
}

/**
 * Poisha split into taka and the remaining poisha, for a formatter to render.
 * Never used for arithmetic.
 */
export function toTakaParts(value: Poisha): { taka: number; poisha: number } {
  return {
    taka: Math.trunc(value / POISHA_PER_TAKA),
    poisha: value % POISHA_PER_TAKA,
  };
}

export function add(...amounts: readonly Poisha[]): Poisha {
  return poisha(amounts.reduce<number>((total, amount) => total + amount, 0));
}

/** `minuend - subtrahend`, which may not go below zero. */
export function subtract(minuend: Poisha, subtrahend: Poisha): Poisha {
  return poisha(minuend - subtrahend);
}

export function multiply(amount: Poisha, factor: number): Poisha {
  if (!Number.isInteger(factor)) {
    throw new TypeError(`multiply takes a whole factor; for a share use percentage().`);
  }
  return poisha(amount * factor);
}

/**
 * A percentage of an amount — the platform fee, a partial refund.
 *
 * Rounds half up, to the poisha. The remainder is never dropped silently:
 * `split` exists for the cases where both sides of a division must add back to
 * the original (FR-PAY-04, where the patient must see exactly who gets what).
 */
export function percentage(amount: Poisha, percent: number): Poisha {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new RangeError(`Percentage out of range: ${String(percent)}`);
  }
  return poisha(Math.round((amount * percent) / 100));
}

/**
 * Splits an amount into a share and the remainder, guaranteeing the two add
 * back to the original.
 *
 * The itemisation a patient sees must total exactly what their card was
 * charged; a fee computed one way and a remainder computed another is how a
 * receipt ends up one poisha out (FR-PAY-04).
 */
export function split(amount: Poisha, percent: number): { share: Poisha; remainder: Poisha } {
  const share = percentage(amount, percent);
  return { share, remainder: poisha(amount - share) };
}

/** Sums money safely across a list of rows. */
export function sum(amounts: Iterable<Poisha>): Poisha {
  let total = 0;
  for (const amount of amounts) total += amount;
  return poisha(total);
}

export const ZERO_POISHA = 0 as Poisha;
