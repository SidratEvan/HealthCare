/**
 * Structured logging (BACKEND.md §0: "Pino → structured JSON").
 *
 * The redaction list below is the enforcement of a rule from CLAUDE.md §7:
 * "Never log patient identifiers, OTPs, tokens, or payment references." A log
 * line is the easiest place in a healthcare system to leak a person's medical
 * business — it gets shipped to a third-party aggregator, kept for months, and
 * read by people who have no clinical relationship with the patient.
 *
 * So the redaction happens in the logger itself rather than at call sites. A
 * call site that forgets is the normal case, not the exception, and a rule that
 * depends on every developer remembering it is not a rule.
 */

import { pino, type Logger } from 'pino';

import { env, isProduction, isTest } from '../env.js';

/**
 * Paths scrubbed from every log line.
 *
 * Pino's redaction is path-based, so each shape a value can arrive in needs
 * listing. Erring wide is correct here: an over-redacted log costs a debugging
 * session, an under-redacted one costs a patient their privacy.
 */
const REDACTED_PATHS = [
  // Credentials and tokens
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-guest-token"]',
  'req.headers["idempotency-key"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.tokenHash',
  '*.accessToken',
  '*.refreshToken',
  '*.guestToken',
  '*.totpSecret',
  '*.secret',

  // One-time codes (FR-SEC-05)
  '*.otp',
  '*.code',

  // Patient identity (FR-SEC-03, DB-P7)
  '*.phone',
  '*.contactPhone',
  '*.nationalId',
  '*.fullName',
  '*.name',
  '*.dateOfBirth',
  '*.bloodGroup',

  // Clinical content
  '*.diagnosis',
  '*.diagnosisText',
  '*.notes',
  '*.intake',
  '*.advice',

  // Money trails (FR-PAY-06)
  '*.providerRef',
  '*.paymentRef',
  '*.idempotencyKey',
];

/**
 * The root logger.
 *
 * Pretty output is deliberately not configured: it needs another dependency,
 * and `pnpm dev:api | npx pino-pretty` works without one.
 */
export const logger: Logger = pino({
  level: isTest() ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  base: { service: 'api' },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Milliseconds since the epoch, UTC, matching the database (DB-P4).
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isProduction() ? {} : { messageKey: 'msg' }),
});

/**
 * A child logger for one request.
 *
 * `requestId` is what ties a queue event, an audit row and a log line together
 * when something is being reconstructed after the fact.
 */
export function requestLogger(requestId: string): Logger {
  return logger.child({ requestId });
}

/** The paths this logger scrubs. Exported so a test can assert on them. */
export const redactedPaths: readonly string[] = REDACTED_PATHS;
