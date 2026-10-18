"""Stable error codes (BACKEND.md §9), one HTTP status each.

Generated from, and kept identical to, `backend/api/src/errors/codes.ts`.
The client maps the code to Bangla copy; `message` is for a developer
reading a log and never carries SQL or provider text.
"""

ERROR_CODES: dict[str, tuple[int, str]] = {
    "AUTH_REQUIRED": (401, "Authentication is required."),
    "AUTH_OTP_RATE_LIMIT": (429, "Too many OTP requests."),
    "AUTH_OTP_INVALID": (401, "The code is wrong or has expired."),
    "AUTH_TOKEN_INVALID": (401, "The token is invalid or has expired."),
    "AUTH_FORBIDDEN_SCOPE": (403, "Outside this hospital or role scope."),
    "AUTH_INVALID_CREDENTIALS": (401, "The email or password is wrong."),
    "AUTH_LOCKED": (423, "This account is locked for a while."),
    "AUTH_HOSPITAL_REQUIRED": (409, "Enter the hospital code as well."),
    "AUTH_PASSWORD_WEAK": (422, "Choose a different password."),
    "AUTH_PASSWORD_CHANGE_REQUIRED": (403, "Set a new password first."),
    "AUTH_2FA_INVALID": (401, "The code is wrong or has already been used."),
    "AUTH_2FA_SETUP_REQUIRED": (403, "Set up the second factor first."),
    "AUTH_2FA_ALREADY_ON": (409, "The second factor is already on."),
    "SETTINGS_DUPLICATE": (409, "Something with that value already exists here."),
    "SETTINGS_NOT_ALLOWED": (422, "That change is not allowed."),
    "MODULE_OFF": (403, "This hospital does not run that module."),
    "IMPORT_FILE": (422, "That file cannot be read as this set."),
    "IMPORT_STATE": (409, "That import is not in a state that allows this."),
    "IMPORT_UNDO_BLOCKED": (409, "Something has been built on rows from this import since."),
    "GUEST_LINK_EXPIRED": (410, "This tracking link has expired."),
    "BOOKING_SLOT_TAKEN": (409, "That serial is no longer available."),
    "BOOKING_DUPLICATE": (409, "This patient already has a booking with this doctor today."),
    "SESSION_FULL": (409, "This chamber is fully booked."),
    "QUEUE_CONFLICT": (409, "Another counter has already advanced this queue."),
    "QUEUE_GUARD_FAILED": (422, "That queue action is not allowed yet."),
    "BED_TRANSITION_INVALID": (422, "That bed cannot do that from its current state."),
    "BED_CONFLICT": (409, "Another change to this bed or patient got there first."),
    "EMERGENCY_TRANSITION_INVALID": (422, "That emergency case cannot do that from its current state."),
    "REFERRAL_TRANSITION_INVALID": (422, "That referral cannot do that from its current state."),
    "TEST_TRANSITION_INVALID": (422, "That test order cannot do that from its current state."),
    "REPORT_STORAGE_FAILED": (503, "The report could not be stored. Nothing was delivered; try again."),
    "ARRIVAL_WINDOW_NOT_OFFERED": (422, "That arrival hour is not one this chamber offers."),
    "DOCUMENT_NOT_SUPPORTED": (422, "Only a photograph (JPEG, PNG or WebP) or a PDF, up to 8 MB, can be added."),
    "DOCUMENT_STORAGE_FAILED": (503, "The paper could not be stored. Nothing was kept; try again."),
    "CONSENT_CODE_INVALID": (400, "That code has expired or is not valid."),
    "QUEUE_EVENT_DUPLICATE": (200, "Already applied."),
    "PAYMENT_FAILED": (402, "The payment provider declined the transaction."),
    "PAYMENT_UNAVAILABLE": (422, "Only paying at the hospital is available here."),
    "PAYMENT_ALREADY_MADE": (409, "This serial has already been paid for."),
    "PAYMENT_HOLD_ENDED": (409, "The time to pay for this serial online has run out."),
    "PREPAYMENT_REQUIRED": (422, "This serial must be paid for online before it is confirmed."),
    "REFUND_NOTE_REQUIRED": (422, "A refund made by hand needs the reference it was made under."),
    "REFUND_POLICY_UNKNOWN": (409, "This hospital has not set its refund terms, so a refund cannot be calculated."),
    "CONSENT_REQUIRED": (403, "The patient has not granted access to these records."),
    "CAPACITY_STALE": (200, "Returned, but older than the freshness threshold."),
    "VALIDATION_FAILED": (400, "The request did not match the expected shape."),
    "IDEMPOTENCY_KEY_REQUIRED": (400, "This endpoint requires an Idempotency-Key header."),
    "IDEMPOTENCY_KEY_REUSED": (422, "This Idempotency-Key was already used for a different request."),
    "DEMO_PHONE_NOT_ALLOWED": (422, "This is a demonstration: only its own demonstration phone numbers can be used."),
    "WRITE_CONFLICT": (409, "Something else changed this at the same moment. Please try again."),
    "RATE_LIMITED": (429, "Too many requests."),
    "BOOKING_LIMIT_REACHED": (429, "This phone number has made too many bookings today."),
    "PAYLOAD_TOO_LARGE": (413, "The request body is too large."),
    "NOT_FOUND": (404, "No such resource."),
    "INTERNAL": (500, "Something went wrong."),
    "SERVICE_UNAVAILABLE": (503, "The service is not ready."),
}

#: Codes that describe an outcome rather than a failure: 2xx, labelled.
NON_FAILURE_CODES = ("QUEUE_EVENT_DUPLICATE", "CAPACITY_STALE")


def status_for(code: str) -> int:
    return ERROR_CODES[code][0]


def message_for(code: str) -> str:
    return ERROR_CODES[code][1]
