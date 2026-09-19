/**
 * Request shapes for the clinical record (BACKEND.md §7.6, `FR-DOC-*`).
 *
 * Shared by both sides, for the same reason the booking schemas are: the doctor
 * console builds `S-B-05` from these and the API validates with them, so the
 * screen cannot submit a visit the server would refuse.
 *
 * ## What is not here
 *
 * No medicine rows, no formulary lookup, no prescription. The owner dropped
 * e-prescriptions from this version (`FR-DOC-04`, `FR-DOC-05`, `FR-DOC-07`), so
 * a visit is a diagnosis, advice in Bangla and a follow-up date — which is what
 * `DATABASE.md` §2.4 calls a `visits` row and what the wallet reads.
 */

import { z } from 'zod';

/** A UUID as it arrives on the wire, before it is branded. */
const uuid = z.string().uuid();

/**
 * `POST /visits` — what a doctor wrote about one consultation.
 *
 * Every clinical field is optional and all three may be blank on a draft: a
 * doctor who has typed nothing yet still has a draft worth keeping
 * (`BTN-B05-DRAFT`). Signing is what requires content, and the database
 * enforces it (`visits_signed_has_content`) so the rule cannot be bypassed by
 * a second caller.
 */
export const createVisitBody = z.object({
  bookingId: uuid,

  /**
   * Free text. `INP-B05-DX` allows it and no document fixes a coding system,
   * so nothing here pretends to validate a diagnosis — only its length.
   */
  diagnosisText: z.string().trim().max(2000).optional(),

  /** Bangla, because the patient reads it (`FR-DOC-07`). */
  adviceTextBn: z.string().trim().max(4000).optional(),

  /**
   * `YYYY-MM-DD` in Dhaka, which is the only calendar a follow-up means
   * anything in. `SEL-B05-FOLLOWUP` offers 7/14/30 days or a date.
   */
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a date as YYYY-MM-DD')
    .optional(),

  /**
   * True for `BTN-B05-SIGN`, false for `BTN-B05-DRAFT`.
   *
   * Signing writes the record to the wallet and advances the queue
   * (`FR-DOC-08`). A draft does neither, which is the whole difference between
   * the two controls.
   */
  sign: z.boolean().default(false),

  /**
   * Required on every write (CLAUDE.md §7).
   *
   * A doctor on a bad connection who taps sign twice must not end a
   * consultation twice, and must not call the next patient twice — the second
   * is the one a waiting room notices.
   */
  idempotencyKey: uuid,
});

export type CreateVisitBody = z.infer<typeof createVisitBody>;

/**
 * `GET /patients/:id/records` — the wallet, and the doctor's patient panel.
 *
 * `booking` is what makes one call enough for `S-B-05`. `FR-DOC-03` opens the
 * screen with the pre-visit intake *and* the past visits, and those live on
 * different tables; asking for them separately would be two round trips on a
 * connection this product assumes is bad (`NFR-04`).
 */
export const recordsQuery = z.object({
  /** The booking being consulted on, so its intake comes back with the history. */
  booking: uuid.optional(),
});

export type RecordsQuery = z.infer<typeof recordsQuery>;
