/**
 * Paying for a held serial from this phone (plan H3; `APP_FLOW.md` `S-A-07d`,
 * `S-A-07p`; `PRD.md` `FR-PAY-08`, `FR-PAY-09`).
 *
 * Every call about a booking's payment is made with the booking's own
 * credential: the tracking link this phone keeps (`lib/bookings`), exchanged
 * for the short token the API takes, as the live serial screen does. A phone
 * that holds no link for the booking cannot ask, and is told the server will
 * confirm the payment by itself and send the result by SMS.
 */

import { confirmPayment, openTrackingLink, payAgain, type PaymentConfirmation } from '@/lib/api';
import { linkHeldFor } from '@/lib/bookings';

/** The short token for one booking, or null when this phone holds no link for it. */
export async function accessTokenFor(bookingId: string): Promise<string | null> {
  const link = linkHeldFor(bookingId);
  if (link === null) return null;
  const view = await openTrackingLink(link);
  return view.token;
}

/** The provider's word in a return address, which chooses only how the server asks. */
export function hintFrom(params: URLSearchParams): 'success' | 'failure' | 'cancel' | null {
  // bKash returns `status`; Nagad `status` too, in its own words.
  const status = (params.get('status') ?? '').toLowerCase();
  if (status === 'success') return 'success';
  if (status === 'cancel' || status === 'cancelled' || status === 'aborted') return 'cancel';
  if (status === 'failure' || status === 'failed') return 'failure';
  return null;
}

/** Asks the server about a payment (`FR-PAY-09`). Null when this phone cannot. */
export async function askAbout(input: {
  readonly bookingId: string;
  readonly paymentId: string;
  readonly hint: 'success' | 'failure' | 'cancel' | null;
}): Promise<PaymentConfirmation | null> {
  const token = await accessTokenFor(input.bookingId);
  if (token === null) return null;
  return await confirmPayment({ ...input, token });
}

/**
 * Sends the patient to pay: to the address they were given, or, where there
 * is none (a confirm answered again), through a new attempt. The deadline
 * does not move (`FR-PAY-08`).
 */
export async function goPay(input: {
  readonly bookingId: string;
  readonly method: string;
  readonly redirectUrl: string | null;
}): Promise<boolean> {
  if (input.redirectUrl !== null) {
    globalThis.location.assign(input.redirectUrl);
    return true;
  }
  const token = await accessTokenFor(input.bookingId);
  if (token === null) return false;
  const again = await payAgain({ bookingId: input.bookingId, token, method: input.method });
  if (again.redirectUrl === null) return false;
  globalThis.location.assign(again.redirectUrl);
  return true;
}

/** Chooses the counter instead (`BTN-A07P-COUNTER`). */
export async function payAtCounter(bookingId: string): Promise<boolean> {
  const token = await accessTokenFor(bookingId);
  if (token === null) return false;
  await payAgain({ bookingId, token, method: 'at_hospital' });
  return true;
}

/** Whole minutes from now to a deadline, never below zero. */
export function minutesLeft(holdUntil: string | null, now: Date): number {
  if (holdUntil === null) return 0;
  return Math.max(0, Math.ceil((Date.parse(holdUntil) - now.getTime()) / 60_000));
}
