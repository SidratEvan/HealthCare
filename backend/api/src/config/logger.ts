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
 * The fields of an error that are written to the log. Everything else an
 * error object carries is left out.
 *
 * Kept: what kind of failure it was and where (`stack`), and for a Postgres
 * error which constraint, table and column refused — enough to find the bug.
 *
 * Left out, because they hold what somebody sent or what a row contains, and
 * the path-based redaction above cannot see inside a string:
 *
 * - `body`: the body parser puts the raw text of a body it could not parse
 *   here, a sign-in's password or a registration's name and phone among it;
 * - `detail`, `where`, `hint`: Postgres puts row values here ("Key (phone)=…",
 *   "Failing row contains (…)");
 * - anything a library may add later. An allowlist does not need to know it.
 */
const ERROR_FIELDS = [
  'code',
  'status',
  'statusCode',
  'constraint',
  'table',
  'column',
  'schema',
  'dataType',
  'routine',
  'severity',
] as const;

/** How deep `cause` is followed: an error wrapping an error wrapping the fault. */
const CAUSE_DEPTH = 3;

/**
 * An error as the log may record it (CLAUDE.md §7, `FR-SEC-08`).
 *
 * A body parser's refusal keeps its kind and nothing of its message or stack,
 * whose first line is the message: V8's JSON errors quote the text they could
 * not read (`Unexpected token … "{"password":"…" is not valid JSON`). The
 * error handler does not log one anyway (`middleware/error.ts`); this is for
 * a call site that one day does.
 */
export function safeError(value: unknown, depth = 0): unknown {
  if (typeof value !== 'object' || value === null) return value;

  const error = value as Record<string, unknown> & { message?: unknown; stack?: unknown };
  const parserType = typeof error['type'] === 'string' ? error['type'] : null;
  const fromParser = parserType !== null && ('body' in error || error['expose'] === true);
  const kind =
    value instanceof Error
      ? value.constructor.name
      : typeof error['name'] === 'string'
        ? error['name']
        : 'Object';

  const safe: Record<string, unknown> = { type: kind };
  if (fromParser) {
    safe['parser'] = parserType;
  } else {
    if (typeof error.message === 'string') safe['message'] = error.message;
    if (typeof error.stack === 'string') safe['stack'] = error.stack;
  }
  for (const field of ERROR_FIELDS) {
    const kept = error[field];
    if (typeof kept === 'string' || typeof kept === 'number') safe[field] = kept;
  }
  if (depth < CAUSE_DEPTH && error['cause'] !== undefined) {
    safe['cause'] = safeError(error['cause'], depth + 1);
  }
  return safe;
}

/**
 * Every call site logs a failure as `{ err }`; this is the one place what that
 * writes is decided. Exported so a test can build a logger the same way.
 */
export const LOG_SERIALIZERS = { err: (value: unknown): unknown => safeError(value) } as const;

/**
 * The root logger.
 *
 * Pretty output is deliberately not configured: it needs another dependency,
 * and `pnpm dev:api | npx pino-pretty` works without one.
 */
export const logger: Logger = pino({
  level: isTest() ? 'silent' : env.LOG_LEVEL,
  redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  serializers: LOG_SERIALIZERS,
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
