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

// ---------------------------------------------------------------------------
// Consent (`FR-PAT-63`, `FR-PAT-64`, BACKEND.md §7.6)
// ---------------------------------------------------------------------------

/**
 * How long a consent offer stays redeemable, in seconds.
 *
 * Short on purpose. The code is shown on a patient's screen in a chamber and
 * read out or held up; it has no job once the doctor has typed it, and a code
 * that stayed live for an hour would still be live in a photograph of that
 * screen.
 */
export const CONSENT_OFFER_TTL_SECONDS = 180;

/** What a patient is granting, and for how long (`consent_scope`). */
export const consentScope = z.enum(['visit', 'hospital', 'doctor', 'full']);

/**
 * `POST /consents` — the patient grants a hospital access directly.
 *
 * Used where the patient is already identified to the server. The chamber-side
 * path is `/consents/offer` + `/consents/redeem`, because there the doctor has
 * no way to name the patient until the patient hands them something.
 */
export const createConsentBody = z.object({
  hospitalId: uuid,
  scope: consentScope.default('visit'),
  idempotencyKey: uuid,
});

export type CreateConsentBody = z.infer<typeof createConsentBody>;

/**
 * `POST /consents/redeem` — a doctor turns the patient's code into access.
 *
 * `FR-PAT-63` describes this as scanning a QR, and the value here is what that
 * QR would encode: a short-lived signed token naming one patient. It is not a
 * six-digit code somebody reads aloud, and the length below says so — signing
 * is what makes it unforgeable without a table of outstanding codes to keep and
 * sweep, and the cost of that choice is that it is long.
 *
 * Until a QR encoder is installed the patient's screen offers it to copy and
 * the console offers a field to paste it into, which is workable between two
 * windows and clumsy on a phone. Scanning is the fix, and it changes
 * `BTN-A12-QR` and `BTN-B05-SCAN` and nothing here.
 */
export const redeemConsentBody = z.object({
  /** What the patient's screen is showing. Surrounding whitespace is forgiven. */
  code: z.string().trim().min(16).max(1024),
  idempotencyKey: uuid,
});

export type RedeemConsentBody = z.infer<typeof redeemConsentBody>;
