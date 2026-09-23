/**
 * The patient's half of the standby list (`FR-PAT-25`, `FR-PAT-26`,
 * `FR-PAT-27`, `FR-QUE-30`).
 *
 * The owner's ruling on STATUS decision 62, 2026-09-23: a patient joins from
 * the app when a chamber is full, may pay when joining, and — if they did —
 * is given the next freed chair automatically. Anybody who did not pay is
 * offered it on their phone and answers within the window.
 */

import { z } from 'zod';

import { guestDetails, paymentMethod } from './booking.schema.js';

const uuid = z.string().uuid();

/**
 * How a standby prepayment may be made. Not `at_hospital`: a promise to pay at
 * the counter later is not a payment, and "paid when joining" is what earns
 * the automatic seat.
 */
export const standbyPrepayMethod = z.enum(['bkash', 'nagad', 'card']);

/** `POST /sessions/:id/standby` — join the list (`BTN-A06D-STANDBY`). */
export const joinStandbyBody = z.object({
  guest: guestDetails,
  /** Null to be offered a chair and answer; a method to be seated on sight. */
  prepay: standbyPrepayMethod.nullable().default(null),
  /** Replay safety for the join button (`FR-QUE-51`). */
  clientEventId: uuid.optional(),
});

/**
 * `/standby/:token…` — the patient's status link.
 *
 * A signed capability scoped to one standby row, as a bed request's status
 * link is (`bed_request` audience): the credential is the path.
 */
export const standbyTokenParams = z.object({
  token: z
    .string()
    .trim()
    .min(20)
    .max(2000)
    .regex(/^[A-Za-z0-9_.-]+$/, 'is not a standby token'),
});

/**
 * `POST /standby/:token/accept` — yes to the chair on offer (`FR-PAT-27`).
 *
 * The method is how the new booking is paid, exactly as the booking flow asks
 * (`FR-PAT-20`) — `at_hospital` included, because an offer answered from a
 * phone is a booking made from a phone.
 */
export const acceptStandbyOfferBody = z.object({
  method: paymentMethod,
  clientEventId: uuid.optional(),
});

/** `POST /standby/:token/decline` and `/leave`. */
export const standbyAnswerBody = z.object({
  clientEventId: uuid.optional(),
});

export type JoinStandbyBody = z.infer<typeof joinStandbyBody>;
export type AcceptStandbyOfferBody = z.infer<typeof acceptStandbyOfferBody>;
