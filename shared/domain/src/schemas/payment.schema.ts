/**
 * Request shapes for the payment endpoints (BACKEND.md §7.7, `FR-PAY-*`).
 *
 * Shared with the client for the reason the booking schemas are: the confirm
 * screen builds a body from these and the API validates with them, so a
 * payment the app can construct is one the server will accept.
 */

import { z } from 'zod';

import { PAYMENT_METHODS } from '../types/enums.js';

const uuid = z.string().uuid();

/**
 * `POST /payments/intent` — start a payment (`FR-PAY-06`).
 *
 * **The amount is not in the body.** It is computed on the server from the
 * booking's own fee (`DB-P5` copies it onto the row when the booking is
 * made), so a client cannot decide what it owes. Everything here names *what*
 * is being paid for, never how much.
 *
 * Exactly one subject, matching `payments_one_subject`: a payment that names
 * two things or none cannot be reconciled against either, and reconciliation
 * is the whole of `FR-PAY-05`.
 */
export const paymentIntentBody = z
  .object({
    bookingId: uuid.optional(),
    bedRequestId: uuid.optional(),
    testOrderId: uuid.optional(),
    ambulanceRequestId: uuid.optional(),

    /** `at_hospital` records an intention to pay at the counter, not a charge. */
    method: z.enum(PAYMENT_METHODS),

    /** Required on every write (CLAUDE.md §7, `FR-PAY-06`). */
    idempotencyKey: uuid,
  })
  .refine(
    (body) =>
      [body.bookingId, body.bedRequestId, body.testOrderId, body.ambulanceRequestId].filter(
        (value) => value !== undefined,
      ).length === 1,
    {
      message: 'A payment pays for exactly one thing.',
      path: ['bookingId'],
    },
  );

export type PaymentIntentBody = z.infer<typeof paymentIntentBody>;

export const paymentParams = z.object({ id: uuid });

/**
 * `POST /payments/:id/refund` — an administrator returns money.
 *
 * **The amount is not in the body here either.** How much comes back is
 * `refundFor` in `shared/domain`, computed from the hospital's policy and the
 * notice given (`FR-PAY-03`), so an administrator cannot quietly refund a
 * different number from the one the patient was shown. What they supply is
 * the *reason*, which chooses the rule.
 *
 * `FR-PAY-07`'s automatic refunds do not come through here at all: they are
 * raised by the session ending, without anybody asking.
 */
export const refundBody = z.object({
  reason: z.enum(['patient_cancelled', 'doctor_absent', 'session_ended']),
  /** An administrator's own words, recorded beside the rule that decided it. */
  note: z.string().trim().max(300).nullable().default(null),
  idempotencyKey: uuid,
});

export type RefundBody = z.infer<typeof refundBody>;

/**
 * `GET /hospitals/:id/settlement?from=&to=` — `FR-PAY-05`.
 *
 * Dates rather than timestamps: a settlement is a statement about days, and
 * a period that started at 14:27 is not one anybody reconciles against.
 */
export const settlementQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD'),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD'),
});

export type SettlementQuery = z.infer<typeof settlementQuery>;

/**
 * `POST /webhooks/bkash` and `/webhooks/nagad`.
 *
 * Deliberately loose: a provider's callback shape is theirs, not ours, and
 * validating it strictly would reject a field they add next quarter. What is
 * required is the two things every provider sends and this API acts on —
 * which transaction, and what happened to it. The signature is checked by the
 * adapter before any of this is trusted.
 */
export const providerWebhookBody = z
  .object({
    providerRef: z.string().trim().min(1).max(200),
    status: z.string().trim().min(1).max(50),
  })
  .passthrough();

export type ProviderWebhookBody = z.infer<typeof providerWebhookBody>;
