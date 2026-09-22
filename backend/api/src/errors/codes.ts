/**
 * Stable error codes (BACKEND.md §9).
 *
 * "Stable string codes the client maps to Bangla copy." That is the contract:
 * the server never sends prose for the user to read, because the user reads
 * Bangla and the copy lives in `@platform/i18n` (I18N-03: no string literals in
 * components, and none arriving from an API either).
 *
 * Two rules, both enforced below and tested:
 *
 *   Every code has exactly one HTTP status. A client that has to inspect a
 *   message to tell a conflict from a validation failure will get it wrong.
 *
 *   An error never returns a raw SQL or provider message to a client
 *   (BACKEND.md §9). The `message` on the wire is for a developer reading a
 *   log; anything from Postgres or bKash stays server-side.
 */

/** Every error the API can return. */
export const ERROR_CODES = {
  // --- Auth (FR-SEC-05, FR-ROLE-01) ---------------------------------------
  AUTH_REQUIRED: { status: 401, message: 'Authentication is required.' },
  AUTH_OTP_RATE_LIMIT: { status: 429, message: 'Too many OTP requests.' },
  AUTH_OTP_INVALID: { status: 401, message: 'The code is wrong or has expired.' },
  AUTH_TOKEN_INVALID: { status: 401, message: 'The token is invalid or has expired.' },
  AUTH_FORBIDDEN_SCOPE: { status: 403, message: 'Outside this hospital or role scope.' },

  // --- Guest (FR-GST-05) ---------------------------------------------------
  GUEST_LINK_EXPIRED: { status: 410, message: 'This tracking link has expired.' },

  // --- Booking -------------------------------------------------------------
  BOOKING_SLOT_TAKEN: { status: 409, message: 'That serial is no longer available.' },
  BOOKING_DUPLICATE: {
    status: 409,
    message: 'This patient already has a booking with this doctor today.',
  },
  /**
   * Every serial is taken (`FR-PAT-25`).
   *
   * A refusal, not a failure: the patient is offered the standby list, so the
   * response carries the capacity and what is taken rather than a bare "no".
   */
  SESSION_FULL: { status: 409, message: 'This chamber is fully booked.' },

  // --- Queue (FR-QUE-51, FR-QUE-53) ---------------------------------------
  QUEUE_CONFLICT: { status: 409, message: 'Another counter has already advanced this queue.' },
  QUEUE_GUARD_FAILED: { status: 422, message: 'That queue action is not allowed yet.' },

  // --- Beds (FR-BED-01, FR-BED-02) ----------------------------------------
  //
  // Two codes, split the way the queue's are. A transition the bed's current
  // state does not allow is a 422 — the same request will fail however many
  // times it is sent. A race lost to another console, or a patient already in
  // another bed, is a 409. An offline ward console rolls back either one.
  BED_TRANSITION_INVALID: {
    status: 422,
    message: 'That bed cannot do that from its current state.',
  },
  BED_CONFLICT: { status: 409, message: 'Another change to this bed or patient got there first.' },

  // --- Emergency (FR-EMG-01..04) -------------------------------------------
  //
  // One code, a 422: an action the case's state does not allow, which the
  // same request will meet however often it is sent — accepting a case the
  // family has called off, triaging somebody who has not arrived. The races
  // two ER consoles can run end in the state the other already wrote, and an
  // action whose outcome is already the case is answered as a replay, not a
  // conflict (`alreadyApplied` in `shared/domain`).
  EMERGENCY_TRANSITION_INVALID: {
    status: 422,
    message: 'That emergency case cannot do that from its current state.',
  },

  // `FR-PAT-63`. Expired, forged and never-real share one code on purpose: a
  // caller guessing at consent codes must not learn which guess was closer.
  CONSENT_CODE_INVALID: { status: 400, message: 'That code has expired or is not valid.' },
  /**
   * Not a failure. An offline console re-sending a batch gets the stored
   * result back, which is what makes replay safe (SY-02) — so it carries a
   * success status and the original outcome.
   */
  QUEUE_EVENT_DUPLICATE: { status: 200, message: 'Already applied.' },

  // --- Payments (FR-PAY-06) ------------------------------------------------
  PAYMENT_FAILED: { status: 402, message: 'The payment provider declined the transaction.' },

  // --- Consent (FR-PAT-64, FR-DOC-10) -------------------------------------
  CONSENT_REQUIRED: {
    status: 403,
    message: 'The patient has not granted access to these records.',
  },

  // --- Freshness (FR-OFF-04) ----------------------------------------------
  /**
   * Also not a failure. The data is returned and flagged, because a stale
   * number labelled stale is useful and a missing one is not (PRD.md §3.2).
   */
  CAPACITY_STALE: { status: 200, message: 'Returned, but older than the freshness threshold.' },

  // --- Request shape -------------------------------------------------------
  VALIDATION_FAILED: { status: 400, message: 'The request did not match the expected shape.' },
  IDEMPOTENCY_KEY_REQUIRED: {
    status: 400,
    message: 'This endpoint requires an Idempotency-Key header.',
  },
  RATE_LIMITED: { status: 429, message: 'Too many requests.' },
  NOT_FOUND: { status: 404, message: 'No such resource.' },

  // --- Server --------------------------------------------------------------
  INTERNAL: { status: 500, message: 'Something went wrong.' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'The service is not ready.' },
} as const satisfies Record<string, { status: number; message: string }>;

export type ErrorCode = keyof typeof ERROR_CODES;

/** The HTTP status a code maps to. */
export function statusFor(code: ErrorCode): number {
  return ERROR_CODES[code].status;
}

/** The developer-facing default message for a code. */
export function messageFor(code: ErrorCode): string {
  return ERROR_CODES[code].message;
}

/**
 * Codes that describe an outcome rather than a failure.
 *
 * Both carry a 2xx status, so a client must not treat them as errors — they
 * exist so the response can be *labelled*.
 */
export const NON_FAILURE_CODES = ['QUEUE_EVENT_DUPLICATE', 'CAPACITY_STALE'] as const;
